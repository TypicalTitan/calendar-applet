// The slot model.
//
// An event is a set of days, a daily window and a slot length, all in the event's own time zone:
//   { timezone, dates: ["YYYY-MM-DD", ...], startMinute, endMinute, slotMinutes, dayStarts }
// `endMinute` may run past 1440 for a window that crosses midnight (20:00-02:00 is 1200-1560).
//
// `dayStarts` holds the instant each day's window opens, in whole minutes since 1970 (UTC). It
// is worked out once, by the organizer's browser, and stored with the event. Browsers do not
// always agree on a zone's rules (several regions changed theirs in 2026), so everyone reads the
// stored instants instead of redoing the sum.
//
// Slots are numbered day by day: index = day * slotsPerDay + k, and slot k of a day starts
// k * slotMinutes of real time after that day's start. An answer is one character per slot.

import { wallToUtc, utcToWall, offsetMinutesAt } from './tz.js';
import { addDays, daysBetween } from './dates.js';

const MINUTE = 60000;
const DAY_MINUTES = 1440;

export function slotsPerDay(event) {
  return (event.endMinute - event.startMinute) / event.slotMinutes;
}

export function slotCount(event) {
  return event.dates.length * slotsPerDay(event);
}

/**
 * The instant each day's window opens. A start time that a clock change skips is moved forward
 * to the next time that really happens.
 */
export function computeDayStarts(event) {
  return event.dates.map((date) => wallToUtc(date, event.startMinute, event.timezone).utc / MINUTE);
}

/** The start instants as they are stored: eight-digit numbers joined with commas. */
export function encodeDayStarts(starts) {
  return starts.join(',');
}

/** The stored string back to numbers, or null if it is not in exactly that form. */
export function decodeDayStarts(text) {
  if (typeof text !== 'string' || !/^\d{8}(,\d{8})*$/.test(text)) return null;
  return text.split(',').map(Number);
}

/**
 * Checks start instants read from the database: one whole number per day, in order, each within
 * a time zone's reach of the day it belongs to. Anything else is treated as a damaged event.
 */
export function plausibleDayStarts(event) {
  const { dayStarts, dates } = event;
  if (!Array.isArray(dayStarts) || dayStarts.length !== dates.length) return false;
  for (let d = 0; d < dates.length; d++) {
    const stored = dayStarts[d];
    if (!Number.isInteger(stored)) return false;
    const naive = Date.parse(`${dates[d]}T00:00:00Z`) / MINUTE + event.startMinute;
    if (Math.abs(stored - naive) > 16 * 60) return false;
    if (d > 0 && stored <= dayStarts[d - 1]) return false;
  }
  return true;
}

/** The instant every slot starts. Uses the stored `dayStarts` when the event has them. */
export function buildSlots(event) {
  const perDay = slotsPerDay(event);
  const starts = event.dayStarts ?? computeDayStarts(event);
  const utc = [];
  for (const start of starts) {
    for (let k = 0; k < perDay; k++) utc.push((start + k * event.slotMinutes) * MINUTE);
  }
  return { perDay, count: utc.length, utc };
}

function mostCommon(values) {
  const tally = new Map();
  let best = values[0];
  for (const v of values) {
    const n = (tally.get(v) || 0) + 1;
    tally.set(v, n);
    if (n > tally.get(best)) best = v;
  }
  return best;
}

/**
 * Labels for showing the grid in `displayZone`. The grid always has one column per event day
 * and one row per slot of the window; only the labels depend on the zone.
 *
 * rows[k]: { k, minute, dayOffset, labelled }
 *   minute      local minutes after midnight
 *   dayOffset   1 when the row falls on the day after the column's date
 *   labelled    whether to print the time beside this row
 * columns[d]: { day, date, lastDate, shifts }
 *   date        the local date the row labels count from
 *   lastDate    the local date of the column's last slot
 *   shifts      where this column's real local time departs from the row labels:
 *               [{ k, minutes }] means "from row k on, add `minutes` to the label".
 *               Empty for nearly every column. It fills in when a clock change falls inside the
 *               window, or when the event zone and the display zone change clocks on different
 *               days.
 */
export function describeGrid(event, slots, displayZone) {
  const { perDay } = slots;
  const dayCount = event.dates.length;

  // Each slot's local time, counted in minutes from midnight of its column's first local date.
  const anchors = [];
  const offsets = [];
  const lastDates = [];
  for (let d = 0; d < dayCount; d++) {
    const first = utcToWall(slots.utc[d * perDay], displayZone);
    const column = [];
    let wall = first;
    for (let k = 0; k < perDay; k++) {
      wall = utcToWall(slots.utc[d * perDay + k], displayZone);
      column.push(wall.minute + daysBetween(first.date, wall.date) * DAY_MINUTES);
    }
    anchors.push(first.date);
    offsets.push(column);
    lastDates.push(wall.date);
  }

  const labels = [];
  for (let k = 0; k < perDay; k++) labels.push(mostCommon(offsets.map((column) => column[k])));
  // A row gets a visible label once an hour, counted from the first row. (Counting from the
  // clock instead would leave a viewer whose zone is 15 or 45 minutes off with no labels at all.)
  const rows = labels.map((label, k) => ({
    k,
    minute: label % DAY_MINUTES,
    dayOffset: Math.floor(label / DAY_MINUTES),
    labelled: (k * event.slotMinutes) % 60 === 0,
  }));

  const columns = [];
  for (let d = 0; d < dayCount; d++) {
    // A column that starts just after midnight while the labels start just before it (or the
    // reverse) belongs to the neighbouring date; move its anchor so shifts stay small.
    const wholeDays = perDay > 0 ? Math.round((offsets[d][0] - labels[0]) / DAY_MINUTES) : 0;
    const shifts = [];
    let current = 0;
    for (let k = 0; k < perDay; k++) {
      const shift = offsets[d][k] - wholeDays * DAY_MINUTES - labels[k];
      if (shift !== current) shifts.push({ k, minutes: shift });
      current = shift;
    }
    columns.push({
      day: d,
      date: perDay > 0 ? addDays(anchors[d], wholeDays) : event.dates[d],
      lastDate: perDay > 0 ? lastDates[d] : event.dates[d],
      shifts,
    });
  }

  return { columns, rows };
}

/** The exact local start and end of one slot, for tooltips, the table view and exports. */
export function slotWall(event, slots, index, displayZone) {
  const start = utcToWall(slots.utc[index], displayZone);
  const end = utcToWall(slots.utc[index] + event.slotMinutes * MINUTE, displayZone);
  return {
    date: start.date,
    weekday: start.weekday,
    startMinute: start.minute,
    endMinute: end.minute > start.minute ? end.minute : end.minute + DAY_MINUTES,
  };
}

/** True when two zones show the same clock time throughout the event. */
export function sameClock(slots, zoneA, zoneB) {
  if (zoneA === zoneB) return true;
  // Every slot is checked: two zones can agree at both ends of a night and differ in between.
  for (const instant of slots.utc) {
    if (offsetMinutesAt(instant, zoneA) !== offsetMinutesAt(instant, zoneB)) return false;
  }
  return true;
}
