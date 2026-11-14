// Create an event: a name, the days, the hours each day, the size of the blocks, and a time zone.

import { h, field, uid, touchFirst, setBusy, isBusy } from '../ui/dom.js';
import { createDatePicker } from '../ui/calendar.js';
import { createEvent, getAccount } from '../backend.js';
import { verifyPanel } from './verify.js';
import { validateEvent, endMinuteFor, LIMITS } from '../core/validate.js';
import { listTimeZones, localTimeZone } from '../core/tz.js';
import { todayIn, addDays } from '../core/dates.js';
import { timeLabel, zoneLabel } from '../ui/format.js';

const SLOT_CHOICES = [[15, '15 minutes'], [30, '30 minutes'], [60, '1 hour']];

export function newEventView({ navigate }) {
  const account = getAccount();
  if (!account.verified) {
    const panel = verifyPanel(account, () => navigate('/new'));
    return {
      title: 'New event',
      narrow: true,
      dispose: panel.dispose,
      el: h('div', { class: 'stack' }, h('div', { class: 'page-head' }, h('h1', null, 'New event')), panel.el),
    };
  }
  const zone = localTimeZone();
  const today = todayIn(zone);
  let dates = [];

  const title = field({
    label: 'Event name',
    control: h('input', { class: 'input', type: 'text', name: 'title', maxlength: LIMITS.titleMax, required: true, autocomplete: 'off' }),
    hint: 'For example, Board game weekend.',
  });
  const note = field({
    label: 'Note',
    optional: true,
    control: h('textarea', { class: 'textarea', name: 'description', maxlength: LIMITS.descriptionMax, rows: 3 }),
    hint: 'Your friends see it under the name.',
  });

  const keysId = uid('day-keys');
  const picker = createDatePicker({
    min: today, max: addDays(today, 365), limit: LIMITS.maxDays, label: 'Days', describedBy: keysId,
    onChange: (next) => { dates = next; datesError.hidden = true; },
  });
  const datesLabel = uid('days');
  const datesError = h('span', { class: 'error', role: 'alert', hidden: true });

  const timeOptions = (from, to) => {
    const options = [];
    for (let m = from; m <= to; m += 30) options.push(h('option', { value: String(m) }, m === 1440 ? `${timeLabel(0)} (midnight)` : timeLabel(m)));
    return options;
  };
  const from = h('select', { class: 'select', name: 'from' }, timeOptions(0, 1410));
  const to = h('select', { class: 'select', name: 'to' }, timeOptions(30, 1440));
  from.value = '540';
  to.value = '1020';
  const fromField = field({ label: 'From', control: from });
  const toField = field({ label: 'To', control: to });
  const timeError = h('span', { class: 'error', role: 'alert', hidden: true });
  // Always in the page, so that filling it in is read out; it takes no room while it is empty.
  const overnight = h('span', { class: 'hint', role: 'status' });

  const slotName = uid('slot');
  const slot = h('div', { class: 'segmented', role: 'radiogroup', 'aria-labelledby': `${slotName}-label` },
    SLOT_CHOICES.map(([minutes, text]) => h('label', null,
      h('input', { type: 'radio', name: slotName, value: String(minutes), checked: minutes === 30 }), text)));
  const slotMinutes = () => Number(slot.querySelector('input:checked').value);

  const zones = listTimeZones().filter((z) => !z.startsWith('Etc/') || z === zone);
  const zoneSelect = h('select', { class: 'select', name: 'timezone' },
    zones.map((z) => h('option', { value: z, selected: z === zone }, zoneLabel(z))));
  const zoneField = field({ label: 'Time zone', control: zoneSelect, hint: 'Friends in other time zones see their own times.' });

  const error = h('p', { class: 'form-error', role: 'alert', hidden: true });
  const submit = h('button', { type: 'submit', class: 'btn' }, 'Create event');

  function read() {
    const startMinute = Number(from.value);
    return {
      title: title.input.value,
      description: note.input.value,
      timezone: zoneSelect.value,
      dates,
      startMinute,
      endMinute: endMinuteFor(startMinute, Number(to.value)),
      slotMinutes: slotMinutes(),
    };
  }

  // An end at or before the start means each day runs past midnight. Say so when that is picked.
  const noteOvernight = () => {
    overnight.textContent = Number(to.value) > Number(from.value) ? '' : 'The end is before the start, so each day runs past midnight.';
  };

  for (const control of [from, to, zoneSelect]) control.addEventListener('change', () => { timeError.hidden = true; noteOvernight(); });
  slot.addEventListener('change', () => { timeError.hidden = true; });

  const form = h('form', { class: 'stack stack-l', novalidate: true },
    h('div', { class: 'stack' }, title.el, note.el),
    h('fieldset', { class: 'part stack' },
      h('legend', { class: 'legend', id: datesLabel }, 'Days'),
      h('p', { class: 'muted small' }, touchFirst() ? 'Tap the days you want.' : 'Click the days you want. Drag to add several.'),
      // Shown once the calendar is being used from the keyboard (see .keys in the stylesheet).
      h('p', { class: 'keys muted small', id: keysId }, 'Keyboard: arrows move, Space picks a day, Shift+Space picks a run, Page Up and Page Down change month.'),
      picker.el, datesError),
    h('fieldset', { class: 'part stack' },
      h('legend', { class: 'legend' }, 'Time each day'),
      h('div', { class: 'pair' }, fromField.el, toField.el),
      overnight,
      h('div', { class: 'field' },
        h('span', { class: 'label', id: `${slotName}-label` }, 'In blocks of'),
        slot,
        h('span', { class: 'hint' }, 'Smaller blocks mean more tapping.')),
      timeError,
      zoneField.el),
    error,
    h('div', { class: 'row' }, submit, h('a', { class: 'btn btn-quiet', href: '#/events' }, 'Cancel')));

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (isBusy(submit)) return;
    const checked = validateEvent(read());
    title.setError(checked.errors.title || '');
    note.setError(checked.errors.description || '');
    zoneField.setError(checked.errors.timezone || '');
    datesError.hidden = !checked.errors.dates;
    datesError.textContent = checked.errors.dates || '';
    timeError.hidden = !checked.errors.time;
    timeError.textContent = checked.errors.time || '';
    error.hidden = true;
    if (!checked.ok) {
      const first = checked.errors.title ? title.input
        : checked.errors.description ? note.input
          : checked.errors.dates ? picker.el.querySelector('[tabindex="0"]')
            : checked.errors.time ? from : zoneSelect;
      first?.focus();
      return;
    }
    setBusy(submit, true);
    try {
      const id = await createEvent(checked.value);
      navigate(`/e/${id}/results`);
    } catch (err) {
      error.textContent = err.message;
      error.hidden = false;
      setBusy(submit, false);
    }
  });

  noteOvernight();

  return {
    title: 'New event',
    narrow: true,
    el: h('div', { class: 'stack' },
      h('div', { class: 'page-head' }, h('div', null,
        h('h1', null, 'New event'),
        h('p', null, 'Pick the days and hours. You get a link to send.'))),
      form),
  };
}
