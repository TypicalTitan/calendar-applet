// Checks an event before it is saved. The database rules enforce the same limits on the server;
// this copy exists so the form can explain a problem instead of showing a refused write.

import { isValidTimeZone } from './tz.js';
import { isDateString } from './dates.js';
import { tidyLine, tidyText, looksBlank } from './text.js';
import { plausibleDayStarts } from './slots.js';

export const LIMITS = Object.freeze({
  titleMax: 100,
  descriptionMax: 500,
  maxDays: 31,
  slotLengths: Object.freeze([15, 30, 60]),
});

/**
 * A form offers the end of the window as a time of day. An end at or before the start means the
 * window runs into the following day.
 */
export function endMinuteFor(startMinute, endOfDayMinute) {
  return endOfDayMinute > startMinute ? endOfDayMinute : endOfDayMinute + 1440;
}

/**
 * Returns { ok, errors, value }.
 * `errors` maps a field (title, description, timezone, dates, time) to a message for the person.
 * `value` is the tidied event, with days sorted and `slotCount` filled in, when ok.
 */
export function validateEvent(input) {
  const errors = {};

  const title = tidyLine(input.title);
  if (title === '' || looksBlank(title)) errors.title = 'Give the event a name.';
  else if (title.length > LIMITS.titleMax) errors.title = `Keep the name to ${LIMITS.titleMax} characters or fewer.`;

  const description = tidyText(input.description ?? '');
  if (description.length > LIMITS.descriptionMax) {
    errors.description = `Keep the note to ${LIMITS.descriptionMax} characters or fewer.`;
  }

  if (!isValidTimeZone(input.timezone)) errors.timezone = 'Choose a time zone from the list.';

  let dates = [];
  if (!Array.isArray(input.dates) || input.dates.length === 0) {
    errors.dates = 'Pick at least one day.';
  } else if (!input.dates.every(isDateString)) {
    errors.dates = 'One of the days is not a real date.';
  } else {
    dates = [...new Set(input.dates)].sort();
    if (dates.length > LIMITS.maxDays) errors.dates = `Pick ${LIMITS.maxDays} days or fewer.`;
  }

  const { startMinute, endMinute, slotMinutes } = input;
  if (!LIMITS.slotLengths.includes(slotMinutes)) {
    errors.time = 'Pick a block size from the list.';
  } else if (!Number.isInteger(startMinute) || !Number.isInteger(endMinute)) {
    errors.time = 'Choose a start and end time.';
  } else if (startMinute < 0 || startMinute >= 1440 || startMinute % 15 !== 0) {
    errors.time = 'Choose a start time from the list.';
  } else if (endMinute <= startMinute) {
    errors.time = 'The end time must be after the start time.';
  } else if (endMinute - startMinute > 1440) {
    errors.time = 'A day can be at most 24 hours.';
  } else if ((endMinute - startMinute) % slotMinutes !== 0) {
    errors.time = `From and To must be a whole number of ${slotMinutes}-minute blocks apart.`;
  }

  const ok = Object.keys(errors).length === 0;
  const value = ok
    ? {
        title, description, timezone: input.timezone, dates, startMinute, endMinute, slotMinutes,
        slotCount: dates.length * ((endMinute - startMinute) / slotMinutes),
      }
    : null;
  return { ok, errors, value };
}

/**
 * Checks an event read from the database before any page uses it. The rules stop most bad data,
 * but they cannot check everything (real dates, day order), and an event is written by its
 * organizer's browser, which an invitee has no reason to trust.
 * Returns the event with its `id`, or null if it is not well formed.
 *
 * Two things are forgiven rather than treated as damage. A name or note that is not quite tidy
 * is tidied. And a time zone this browser has never heard of (zones are added every year, and
 * the organizer's browser may be newer) is kept, with `zoneKnown: false`: the stored start
 * instants are enough to show the grid in the reader's own zone.
 */
export function parseEvent(id, data) {
  if (!data || typeof data !== 'object') return null;
  const zoneKnown = isValidTimeZone(data.timezone);
  if (!zoneKnown && !(typeof data.timezone === 'string' && /^[A-Za-z][A-Za-z0-9_+/-]{0,63}$/.test(data.timezone))) return null;
  const checked = validateEvent(zoneKnown ? data : { ...data, timezone: 'UTC' });
  if (!checked.ok) return null;
  const v = checked.value;
  // Stored days are already sorted and free of repeats; anything else was not written by this site.
  if (v.dates.length !== data.dates.length || v.dates.some((date, i) => date !== data.dates[i])) return null;
  if (data.slotCount !== v.slotCount) return null;
  if (typeof data.ownerUid !== 'string' || data.ownerUid === '') return null;
  if (typeof data.open !== 'boolean') return null;
  const event = {
    ...v,
    timezone: data.timezone,
    zoneKnown,
    id,
    ownerUid: data.ownerUid,
    open: data.open,
    dayStarts: data.dayStarts,
    createdAt: Number.isFinite(data.createdAt) ? data.createdAt : null,
    updatedAt: Number.isFinite(data.updatedAt) ? data.updatedAt : null,
  };
  return plausibleDayStarts(event) ? event : null;
}
