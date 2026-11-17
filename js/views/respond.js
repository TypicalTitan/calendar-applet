// The invite page: anyone with the link types a name and marks the times they are free.

import { h, replace, field, toast, confirmDialog, touchFirst, setBusy, isBusy } from '../ui/dom.js';
import { createPaintGrid } from '../ui/grid.js';
import { zoneChooser } from '../ui/zone.js';
import { getEvent, getMyAnswer, saveMyAnswer, deleteMyAnswer, getAccount, forgetGuest, runsEvent, SAVE_PAUSE } from '../backend.js';
import { buildSlots, slotWall } from '../core/slots.js';
import { cleanName, fromAnswer, toAnswer, isAnswer, emptyAnswer, NAME_MAX } from '../core/availability.js';
import { duration, eventSummary, shortDate, timeLabel } from '../ui/format.js';
import { messageView } from './misc.js';

export function respondView({ params }) {
  const [eventId] = params;
  const holder = h('div');
  let disposed = false;
  let cleanup = null;

  async function load() {
    replace(holder, h('p', { class: 'loading', role: 'status' }, 'Loading the event…'));
    let event;
    let mine;
    let runs = false;
    try {
      event = await getEvent(eventId);
      if (disposed) return;
      if (!event) {
        replace(holder, messageView({
          title: 'Can’t find that event',
          body: 'The link may be cut short, or the event was deleted. Ask whoever sent it.',
        }).el);
        return;
      }
      if (event === 'damaged') {
        replace(holder, messageView({
          title: 'This event is broken',
          body: 'Something is wrong with how it was saved. Ask whoever made it to make a new one.',
        }).el);
        return;
      }
      document.title = `${event.title} · ${document.title.split(' · ').pop()}`;
      // An answer already saved from this browser must be on the page before anything can be
      // saved: showing an empty form instead would let the next save wipe it out.
      mine = await getMyAnswer(event);
      runs = await runsEvent(event).catch(() => false);
    } catch (error) {
      if (disposed) return;
      replace(holder, h('div', { class: 'stack' },
        h('p', { class: 'banner banner-danger', role: 'alert' }, error.message),
        h('div', null, h('button', { type: 'button', class: 'btn', onclick: load }, 'Try again'))));
      return;
    }
    if (disposed) return;
    cleanup = build(event, mine, runs);
  }

  function build(event, existing, runs) {
    const slots = buildSlots(event);
    const account = getAccount();
    const isOrganizer = account && account.uid === event.ownerUid;
    const youRunIt = isOrganizer ? 'You made this event.' : 'You run this event.';
    let saved = existing;                         // what is stored, or null
    let savedAs = existing?.as;                   // whose answer it is: 'account' or 'guest'
    let bits = fromAnswer(existing?.slots, slots.count);
    let dirty = false;
    let removing = false;
    let closedNote = null;   // on a closed event: the sentence saying so,
    let closedSaved = null;  // and what this visitor saved, with the way to remove it
    // The database refuses a second save within a few seconds of the last one. Rather than show
    // an error, wait out whatever is left of that pause before sending.
    let lastWriteAt = existing?.updatedAt || 0;
    const pause = () => {
      const left = SAVE_PAUSE - (Date.now() - lastWriteAt);
      return left > 0 && left <= SAVE_PAUSE ? new Promise((resolve) => { setTimeout(resolve, left); }) : null;
    };

    // What has been typed and marked but not saved is kept for this tab, so a stray tap on a
    // link, or the Back button, does not throw it away.
    const draftKey = `overlap.draft.${event.id}`;
    const startName = existing?.name || account?.name || '';
    const startSlots = existing?.slots || emptyAnswer(slots.count);
    const readDraft = () => {
      try {
        const draft = JSON.parse(window.sessionStorage.getItem(draftKey));
        return draft && typeof draft.name === 'string' && isAnswer(draft.slots, slots.count) ? draft : null;
      } catch {
        return null;
      }
    };
    const clearDraft = () => { try { window.sessionStorage.removeItem(draftKey); } catch { /* nothing to clear */ } };
    const draft = event.open ? readDraft() : null;
    const restored = Boolean(draft && (draft.name !== startName || draft.slots !== startSlots));
    if (restored) bits = fromAnswer(draft.slots, slots.count);

    const name = field({
      label: 'Your name',
      control: h('input', { class: 'input', type: 'text', name: 'name', autocomplete: 'name', maxlength: NAME_MAX, required: true, value: restored ? draft.name.slice(0, NAME_MAX) : startName }),
    });
    const keepDraft = () => {
      try { window.sessionStorage.setItem(draftKey, JSON.stringify({ name: name.input.value, slots: toAnswer(bits) })); } catch { /* private mode: no draft */ }
    };
    name.input.addEventListener('input', () => { dirty = true; name.setError(''); keepDraft(); });

    const tally = h('p', { class: 'status-line nums', role: 'status' });
    const status = h('p', { class: 'status-line', role: 'status', tabindex: '-1' });
    const save = h('button', { type: 'submit', class: 'btn' }, 'Save my times');
    const clear = h('button', { type: 'button', class: 'btn btn-quiet btn-small' }, 'Clear');
    const remove = h('button', { type: 'button', class: 'linklike', hidden: !saved }, 'Remove my answer');
    const formError = h('p', { class: 'form-error', role: 'alert', hidden: true });

    const markedText = () => {
      const marked = bits.reduce((sum, b) => sum + b, 0);
      return marked ? `${duration(marked * event.slotMinutes)} marked` : 'Nothing marked yet';
    };
    const showTally = () => { tally.textContent = markedText(); };

    let zone;
    const describePreview = (preview) => {
      if (!preview) { showTally(); return; }
      const first = slotWall(event, slots, preview.firstIndex, zone);
      const last = slotWall(event, slots, preview.lastIndex, zone);
      const days = preview.days > 1 ? `${preview.days} days, ` : `${shortDate(first.date)}, `;
      tally.textContent = `${preview.adding ? 'Marking' : 'Clearing'} ${days}${timeLabel(first.startMinute)}–${timeLabel(last.endMinute)}`;
    };

    const chooser = zoneChooser({ event, slots, onChange: (next) => { zone = next; grid.setZone(next); } });
    zone = chooser.zone;

    const hintId = `grid-hint-${event.id}`;
    const keysId = `${hintId}-keys`;
    const grid = createPaintGrid({
      event, slots, zone, value: bits, readOnly: !event.open,
      label: `Times for ${event.title}. Mark the ones you are free.`,
      describedBy: event.open ? `${hintId} ${keysId}` : null,
      onChange: (next) => {
        bits = next;
        dirty = true;
        keepDraft();
        status.textContent = '';
        status.classList.remove('is-good');
        showTally();
      },
      onPreview: describePreview,
    });
    showTally();
    if (restored) {
      dirty = true;
      status.textContent = 'Not saved yet.';
    }

    clear.addEventListener('click', () => grid.clear());

    // Busy, not disabled: a disabled button would drop the keyboard focus it was pressed with.
    const busy = (on) => { setBusy(save, on); setBusy(remove, on); };

    const form = h('form', { class: 'stack', novalidate: true });
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (isBusy(save)) return;
      const cleaned = cleanName(name.input.value);
      if (!cleaned) {
        name.setError('Put in your name first.');
        name.input.focus();
        return;
      }
      formError.hidden = true;
      busy(true);
      status.classList.remove('is-good');
      status.textContent = 'Saving…';
      try {
        const slotsText = toAnswer(bits);
        await pause();
        savedAs = await saveMyAnswer(event, { name: cleaned, slots: slotsText }, savedAs);
        lastWriteAt = Date.now();
        saved = { name: cleaned, slots: slotsText };
        dirty = false;
        clearDraft();
        name.input.value = cleaned;
        remove.hidden = false;
        whose.textContent = `Saved from this browser as ${cleaned}. `;
        status.classList.add('is-good');
        status.textContent = 'Saved. You can change your times from this browser until the event is closed.';
      } catch (error) {
        status.textContent = '';
        formError.textContent = error.message;
        formError.hidden = false;
      } finally {
        busy(false);
      }
    });

    remove.addEventListener('click', async () => {
      if (removing || isBusy(remove)) return;
      const ok = await confirmDialog({
        title: 'Remove your answer?',
        body: 'Your name and times are deleted from this event.',
        confirmLabel: 'Remove my answer',
        danger: true,
      });
      if (!ok) return;
      // The database may make this wait a few seconds after a save. Say so, and do not let the
      // person leave thinking it is already done.
      removing = true;
      busy(true);
      formError.hidden = true;
      status.classList.remove('is-good');
      status.textContent = 'Removing…';
      try {
        await pause();
        await deleteMyAnswer(event, savedAs);
        savedAs = undefined;
        lastWriteAt = 0;
        saved = null;
        dirty = false;
        clearDraft();
        remove.hidden = true;
        someoneElse.hidden = true;
        bits = new Uint8Array(slots.count);
        grid.setValue(bits);
        showTally();
        if (!event.open) {
          // Nothing of theirs is left to show, and nothing new can be added.
          closedNote.textContent = 'This event is closed. No more answers.';
          closedSaved.hidden = true;
        }
        status.textContent = 'Answer removed.';
        status.focus(); // the button that was pressed is gone
      } catch (error) {
        status.textContent = '';
        formError.textContent = error.message;
        formError.hidden = false;
      } finally {
        removing = false;
        busy(false);
      }
    });

    // Guests are recognised by their browser. On a shared computer the next person would
    // otherwise be editing the first person's answer without realising.
    const whose = h('span', null, `Saved from this browser as ${existing?.name || ''}. `);
    const someoneElse = h('p', { class: 'banner banner-plain', hidden: !(existing && existing.as === 'guest') },
      whose,
      h('button', { type: 'button', class: 'linklike', onclick: startFresh }, 'Someone else? Add a separate answer'));
    async function startFresh() {
      const ok = await confirmDialog({
        title: 'Start a separate answer?',
        body: `${saved?.name || 'The first person'}’s answer is kept, but it can’t be changed from this browser any more. Only do this if you’re someone else.`,
        confirmLabel: 'Start a separate answer',
      });
      if (!ok) return;
      try {
        await forgetGuest();
        saved = null;
        savedAs = undefined;
        dirty = false;
        lastWriteAt = 0;
        clearDraft();
        bits = new Uint8Array(slots.count);
        grid.setValue(bits);
        name.input.value = '';
        remove.hidden = true;
        someoneElse.hidden = true;
        status.textContent = '';
        status.classList.remove('is-good');
        showTally();
        name.input.focus();
      } catch (error) {
        toast(error.message, { error: true });
      }
    }

    const warnOnLeave = (e) => { if (dirty || removing) { e.preventDefault(); e.returnValue = ''; } };
    window.addEventListener('beforeunload', warnOnLeave);

    const at = slots.utc[0];
    const head = h('div', { class: 'page-head' }, h('div', null,
      h('h1', null, event.title),
      h('p', null, eventSummary(event, at)),
      event.description ? h('p', { class: 'note-text' }, event.description) : null));

    // No wider than the timetable needs: a name box a metre long over a narrow grid looks lost.
    const width = { '--days': String(event.dates.length) };

    const organizerNote = runs
      ? h('div', { class: 'banner banner-plain' },
        h('p', null, event.open
          ? `${youRunIt} This is what your friends see. You can add your own times here too.`
          : `${youRunIt} This is what your friends see.`),
        h('a', { class: 'btn btn-quiet btn-small', href: `#/e/${event.id}/results` }, 'See the answers'))
      : null;

    if (!event.open) {
      // Closed: nothing can be added or changed, but what you saved is still yours to remove.
      closedNote = h('p', null, saved
        ? 'This event is closed. Your times can’t be changed now. Here’s what you saved.'
        : 'This event is closed. No more answers.');
      closedSaved = saved ? h('div', { class: 'stack' },
        h('div', { class: 'sheet stack' }, chooser.el, grid.el, h('div', { class: 'tt-foot' }, tally)),
        h('div', { class: 'row' }, remove)) : null;
      replace(holder, h('div', { class: 'stack invite', style: width },
        head, organizerNote,
        h('div', { class: 'banner' }, closedNote),
        closedSaved,
        formError, status));
    } else {
      replace(form,
        organizerNote,
        someoneElse,
        h('div', { class: 'sheet stack' },
          name.el,
          chooser.el,
          h('p', { class: 'muted', id: hintId }, touchFirst()
            ? 'Tap the times you’re free. To mark several, press and hold, then drag.'
            : 'Click or drag over the times you’re free. Do it again to clear.'),
          // Always in the page, so the grid is described by it; shown once the grid is being
          // used from the keyboard (see .keys in the stylesheet).
          h('p', { class: 'keys muted small', id: keysId }, 'Keyboard: arrows move, Space marks or clears, Shift+arrow carries the mark along.'),
          grid.el,
          h('div', { class: 'tt-foot' }, tally, clear)),
        formError,
        h('div', { class: 'row' }, save, remove),
        status,
        h('p', { class: 'muted small' }, 'Only whoever runs this event sees your name and times.'));
      replace(holder, h('div', { class: 'stack invite', style: width }, head, form));
    }

    return () => {
      window.removeEventListener('beforeunload', warnOnLeave);
      grid.destroy();
    };
  }

  load();

  return {
    title: 'Event',
    el: holder,
    dispose: () => { disposed = true; if (cleanup) cleanup(); },
  };
}
