// The invite page: anyone with the link types a name and marks the times they are free.

import { h, replace, field, toast, confirmDialog } from '../ui/dom.js';
import { createPaintGrid } from '../ui/grid.js';
import { zoneChooser } from '../ui/zone.js';
import { getEvent, getMyAnswer, saveMyAnswer, deleteMyAnswer, getUser, getAccount, signOut } from '../backend.js';
import { buildSlots, slotWall } from '../core/slots.js';
import { cleanName, fromAnswer, toAnswer, NAME_MAX } from '../core/availability.js';
import { duration, eventSummary, shortDate, timeLabel } from '../ui/format.js';
import { messageView } from './misc.js';

export function respondView({ params }) {
  const [eventId] = params;
  const holder = h('div', null, h('p', { class: 'loading', role: 'status' }, 'Loading the event…'));
  const page = { title: 'Event', el: holder, dispose: null };
  let disposed = false;

  getEvent(eventId).then(async (event) => {
    if (disposed) return;
    if (!event) {
      replace(holder, messageView({
        title: 'We can’t find that event',
        body: 'The link may be cut short, or the organizer may have deleted the event. Ask them to send the link again.',
      }).el);
      return;
    }
    if (event === 'damaged') {
      replace(holder, messageView({
        title: 'This event can’t be shown',
        body: 'Its details are not in a form this site understands. Ask the organizer to create it again.',
      }).el);
      return;
    }
    document.title = `${event.title} · ${document.title.split(' · ').pop()}`;
    const mine = getUser() ? await getMyAnswer(event).catch(() => null) : null;
    if (disposed) return;
    page.dispose = build(event, mine);
  }).catch((error) => {
    if (!disposed) replace(holder, h('p', { class: 'banner banner-danger', role: 'alert' }, error.message));
  });

  function build(event, existing) {
    const slots = buildSlots(event);
    const account = getAccount();
    const isOrganizer = account && account.uid === event.ownerUid;
    let saved = existing;                         // what is stored, or null
    let bits = fromAnswer(existing?.slots, slots.count);
    let dirty = false;

    const name = field({
      label: 'Your name',
      control: h('input', { class: 'input', type: 'text', name: 'name', autocomplete: 'name', maxlength: NAME_MAX, required: true, value: existing?.name || account?.name || '' }),
      hint: 'So the organizer knows whose times these are.',
    });
    name.input.addEventListener('input', () => { dirty = true; name.setError(''); });

    const tally = h('p', { class: 'status-line nums' });
    const status = h('p', { class: 'status-line', role: 'status' });
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

    const grid = createPaintGrid({
      event, slots, zone, value: bits, readOnly: !event.open,
      label: `Times for ${event.title}. Mark the ones you are free.`,
      onChange: (next) => { bits = next; dirty = true; status.textContent = ''; status.classList.remove('is-good'); showTally(); },
      onPreview: describePreview,
    });
    showTally();

    clear.addEventListener('click', () => grid.clear());

    const form = h('form', { class: 'stack', novalidate: true });
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (save.disabled) return;
      const cleaned = cleanName(name.input.value);
      if (!cleaned) {
        name.setError('Enter your name so the organizer knows who you are.');
        name.input.focus();
        return;
      }
      formError.hidden = true;
      save.disabled = true;
      status.classList.remove('is-good');
      status.textContent = 'Saving…';
      try {
        const slotsText = toAnswer(bits);
        await saveMyAnswer(event, { name: cleaned, slots: slotsText });
        saved = { name: cleaned, slots: slotsText };
        dirty = false;
        name.input.value = cleaned;
        remove.hidden = false;
        status.classList.add('is-good');
        status.textContent = `Saved. Thanks, ${cleaned}. You can change your times from this browser until the organizer closes the event.`;
      } catch (error) {
        status.textContent = '';
        formError.textContent = error.message;
        formError.hidden = false;
      } finally {
        save.disabled = false;
      }
    });

    remove.addEventListener('click', async () => {
      const ok = await confirmDialog({
        title: 'Remove your answer?',
        body: 'The organizer will no longer see your name or times for this event.',
        confirmLabel: 'Remove my answer',
        danger: true,
      });
      if (!ok) return;
      try {
        await deleteMyAnswer(event);
        saved = null;
        dirty = false;
        remove.hidden = true;
        grid.setValue(new Uint8Array(slots.count));
        bits = new Uint8Array(slots.count);
        showTally();
        status.classList.remove('is-good');
        status.textContent = 'Your answer has been removed.';
        toast('Answer removed');
      } catch (error) {
        toast(error.message);
      }
    });

    // Guests are recognised by their browser. On a shared computer the next person would
    // otherwise be editing the first person's answer without realising.
    const someoneElse = h('p', { class: 'banner banner-plain', hidden: !(existing && getUser()?.guest) },
      h('span', null, `These are the times saved from this browser as ${existing?.name || ''}. `),
      h('button', { type: 'button', class: 'linklike', onclick: startFresh }, 'Someone else? Add a separate answer'));
    async function startFresh() {
      try {
        await signOut();
        saved = null;
        dirty = false;
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
        toast(error.message);
      }
    }

    const warnOnLeave = (e) => { if (dirty) { e.preventDefault(); e.returnValue = ''; } };
    window.addEventListener('beforeunload', warnOnLeave);

    const at = slots.utc[0];
    const head = h('div', { class: 'page-head' }, h('div', null,
      h('h1', null, event.title),
      h('p', null, eventSummary(event, at)),
      event.description ? h('p', { class: 'note-text' }, event.description) : null));

    const organizerNote = isOrganizer
      ? h('div', { class: 'banner banner-plain' },
        h('p', null, 'You organized this event. This is the page your invitees see; you can add your own times here too.'),
        h('a', { class: 'btn btn-quiet btn-small', href: `#/e/${event.id}/results` }, 'See the answers'))
      : null;

    if (!event.open) {
      replace(holder, h('div', { class: 'stack' },
        head, organizerNote,
        h('div', { class: 'banner', role: 'status' },
          h('p', null, saved
            ? 'This event is closed. The organizer isn’t taking changes any more; here is what you saved.'
            : 'This event is closed. The organizer isn’t taking new answers.')),
        saved ? h('div', { class: 'sheet stack' }, chooser.el, grid.el, h('div', { class: 'tt-foot' }, tally)) : null));
    } else {
      replace(form,
        organizerNote,
        someoneElse,
        h('div', { class: 'sheet stack' },
          name.el,
          chooser.el,
          h('p', { class: 'muted' }, navigator.maxTouchPoints > 0
            ? 'Tap a time to mark it. To mark several at once, press and hold, then drag. With a mouse, just drag.'
            : 'Drag across the times you’re free. Start a drag on a marked time to clear instead.'),
          grid.el,
          h('div', { class: 'tt-foot' }, tally, clear)),
        formError,
        h('div', { class: 'row' }, save, remove),
        status);
      replace(holder, h('div', { class: 'stack' }, head, form));
    }

    return () => {
      window.removeEventListener('beforeunload', warnOnLeave);
      grid.destroy();
    };
  }

  return {
    title: page.title,
    el: holder,
    dispose: () => { disposed = true; if (page.dispose) page.dispose(); },
  };
}
