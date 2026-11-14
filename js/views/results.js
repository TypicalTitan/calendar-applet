// The organizer's view of an event: the invite link, who has answered, a grid shaded by how many
// people are free, the best times, and CSV export.

import { h, replace, icon, toast, confirmDialog, copyText, downloadFile, field, uid } from '../ui/dom.js';
import { createHeatGrid, heatLegend } from '../ui/grid.js';
import { zoneChooser } from '../ui/zone.js';
import { getEvent, listAnswers, listAnswersSince, updateEvent, deleteEvent, deleteAnswer, getAccount, ANSWER_LIMIT } from '../backend.js';
import { buildSlots, slotWall } from '../core/slots.js';
import { countAvailable, fromAnswer, bestWindows } from '../core/availability.js';
import { gridRows, rangeRows, toCsv, exportFileName } from '../core/csv.js';
import { validateEvent, LIMITS } from '../core/validate.js';
import {
  eventSummary, timeRange, longDate, shortDate, timeLabel, duration, plural, ago, listNames,
} from '../ui/format.js';
import { messageView } from './misc.js';

const REFRESH_MS = 60_000;

export function resultsView({ params, navigate, appName }) {
  const [eventId] = params;
  const holder = h('div', null, h('p', { class: 'loading', role: 'status' }, 'Loading the event…'));
  let disposed = false;
  let cleanup = null;

  getEvent(eventId).then(async (event) => {
    if (disposed) return;
    if (!event || event === 'damaged') {
      replace(holder, messageView({
        title: 'We can’t find that event',
        body: 'It may have been deleted, or the address may be cut short.',
        action: { href: '#/events', label: 'Go to your events' },
      }).el);
      return;
    }
    if (event.ownerUid !== getAccount()?.uid) {
      replace(holder, messageView({
        title: event.title,
        body: 'Only the organizer can see the answers to an event. If you were invited, you can add your own times.',
        action: { href: `#/e/${event.id}`, label: 'Add my times' },
      }).el);
      return;
    }
    const answers = await listAnswers(event);
    if (disposed) return;
    cleanup = build(event, answers);
  }).catch((error) => {
    if (!disposed) replace(holder, h('p', { class: 'banner banner-danger', role: 'alert' }, error.message));
  });

  function build(event, firstAnswers) {
    const slots = buildSlots(event);
    const inviteUrl = `${window.location.href.split('#')[0]}#/e/${event.id}`;
    let answers = firstAnswers;
    let counts = [];
    let isolated = null;      // id of the person whose times are shown alone
    let pinnedBlock = -1;     // which "best time" is outlined on the grid
    let showTable = false;
    let lastLoaded = Date.now();
    let loading = false;

    // ---- invite link
    const linkId = uid('link');
    const linkInput = h('input', { class: 'input', id: linkId, type: 'text', readonly: true, value: inviteUrl, 'aria-describedby': `${linkId}-hint`, onfocus: (e) => e.target.select() });
    const copy = h('button', { type: 'button', class: 'btn' }, icon('copy'), 'Copy link');
    copy.addEventListener('click', async () => {
      if (await copyText(inviteUrl)) toast('Link copied');
      else { linkInput.focus(); linkInput.select(); toast('Press Ctrl+C or ⌘C to copy the link'); }
    });
    const share = navigator.share
      ? h('button', { type: 'button', class: 'btn btn-quiet', onclick: () => navigator.share({ title: event.title, text: `When are you free for ${event.title}?`, url: inviteUrl }).catch(() => {}) }, icon('share'), 'Share')
      : null;

    // ---- figures
    const figures = h('dl', { class: 'figures' });

    // ---- grid, legend, table
    const detail = h('div', { class: 'stack stack-s' });
    let grid;
    const chooser = zoneChooser({ event, slots, onChange: (next) => { zone = next; grid.setZone(next); drawAll(); } });
    let zone = chooser.zone;
    grid = createHeatGrid({
      event, slots, zone,
      label: `Answers for ${event.title}. Darker means more people are free.`,
      onSelect: (index) => drawDetail(index),
    });

    const legendHolder = h('div');
    const gridHolder = h('div');
    const tableToggle = h('button', { type: 'button', class: 'btn btn-quiet btn-small', 'aria-pressed': 'false' }, icon('table'), 'Show as a table');
    tableToggle.addEventListener('click', () => {
      showTable = !showTable;
      tableToggle.setAttribute('aria-pressed', String(showTable));
      drawGridArea();
    });
    const refresh = h('button', { type: 'button', class: 'btn btn-quiet btn-small' }, icon('refresh'), 'Refresh');
    refresh.addEventListener('click', () => reload({ announce: true, full: true }));

    // ---- side panels
    const peopleTitle = h('h2', { id: uid('people') });
    const peopleList = h('ul', { class: 'people' });
    const bestList = h('ol', { class: 'best' });
    const lengthSelect = h('select', { class: 'select' });
    const lengths = [event.slotMinutes, 30, 60, 90, 120, 180, 240]
      .filter((m, i, all) => m % event.slotMinutes === 0 && m <= event.endMinute - event.startMinute && all.indexOf(m) === i)
      .sort((a, b) => a - b);
    for (const m of lengths) lengthSelect.append(h('option', { value: String(m) }, duration(m)));
    lengthSelect.value = String(lengths.includes(60) ? 60 : lengths[0]);
    lengthSelect.addEventListener('change', () => { pinnedBlock = -1; grid.setHighlight([]); drawBest(); });
    const lengthField = field({ label: 'For a meeting of', control: lengthSelect });

    // ---- state line and actions
    const stateTag = h('span', { class: 'tag' });
    const toggleOpen = h('button', { type: 'button', class: 'btn btn-quiet' });
    toggleOpen.addEventListener('click', async () => {
      toggleOpen.disabled = true;
      try {
        await updateEvent(event.id, { open: !event.open });
        event.open = !event.open;
        drawState();
        toast(event.open ? 'Event reopened' : 'Event closed');
      } catch (error) { toast(error.message); }
      toggleOpen.disabled = false;
    });
    const remove = h('button', { type: 'button', class: 'btn btn-danger' }, icon('trash'), 'Delete event');
    remove.addEventListener('click', async () => {
      const ok = await confirmDialog({
        title: `Delete “${event.title}”?`,
        body: `This deletes the event and ${answers.length ? plural(answers.length, 'answer', 'answers') : 'its invite link'} for good. The invite link stops working.`,
        confirmLabel: 'Delete event',
        danger: true,
      });
      if (!ok) return;
      try {
        await deleteEvent(event.id);
        toast('Event deleted');
        navigate('/events');
      } catch (error) { toast(error.message); }
    });

    // ---- name and note
    const headTitle = h('h1');
    const headNote = h('p', { class: 'note-text' });
    function drawHead() {
      headTitle.textContent = event.title;
      headNote.textContent = event.description;
      headNote.hidden = !event.description;
      document.title = `${event.title} · ${appName}`;
    }
    const editDetails = h('button', { type: 'button', class: 'btn btn-quiet' }, 'Edit name and note');
    editDetails.addEventListener('click', () => {
      const title = field({ label: 'Event name', control: h('input', { class: 'input', type: 'text', maxlength: LIMITS.titleMax, value: event.title, autocomplete: 'off' }) });
      const note = field({ label: 'Note for invitees', optional: true, control: h('textarea', { class: 'textarea', maxlength: LIMITS.descriptionMax, rows: 3 }) });
      note.input.value = event.description;
      const failure = h('p', { class: 'form-error', role: 'alert', hidden: true });
      confirmDialog({
        title: 'Edit name and note',
        body: h('div', { class: 'stack' }, title.el, note.el, failure),
        confirmLabel: 'Save changes',
        onConfirm: async () => {
          const checked = validateEvent({ ...event, title: title.input.value, description: note.input.value });
          title.setError(checked.errors.title || '');
          note.setError(checked.errors.description || '');
          failure.hidden = true;
          if (!checked.ok) { (checked.errors.title ? title : note).input.focus(); return false; }
          try {
            await updateEvent(event.id, { title: checked.value.title, description: checked.value.description });
          } catch (error) {
            failure.textContent = error.message;
            failure.hidden = false;
            return false;
          }
          event.title = checked.value.title;
          event.description = checked.value.description;
          drawHead();
          toast('Changes saved');
          return true;
        },
      });
    });

    const exportGrid = h('button', { type: 'button', class: 'btn btn-quiet' }, icon('download'), 'Time-slot grid (.csv)');
    exportGrid.addEventListener('click', () => {
      downloadFile(exportFileName(event.title, 'grid'), toCsv(gridRows(event, slots, answers, event.timezone)));
    });
    const exportPeople = h('button', { type: 'button', class: 'btn btn-quiet' }, icon('download'), 'Free time by person (.csv)');
    exportPeople.addEventListener('click', () => {
      downloadFile(exportFileName(event.title, 'people'), toCsv(rangeRows(event, slots, answers, event.timezone)));
    });

    // ---- drawing
    const when = (index) => {
      const wall = slotWall(event, slots, index, zone);
      return `${longDate(wall.date)}, ${timeRange(wall.startMinute, wall.endMinute)}`;
    };

    function drawState() {
      replace(stateTag, event.open ? 'Open for answers' : [icon('lock'), 'Closed to new answers']);
      replace(toggleOpen, icon(event.open ? 'lock' : 'unlock'), event.open ? 'Close responses' : 'Reopen responses');
    }

    function drawFigures() {
      const total = answers.length;
      const most = counts.reduce((a, b) => Math.max(a, b), 0);
      const everyone = total ? counts.filter((n) => n === total).length * event.slotMinutes : 0;
      const latest = answers.reduce((max, a) => Math.max(max, a.updatedAt || 0), 0);
      const figure = (label, value, small) => h('div', { class: 'figure' }, h('dt', null, label), h('dd', null, value, small ? h('small', null, small) : null));
      replace(figures,
        figure('Answers', String(total)),
        figure('Most free at once', total ? `${most} of ${total}` : '–'),
        figure('Everyone is free for', total ? (everyone ? duration(everyone) : 'No time yet') : '–', total > 1 && everyone ? 'in total, across all days' : null),
        figure('Latest answer', latest ? ago(latest) : '–'));
    }

    function drawDetail(index) {
      if (index < 0 || index === undefined) {
        replace(detail, h('p', { class: 'muted' }, answers.length
          ? 'Pick a time on the grid to see who is free then.'
          : 'When people answer, pick a time on the grid to see who is free then.'));
        return;
      }
      const free = [];
      const busy = [];
      for (const a of answers) (a.slots[index] === '1' ? free : busy).push(a.name);
      replace(detail,
        h('h3', null, when(index)),
        h('p', null, `${free.length} of ${answers.length} free`),
        free.length ? h('p', { class: 'names' }, h('b', null, 'Free: '), listNames(free)) : null,
        busy.length ? h('p', { class: 'names' }, h('b', null, 'Not free: '), listNames(busy)) : null);
    }

    const capNote = h('p', { class: 'banner', hidden: true }, `Showing ${ANSWER_LIMIT} answers, the most this page loads at once. There may be more.`);

    function drawPeople() {
      capNote.hidden = answers.length < ANSWER_LIMIT;
      peopleTitle.textContent = answers.length ? plural(answers.length, 'answer', 'answers') : 'No answers yet';
      if (answers.length === 0) {
        replace(peopleList, h('li', null, h('p', { class: 'muted' }, 'Send the invite link to the people you want to hear from. Their names appear here as they answer.')));
        return;
      }
      replace(peopleList, answers.map((a) => {
        const marked = [...a.slots].filter((c) => c === '1').length * event.slotMinutes;
        const who = h('button', { type: 'button', class: 'who', 'aria-pressed': String(isolated === a.id), title: 'Show only this person’s times' },
          h('span', { class: 'n' }, a.name),
          h('span', { class: 'm' }, `${marked ? `${duration(marked)} free` : 'Not free at any time'}${a.updatedAt ? `, answered ${ago(a.updatedAt)}` : ''}`));
        who.addEventListener('click', () => { isolated = isolated === a.id ? null : a.id; drawAll(); });
        const del = h('button', { type: 'button', class: 'icon-btn', 'aria-label': `Remove ${a.name}` }, icon('trash'));
        del.addEventListener('click', async () => {
          const ok = await confirmDialog({
            title: `Remove ${a.name}’s answer?`,
            body: 'Their name and times are deleted from this event. They can answer again from the invite link.',
            confirmLabel: 'Remove answer',
            danger: true,
          });
          if (!ok) return;
          try {
            await deleteAnswer(event, a.id);
            answers = answers.filter((other) => other.id !== a.id);
            if (isolated === a.id) isolated = null;
            grid.select(-1);
            drawAll();
            toast('Answer removed');
          } catch (error) { toast(error.message); }
        });
        return h('li', null, who, del);
      }));
    }

    function drawBest() {
      const length = Number(lengthSelect.value) / event.slotMinutes;
      const blocks = bestWindows(slots, answers.map((a) => a.slots), length, 5);
      if (blocks.length === 0) {
        replace(bestList, h('li', null, h('p', { class: 'muted' }, answers.length
          ? 'Nobody has marked a stretch that long. Try a shorter meeting.'
          : 'The best times appear here once people answer.')));
        return;
      }
      replace(bestList, blocks.map((block, n) => {
        const first = block.day * slots.perDay + block.startK;
        const lastStart = block.day * slots.perDay + block.lastStartK;
        const last = lastStart + block.length - 1;
        const a = slotWall(event, slots, first, zone);
        const b = slotWall(event, slots, last, zone);
        const missing = answers.filter((_, p) => !block.who.includes(p)).map((x) => x.name);
        const flexible = block.lastStartK > block.startK
          ? `Start any time from ${timeLabel(a.startMinute)} to ${timeLabel(slotWall(event, slots, lastStart, zone).startMinute)}. `
          : '';
        const button = h('button', { type: 'button', 'aria-pressed': String(pinnedBlock === n) },
          h('span', { class: 't' }, `${shortDate(a.date)}, ${timeRange(a.startMinute, b.endMinute)}`),
          h('span', { class: 'c' }, `${block.count === answers.length && answers.length > 1 ? `All ${block.count}` : `${block.count} of ${answers.length}`} free. ${flexible}${missing.length ? `Missing: ${listNames(missing)}.` : ''}`),
          h('span', { class: 'meter', 'aria-hidden': 'true' }, h('i', { style: { '--t': String(block.count / answers.length) } })));
        button.addEventListener('click', () => {
          pinnedBlock = pinnedBlock === n ? -1 : n;
          const cells = [];
          if (pinnedBlock === n) for (let i = first; i <= last; i++) cells.push(i);
          grid.setHighlight(cells);
          drawBest();
        });
        return h('li', null, button);
      }));
    }

    function dataTable() {
      const rows = gridRows(event, slots, answers, zone);
      const head = ['Day', 'Time', 'Free', ...rows[0].slice(8)];
      return h('div', { class: 'table-wrap', tabindex: '0', role: 'region', 'aria-label': 'Answers as a table' },
        h('table', { class: 'data-table' },
          h('thead', null, h('tr', null, head.map((text, i) => h('th', { scope: 'col', class: i === 2 ? 'num' : null }, text)))),
          h('tbody', null, rows.slice(1).map((row, index) => {
            const wall = slotWall(event, slots, index, zone);
            return h('tr', null,
              h('th', { scope: 'row' }, shortDate(wall.date)),
              h('td', null, timeRange(wall.startMinute, wall.endMinute)),
              h('td', { class: 'num' }, `${row[6]} of ${row[7]}`),
              row.slice(8).map((flag) => h('td', { class: flag ? 'yes' : null }, flag ? 'Free' : '–')));
          }))));
    }

    function drawGridArea() {
      const person = isolated ? answers.find((a) => a.id === isolated) : null;
      grid.setData({ counts, total: answers.length, person: person ? fromAnswer(person.slots, slots.count) : null });
      replace(tableToggle, icon('table'), showTable ? 'Show as a grid' : 'Show as a table');
      replace(gridHolder, showTable ? dataTable() : grid.el);
      replace(legendHolder, showTable ? null : person
        ? h('p', { class: 'legend-scale' }, `Showing only ${person.name}’s free times. `, h('button', { type: 'button', class: 'linklike', onclick: () => { isolated = null; drawAll(); } }, 'Show everyone'))
        : heatLegend(counts, answers.length));
    }

    function drawAll() {
      counts = countAvailable(answers.map((a) => a.slots), slots.count);
      if (isolated && !answers.some((a) => a.id === isolated)) isolated = null;
      pinnedBlock = -1;
      grid.setHighlight([]);
      drawState();
      drawFigures();
      drawGridArea();
      drawPeople();
      drawBest();
      drawDetail(grid.selected);
    }

    // A full reload fetches every answer. A light one asks only for answers saved since the
    // newest one already here, which costs a single read when nothing has changed; it cannot
    // notice an answer that was removed, so every tenth automatic refresh is a full one.
    async function reload({ announce = false, full = false } = {}) {
      if (loading) return;
      loading = true;
      refresh.disabled = true;
      try {
        if (full) {
          answers = await listAnswers(event);
          lastLoaded = Date.now();
          drawAll();
        } else {
          const newest = answers.reduce((max, a) => Math.max(max, a.updatedAt || 0), 0);
          const changed = await listAnswersSince(event, newest);
          lastLoaded = Date.now();
          if (changed.length) {
            const byId = new Map(answers.map((a) => [a.id, a]));
            for (const answer of changed) byId.set(answer.id, answer);
            answers = [...byId.values()].sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
            drawAll();
          }
        }
        if (announce) toast('Up to date');
      } catch (error) {
        if (announce) toast(error.message);
      }
      refresh.disabled = false;
      loading = false;
    }

    // Keep the page fresh while it is on screen, without a permanent connection.
    let ticks = 0;
    const timer = setInterval(() => {
      if (document.visibilityState !== 'visible') return;
      ticks += 1;
      reload({ full: ticks % 10 === 0 });
    }, REFRESH_MS);
    const onVisible = () => { if (document.visibilityState === 'visible' && Date.now() - lastLoaded > 15_000) reload(); };
    document.addEventListener('visibilitychange', onVisible);

    const at = slots.utc[0];
    replace(holder, h('div', { class: 'stack stack-l' },
      h('div', { class: 'page-head' },
        h('div', null, headTitle, h('p', null, eventSummary(event, at)), headNote),
        stateTag),
      h('section', { class: 'sheet field', 'aria-label': 'Invite' },
        h('label', { for: linkId }, 'Invite link'),
        h('div', { class: 'invite-row' }, linkInput, copy, share),
        h('span', { class: 'hint', id: `${linkId}-hint` }, 'Anyone with this link can add their times. They don’t need an account or a password.')),
      figures,
      h('div', { class: 'results' },
        h('section', { class: 'sheet stack results-grid', 'aria-label': 'Who is free when' },
          h('div', { class: 'row row-between' }, chooser.el, h('div', { class: 'row no-print' }, tableToggle, refresh)),
          gridHolder,
          legendHolder),
        h('div', { class: 'results-side stack' },
          h('section', { class: 'sheet detail', 'aria-label': 'Selected time', 'aria-live': 'polite' }, detail),
          h('section', { class: 'sheet', 'aria-label': 'Best times' },
            h('h2', null, 'Best times'), lengthField.el, bestList)),
        h('section', { class: 'sheet results-people stack', 'aria-labelledby': peopleTitle.id }, peopleTitle, capNote, peopleList)),
      h('section', { class: 'sheet stack no-print', 'aria-label': 'Export' },
        h('h2', null, 'Export'),
        h('p', { class: 'muted' }, 'Download every answer as a spreadsheet file. The grid has a row for each time slot and a column for each person; the other lists each person’s free stretches.'),
        h('div', { class: 'row' }, exportGrid, exportPeople)),
      h('section', { class: 'sheet stack no-print', 'aria-label': 'Manage' },
        h('h2', null, 'Manage'),
        h('p', { class: 'muted' }, 'Close the event when you have enough answers: the link keeps working, but nobody can add or change times. The days and hours of an event can’t be changed once it is created; its name and note can.'),
        h('div', { class: 'row' }, editDetails, toggleOpen, h('a', { class: 'btn btn-quiet', href: `#/e/${event.id}` }, 'Add my own times'), remove))));

    drawHead();
    drawAll();

    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }

  return {
    title: 'Event',
    el: holder,
    dispose: () => { disposed = true; if (cleanup) cleanup(); },
  };
}
