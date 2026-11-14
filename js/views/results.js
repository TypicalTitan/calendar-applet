// What the person who made an event sees: the invite link, a grid shaded by how many people are
// free, the best times, who has answered, and the spreadsheet downloads.

import { h, replace, icon, toast, confirmDialog, copyText, downloadFile, field, uid } from '../ui/dom.js';
import { createHeatGrid, heatLegend } from '../ui/grid.js';
import { zoneChooser } from '../ui/zone.js';
import { getEvent, listAnswers, listAnswersSince, updateEvent, deleteEvent, deleteAnswer, getAccount, ANSWER_LIMIT } from '../backend.js';
import { buildSlots, slotWall } from '../core/slots.js';
import { countAvailable, fromAnswer, bestWindows } from '../core/availability.js';
import { gridRows, rangeRows, toCsv, exportFileName, columnNames } from '../core/csv.js';
import { validateEvent, LIMITS } from '../core/validate.js';
import { localTimeZone } from '../core/tz.js';
import {
  eventSummary, timeRange, longDate, shortDate, timeLabel, duration, plural, ago, listNames,
} from '../ui/format.js';
import { messageView } from './misc.js';

const REFRESH_MS = 60_000;

export function resultsView({ params, navigate, appName, signInThenReturn }) {
  const [eventId] = params;

  // Someone who is not signed in was probably sent this address by mistake. Point them at the
  // invite page rather than at a sign-in form they have no use for.
  if (!getAccount()) {
    return messageView({
      title: 'This page is for whoever made the event',
      body: 'Only the person who made this event can see the answers. If you were invited, add your own times instead.',
      action: { href: `#/e/${eventId}`, label: 'Add my times' },
      secondary: { onclick: signInThenReturn, label: 'I made this event' },
    });
  }

  const holder = h('div', null, h('p', { class: 'loading', role: 'status' }, 'Loading the event…'));
  let disposed = false;
  let cleanup = null;

  getEvent(eventId).then(async (event) => {
    if (disposed) return;
    if (!event || event === 'damaged') {
      replace(holder, messageView({
        title: 'We can’t find that event',
        body: 'It may have been deleted, or the address may be cut short.',
        action: { href: '#/events', label: 'Your events' },
      }).el);
      return;
    }
    if (event.ownerUid !== getAccount()?.uid) {
      replace(holder, messageView({
        title: event.title,
        body: 'Only the person who made this event can see the answers. If you were invited, add your own times instead.',
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
    let pinnedKey = null;     // which "best time" is outlined on the grid
    let showTable = false;
    let removals = 0;         // counts answers removed here, to spot a refresh that started before one
    let lastLoaded = Date.now();
    let loading = false;

    // ---- invite link
    const linkId = uid('link');
    const linkInput = h('input', { class: 'input', id: linkId, type: 'text', readonly: true, value: inviteUrl, 'aria-describedby': `${linkId}-hint`, onfocus: (e) => e.target.select() });
    const linkHint = h('span', { class: 'hint', id: `${linkId}-hint` });
    const copy = h('button', { type: 'button', class: 'btn' }, 'Copy link');
    copy.addEventListener('click', async () => {
      if (await copyText(inviteUrl)) toast('Link copied');
      else { linkInput.focus(); linkInput.select(); toast('Press Ctrl+C or ⌘C to copy the link'); }
    });
    const share = navigator.share
      ? h('button', { type: 'button', class: 'btn btn-quiet', onclick: () => navigator.share({ title: event.title, text: `When are you free for ${event.title}?`, url: inviteUrl }).catch(() => {}) }, 'Share')
      : null;

    // ---- grid, legend, table
    const detail = h('div', { class: 'stack stack-s' });
    let grid;
    const chooser = zoneChooser({ event, slots, onChange: (next) => { zone = next; grid.setZone(next); drawAll(); } });
    let zone = chooser.zone;
    grid = createHeatGrid({
      event, slots, zone,
      label: `Answers for ${event.title}. Stronger shading means more people are free.`,
      onSelect: (index) => drawDetail(index),
    });

    const legendHolder = h('div');
    const gridHolder = h('div');
    const tableToggle = h('button', { type: 'button', class: 'linklike' }, 'Show as a table');
    tableToggle.addEventListener('click', () => {
      showTable = !showTable;
      tableToggle.textContent = showTable ? 'Show as a grid' : 'Show as a table'; // the button names the other view
      drawGridArea();
    });
    const refresh = h('button', { type: 'button', class: 'linklike' }, 'Refresh');
    refresh.addEventListener('click', () => reload({ announce: true, full: true }));

    // ---- beside and under the grid
    const peopleTitle = h('h2', { id: uid('people'), tabindex: '-1' });
    const peopleList = h('ul', { class: 'people' });
    const bestList = h('ol', { class: 'best' });
    const lengthSelect = h('select', { class: 'select' });
    const lengths = [event.slotMinutes, 30, 60, 90, 120, 180, 240]
      .filter((m, i, all) => m % event.slotMinutes === 0 && m <= event.endMinute - event.startMinute && all.indexOf(m) === i)
      .sort((a, b) => a - b);
    for (const m of lengths) lengthSelect.append(h('option', { value: String(m) }, duration(m)));
    lengthSelect.value = String(lengths.includes(60) ? 60 : lengths[0]);
    lengthSelect.addEventListener('change', () => { pinnedKey = null; drawBest(); });
    const lengthField = field({ label: 'How long', control: lengthSelect });

    // ---- closing, reopening, deleting
    const toggleOpen = h('button', { type: 'button', class: 'linklike' });
    let toggling = false;
    toggleOpen.addEventListener('click', async () => {
      if (toggling) return; // guarded, not disabled: disabling a button throws away keyboard focus
      toggling = true;
      try {
        await updateEvent(event.id, { open: !event.open });
        event.open = !event.open;
        drawState();
        toast(event.open ? 'Event reopened' : 'Event closed');
      } catch (error) { toast(error.message, { error: true }); }
      toggling = false;
    });
    const remove = h('button', { type: 'button', class: 'linklike danger' }, 'Delete event');
    remove.addEventListener('click', async () => {
      const ok = await confirmDialog({
        title: `Delete “${event.title}”?`,
        body: `Deletes the event${answers.length ? ` and its ${plural(answers.length, 'answer', 'answers')}` : ''} for good. The invite link stops working.`,
        confirmLabel: 'Delete event',
        danger: true,
      });
      if (!ok) return;
      try {
        await deleteEvent(event.id);
        toast('Event deleted');
        navigate('/events');
      } catch (error) { toast(error.message, { error: true }); }
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
    const editDetails = h('button', { type: 'button', class: 'linklike' }, 'Edit name and note');
    editDetails.addEventListener('click', () => {
      const title = field({ label: 'Event name', control: h('input', { class: 'input', type: 'text', maxlength: LIMITS.titleMax, value: event.title, autocomplete: 'off' }) });
      const note = field({ label: 'Note', optional: true, control: h('textarea', { class: 'textarea', maxlength: LIMITS.descriptionMax, rows: 3 }) });
      note.input.value = event.description;
      const failure = h('p', { class: 'form-error', role: 'alert', hidden: true });
      confirmDialog({
        title: 'Edit name and note',
        body: h('div', { class: 'stack' }, title.el, note.el,
          h('p', { class: 'muted small' }, 'The days and hours can’t be changed. Make a new event for that.'),
          failure),
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

    // Files use the event's own time zone, or the reader's if this browser does not know that zone.
    const exportZone = event.zoneKnown === false ? localTimeZone() : event.timezone;
    const exportGrid = h('button', { type: 'button', class: 'linklike' }, 'Download by time (.csv)');
    exportGrid.addEventListener('click', () => {
      downloadFile(exportFileName(event.title, 'grid'), toCsv(gridRows(event, slots, answers, exportZone)));
    });
    const exportPeople = h('button', { type: 'button', class: 'linklike' }, 'Download by person (.csv)');
    exportPeople.addEventListener('click', () => {
      downloadFile(exportFileName(event.title, 'people'), toCsv(rangeRows(event, slots, answers, exportZone)));
    });

    // ---- drawing
    const when = (index) => {
      const wall = slotWall(event, slots, index, zone);
      return `${longDate(wall.date)}, ${timeRange(wall.startMinute, wall.endMinute)}`;
    };

    // The line under the link says whether it still takes answers. Changing only the button's
    // words keeps the keyboard focus on it.
    function drawState() {
      linkHint.textContent = event.open
        ? 'Anyone with this link can add their times. No account needed.'
        : 'Closed to new answers. The link still opens, but nobody can add or change times.';
      toggleOpen.textContent = event.open ? 'Close event' : 'Reopen event';
    }

    function drawDetail(index) {
      if (index < 0 || index === undefined) {
        replace(detail, h('p', { class: 'muted' }, 'Pick a time to see who’s free then.'));
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

    const capNote = h('p', { class: 'banner', hidden: true }, `Showing the first ${ANSWER_LIMIT} answers. There may be more.`);
    const emptyNote = h('p', { class: 'muted' }, 'Send the link. Names show up here as people answer.');
    const downloads = h('p', { class: 'links muted no-print' }, 'Spreadsheet:', exportGrid, exportPeople);

    function drawPeople() {
      const none = answers.length === 0;
      capNote.hidden = answers.length < ANSWER_LIMIT;
      peopleTitle.textContent = none ? 'No answers yet' : plural(answers.length, 'answer', 'answers');
      emptyNote.hidden = !none;
      peopleList.hidden = none;
      downloads.hidden = none;
      if (none) {
        replace(peopleList);
        return;
      }
      replace(peopleList, answers.map((a) => {
        const marked = [...a.slots].filter((c) => c === '1').length * event.slotMinutes;
        const who = h('button', { type: 'button', class: 'who', dataset: { key: `who:${a.id}` }, 'aria-pressed': String(isolated === a.id), title: 'Show only this person’s times' },
          h('span', { class: 'n' }, a.name),
          h('span', { class: 'm' }, `${marked ? `${duration(marked)} free` : 'Nothing marked'}${a.updatedAt ? `, answered ${ago(a.updatedAt)}` : ''}`));
        who.addEventListener('click', () => showOnly(isolated === a.id ? null : a.id));
        const del = h('button', { type: 'button', class: 'icon-btn', dataset: { key: `del:${a.id}` }, 'aria-label': `Remove ${a.name}` }, icon('trash'));
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
            removals += 1;
            answers = answers.filter((other) => other.id !== a.id);
            if (isolated === a.id) isolated = null;
            grid.select(-1);
            drawAll();
            peopleTitle.focus(); // the button that was pressed is gone; land on the list's heading
            toast('Answer removed');
          } catch (error) { toast(error.message, { error: true }); }
        });
        return h('li', null, who, del);
      }));
    }

    // Shows one person's times alone (or everyone's again) without rebuilding the list, so the
    // button that was pressed keeps the keyboard focus and announces its new state.
    function showOnly(id) {
      const from = isolated;
      isolated = id;
      for (const button of peopleList.querySelectorAll('.who')) {
        button.setAttribute('aria-pressed', String(button.dataset.key === `who:${isolated}`));
      }
      drawGridArea();
      if (id === null && from && !peopleList.contains(document.activeElement)) {
        peopleList.querySelector(`[data-key="who:${from}"]`)?.focus();
      }
    }

    const blockKey = (block) => `best:${block.day}:${block.startK}:${block.lastStartK}:${block.length}`;
    let blocksShown = new Map(); // key -> the slot indexes that block covers

    // Marks the chosen best time on its button and on the grid, without rebuilding the list.
    function showPinned() {
      if (pinnedKey && !blocksShown.has(pinnedKey)) pinnedKey = null;
      for (const button of bestList.querySelectorAll('button')) {
        button.setAttribute('aria-pressed', String(button.dataset.key === pinnedKey));
      }
      grid.setHighlight(pinnedKey ? blocksShown.get(pinnedKey) : []);
    }

    function drawBest() {
      const length = Number(lengthSelect.value) / event.slotMinutes;
      const blocks = bestWindows(slots, answers.map((a) => a.slots), length, 5);
      if (blocks.length === 0) {
        replace(bestList, answers.length
          ? h('li', null, h('p', { class: 'muted' }, 'Nobody has marked a stretch that long. Try a shorter one.'))
          : null);
        blocksShown = new Map();
        showPinned();
        return;
      }
      blocksShown = new Map();
      replace(bestList, blocks.map((block) => {
        const first = block.day * slots.perDay + block.startK;
        const lastStart = block.day * slots.perDay + block.lastStartK;
        const last = lastStart + block.length - 1;
        const a = slotWall(event, slots, first, zone);
        const b = slotWall(event, slots, last, zone);
        const missing = answers.filter((_, p) => !block.who.includes(p)).map((x) => x.name);
        const flexible = block.lastStartK > block.startK
          ? `Start any time from ${timeLabel(a.startMinute)} to ${timeLabel(slotWall(event, slots, lastStart, zone).startMinute)}. `
          : '';
        const key = blockKey(block);
        blocksShown.set(key, Array.from({ length: last - first + 1 }, (_, i) => first + i));
        const button = h('button', { type: 'button', dataset: { key }, 'aria-pressed': 'false' },
          h('span', { class: 't' }, `${shortDate(a.date)}, ${timeRange(a.startMinute, b.endMinute)}`),
          h('span', { class: 'c' }, `${block.count === answers.length && answers.length > 1 ? `All ${block.count}` : `${block.count} of ${answers.length}`} free. ${flexible}${missing.length ? `Missing: ${listNames(missing)}.` : ''}`));
        button.addEventListener('click', () => {
          pinnedKey = pinnedKey === key ? null : key;
          showPinned();
        });
        return h('li', null, button);
      }));
      showPinned();
    }

    function dataTable() {
      const rows = gridRows(event, slots, answers, zone);
      const head = ['Day', 'Time', 'Free', ...columnNames(answers, { escape: false })];
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
      if (showTable) {
        // The table is rebuilt from the data, but stays scrolled where the reader left it.
        const old = gridHolder.querySelector('.table-wrap');
        const at = old ? [old.scrollLeft, old.scrollTop] : [0, 0];
        const table = dataTable();
        replace(gridHolder, table);
        [table.scrollLeft, table.scrollTop] = at;
      } else if (gridHolder.firstChild !== grid.el) {
        replace(gridHolder, grid.el); // otherwise left alone: re-attaching it would lose its scroll position
      }
      replace(legendHolder, showTable || answers.length === 0 ? null : person
        ? h('p', { class: 'legend-scale' }, `Showing only ${person.name}’s free times. `, h('button', { type: 'button', class: 'linklike', onclick: () => showOnly(null) }, 'Show everyone'))
        : heatLegend(counts, answers.length));
    }

    // Redraws everything that depends on the answers. Whatever had the keyboard focus gets it
    // back if it still exists, and a chosen best time stays chosen.
    function drawAll() {
      const focused = document.activeElement?.dataset?.key;
      counts = countAvailable(answers.map((a) => a.slots), slots.count);
      if (isolated && !answers.some((a) => a.id === isolated)) isolated = null;
      // Until someone answers there is nothing to compare: just the link and the empty grid.
      side.hidden = answers.length === 0;
      layout.classList.toggle('is-empty', answers.length === 0);
      drawState();
      drawGridArea();
      drawPeople();
      drawBest();
      drawDetail(grid.selected);
      if (focused && !holder.contains(document.activeElement)) {
        [...holder.querySelectorAll('[data-key]')].find((el) => el.dataset.key === focused)?.focus();
      }
    }

    const signature = (list) => list.map((a) => `${a.id}:${a.updatedAt}:${a.name}:${a.slots}`).join('|');

    // A full reload fetches every answer. A light one asks only for answers saved since the
    // newest one already here, which costs a single read when nothing has changed; it cannot
    // notice an answer that was removed, so every tenth automatic refresh is a full one.
    async function reload({ announce = false, full = false } = {}) {
      if (loading) return;
      loading = true;
      const removedBefore = removals;
      try {
        const before = signature(answers);
        let next;
        if (full) {
          next = await listAnswers(event);
        } else {
          const newest = answers.reduce((max, a) => Math.max(max, a.updatedAt || 0), 0);
          const changed = await listAnswersSince(event, newest);
          const byId = new Map(answers.map((a) => [a.id, a]));
          for (const answer of changed) byId.set(answer.id, answer);
          next = [...byId.values()].sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
        }
        lastLoaded = Date.now();
        if (removals !== removedBefore) {
          // An answer was removed here while this request was on its way; its reply is out of
          // date and would bring that answer back. Ask again instead.
          loading = false;
          return reload({ announce, full: true });
        }
        if (signature(next) !== before) {
          answers = next;
          drawAll();
        }
        if (announce) toast('Up to date');
      } catch (error) {
        if (announce) toast(error.message, { error: true });
      }
      loading = false;
      return undefined;
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
    const side = h('div', { class: 'results-side stack' },
      h('section', { class: 'detail', 'aria-label': 'Selected time', 'aria-live': 'polite' }, detail),
      h('section', { class: 'part', 'aria-label': 'Best times' },
        h('h2', null, 'Best times'), lengthField.el, bestList));
    const layout = h('div', { class: 'results' },
      h('section', { class: 'sheet stack results-grid', 'aria-label': 'Who is free when' },
        chooser.el,
        gridHolder,
        h('div', { class: 'row' }, legendHolder, h('div', { class: 'links grid-tools no-print' }, tableToggle, refresh))),
      side,
      h('section', { class: 'part results-people stack', 'aria-labelledby': peopleTitle.id },
        peopleTitle, capNote, emptyNote, peopleList, downloads));
    replace(holder, h('div', { class: 'stack stack-l' },
      h('div', { class: 'page-head' },
        h('div', null, headTitle, h('p', null, eventSummary(event, at)), headNote)),
      h('section', { class: 'field', 'aria-label': 'Invite' },
        h('label', { for: linkId }, 'Invite link'),
        h('div', { class: 'invite-row' }, linkInput, copy, share),
        linkHint),
      layout,
      h('p', { class: 'part links no-print' },
        h('a', { class: 'linklike', href: `#/e/${event.id}` }, 'Add my own times'), editDetails, toggleOpen, remove)));

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
