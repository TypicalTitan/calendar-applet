// Create an event: a name, the days, a daily time window, a slot length and a time zone.

import { h, field, uid, toast } from '../ui/dom.js';
import { createDatePicker } from '../ui/calendar.js';
import { createEvent, getAccount } from '../backend.js';
import { verifyPanel } from './verify.js';
import { validateEvent, endMinuteFor, LIMITS } from '../core/validate.js';
import { listTimeZones, localTimeZone } from '../core/tz.js';
import { todayIn, addDays } from '../core/dates.js';
import { timeLabel, zoneLabel, plural, duration, daysSummary } from '../ui/format.js';

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
    hint: 'Invitees see this at the top of the page, for example “Board game weekend”.',
  });
  const note = field({
    label: 'Note for invitees',
    optional: true,
    control: h('textarea', { class: 'textarea', name: 'description', maxlength: LIMITS.descriptionMax, rows: 3 }),
  });

  const picker = createDatePicker({
    min: today, max: addDays(today, 365), limit: LIMITS.maxDays, label: 'Days',
    onChange: (next) => { dates = next; datesError.hidden = true; summarize(); },
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
  const overnight = h('span', { class: 'hint', hidden: true }, 'The end is earlier than the start, so each day’s window runs past midnight into the next day.');

  const slotName = uid('slot');
  const slot = h('div', { class: 'segmented', role: 'radiogroup', 'aria-labelledby': `${slotName}-label` },
    SLOT_CHOICES.map(([minutes, text]) => h('label', null,
      h('input', { type: 'radio', name: slotName, value: String(minutes), checked: minutes === 30 }), text)));
  const slotMinutes = () => Number(slot.querySelector('input:checked').value);

  const zones = listTimeZones().filter((z) => !z.startsWith('Etc/') || z === zone);
  const zoneSelect = h('select', { class: 'select', name: 'timezone' },
    zones.map((z) => h('option', { value: z, selected: z === zone }, zoneLabel(z))));
  const zoneField = field({ label: 'Time zone', control: zoneSelect, hint: 'The window above is in this time zone. Invitees elsewhere see it converted to theirs.' });

  const summary = h('p', { class: 'status-line', 'aria-live': 'polite' });
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

  function summarize() {
    const input = read();
    overnight.hidden = Number(to.value) > input.startMinute;
    const length = input.endMinute - input.startMinute;
    if (dates.length === 0) { summary.textContent = ''; return; }
    if (length % input.slotMinutes !== 0) { summary.textContent = ''; return; }
    const perDay = length / input.slotMinutes;
    summary.textContent = `${daysSummary(dates)}, ${duration(length)} a day: ${plural(perDay * dates.length, 'time slot', 'time slots')} for people to mark.`;
  }

  for (const control of [from, to, zoneSelect]) control.addEventListener('change', () => { timeError.hidden = true; summarize(); });
  slot.addEventListener('change', () => { timeError.hidden = true; summarize(); });

  const form = h('form', { class: 'stack stack-l', novalidate: true },
    h('div', { class: 'sheet stack' }, title.el, note.el),
    h('fieldset', { class: 'sheet stack' },
      h('legend', { class: 'legend', id: datesLabel }, 'Days'),
      h('p', { class: 'muted small' }, 'Click a day to add it. Drag, or Shift+click, to add several.'),
      picker.el, datesError),
    h('fieldset', { class: 'sheet stack' },
      h('legend', { class: 'legend' }, 'Time each day'),
      h('div', { class: 'pair' }, fromField.el, toField.el),
      overnight,
      h('div', { class: 'field' },
        h('span', { class: 'label', id: `${slotName}-label` }, 'Slot length'),
        slot,
        h('span', { class: 'hint' }, 'How finely people mark their time. Shorter slots mean more precision and more tapping.')),
      timeError,
      zoneField.el),
    summary, error,
    h('div', { class: 'row' }, submit, h('a', { class: 'btn btn-quiet', href: '#/events' }, 'Cancel')));

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (submit.disabled) return;
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
    submit.disabled = true;
    try {
      const id = await createEvent(checked.value);
      toast('Event created');
      navigate(`/e/${id}/results`);
    } catch (err) {
      error.textContent = err.message;
      error.hidden = false;
      submit.disabled = false;
    }
  });

  summarize();

  return {
    title: 'New event',
    narrow: true,
    el: h('div', { class: 'stack' },
      h('div', { class: 'page-head' }, h('div', null,
        h('h1', null, 'New event'),
        h('p', null, 'Choose the days and hours you’re considering. You’ll get a link to send; everyone marks when they’re free.'))),
      form),
  };
}
