// Calendar-date helpers. A date is always the string "YYYY-MM-DD" with no time and no zone.

import { parseDate, utcToWall } from './tz.js';

const DAY = 86400000;
const pad = (n) => String(n).padStart(2, '0');

function toUtc(date) {
  const { year, month, day } = parseDate(date);
  return Date.UTC(year, month - 1, day);
}

function fromUtc(ms) {
  const d = new Date(ms);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

/** True for a string naming a day that really exists. */
export function isDateString(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  return fromUtc(toUtc(value)) === value;
}

export function addDays(date, days) {
  return fromUtc(toUtc(date) + days * DAY);
}

/** 0 = Sunday ... 6 = Saturday. */
export function weekdayOf(date) {
  return new Date(toUtc(date)).getUTCDay();
}

/** Whole days from `from` to `to`; negative when `to` is earlier. */
export function daysBetween(from, to) {
  return Math.round((toUtc(to) - toUtc(from)) / DAY);
}

/** Every date from one end to the other, inclusive, earliest first. */
export function dateRange(a, b) {
  const [first, last] = a <= b ? [a, b] : [b, a];
  const out = [];
  for (let d = first; d <= last; d = addDays(d, 1)) out.push(d);
  return out;
}

/**
 * A month as rows of seven cells. Cells outside the month are null.
 * `month` is 1-12; `weekStart` is the weekday of the first column (0 = Sunday).
 */
export function monthMatrix(year, month, weekStart = 0) {
  const first = `${year}-${pad(month)}-01`;
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const lead = (weekdayOf(first) - weekStart + 7) % 7;
  const cells = Array(lead).fill(null);
  for (let day = 1; day <= daysInMonth; day++) cells.push(`${year}-${pad(month)}-${pad(day)}`);
  while (cells.length % 7) cells.push(null);
  const weeks = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
  return weeks;
}

/** The calendar date in a zone, now or at a given instant. */
export function todayIn(timeZone, now = Date.now()) {
  return utcToWall(now, timeZone).date;
}

/** A Date at midnight UTC of the given day, for handing to Intl with timeZone "UTC". */
export function dateForFormatting(date) {
  return new Date(toUtc(date));
}
