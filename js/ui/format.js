// Turning dates, times and counts into words, in the reader's own language settings.

import { dateForFormatting, daysBetween } from '../core/dates.js';
import { offsetMinutesAt } from '../core/tz.js';

const locale = typeof navigator !== 'undefined' && navigator.language ? navigator.language : undefined;
const cache = new Map();

function fmt(options) {
  const key = JSON.stringify(options);
  let f = cache.get(key);
  if (!f) {
    f = new Intl.DateTimeFormat(locale, { ...options, timeZone: 'UTC' });
    cache.set(key, f);
  }
  return f;
}

const atMinute = (minute) => new Date(Date.UTC(2020, 0, 1, 0, minute));

/** "9:00 AM" or "09:00", whichever the reader's locale uses. */
export function timeLabel(minute) {
  return fmt({ hour: 'numeric', minute: '2-digit' }).format(atMinute(minute % 1440));
}

/** "9 AM" for a whole hour, otherwise the full time. Used for the grid's row labels. */
export function hourLabel(minute) {
  return minute % 60 === 0 ? fmt({ hour: 'numeric' }).format(atMinute(minute % 1440)) : timeLabel(minute);
}

export function timeRange(startMinute, endMinute) {
  return `${timeLabel(startMinute)}–${timeLabel(endMinute)}`;
}

/** "Saturday, November 21" */
export function longDate(date) {
  return fmt({ weekday: 'long', month: 'long', day: 'numeric' }).format(dateForFormatting(date));
}

/** "Saturday, November 21, 2026" */
export function fullDate(date) {
  return fmt({ weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }).format(dateForFormatting(date));
}

/** "Sat, Nov 21" */
export function shortDate(date) {
  return fmt({ weekday: 'short', month: 'short', day: 'numeric' }).format(dateForFormatting(date));
}

export const weekdayShort = (date) => fmt({ weekday: 'short' }).format(dateForFormatting(date));
export const dayNumber = (date) => fmt({ day: 'numeric' }).format(dateForFormatting(date));
export const monthShort = (date) => fmt({ month: 'short' }).format(dateForFormatting(date));
export const monthYear = (year, month) => fmt({ month: 'long', year: 'numeric' }).format(new Date(Date.UTC(year, month - 1, 1)));

/** Names of the weekdays for a calendar header, starting from `weekStart` (0 = Sunday). */
export function weekdayNames(weekStart) {
  return Array.from({ length: 7 }, (_, i) => {
    const date = new Date(Date.UTC(2023, 0, 1 + ((weekStart + i) % 7))); // 1 Jan 2023 was a Sunday
    return { short: fmt({ weekday: 'short' }).format(date), long: fmt({ weekday: 'long' }).format(date) };
  });
}

/** The first day of the week where the reader lives (0 = Sunday ... 6 = Saturday). */
export function weekStart() {
  try {
    const info = new Intl.Locale(locale || 'en-US');
    const first = (info.getWeekInfo ? info.getWeekInfo() : info.weekInfo)?.firstDay;
    if (first >= 1 && first <= 7) return first % 7;
  } catch { /* fall through */ }
  return 0;
}

/** "Sat, Nov 21 to Mon, Nov 23", or a count when the days are not consecutive. */
export function daysSummary(dates) {
  if (dates.length === 0) return 'No days picked yet';
  if (dates.length === 1) return shortDate(dates[0]);
  const first = dates[0];
  const last = dates[dates.length - 1];
  const consecutive = daysBetween(first, last) === dates.length - 1;
  return consecutive
    ? `${shortDate(first)} to ${shortDate(last)}`
    : `${dates.length} days between ${shortDate(first)} and ${shortDate(last)}`;
}

export function plural(count, one, many) {
  return `${count} ${count === 1 ? one : many}`;
}

/** "6 hours", "1 hour 30 minutes", "45 minutes" */
export function duration(minutes) {
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  const parts = [];
  if (hours) parts.push(plural(hours, 'hour', 'hours'));
  if (rest || !hours) parts.push(plural(rest, 'minute', 'minutes'));
  return parts.join(' ');
}

/** "1 h later", "30 min earlier": how a column differs from the row labels. */
export function shiftLabel(minutes) {
  const size = Math.abs(minutes);
  const amount = size % 60 === 0 ? `${size / 60} h` : `${size} min`;
  return `${amount} ${minutes > 0 ? 'later' : 'earlier'}`;
}

/** "+1h" */
export function shiftBadge(minutes) {
  const size = Math.abs(minutes);
  return `${minutes > 0 ? '+' : '−'}${size % 60 === 0 ? `${size / 60}h` : `${size}m`}`;
}

/** "UTC-05:00" for a zone at an instant. */
export function offsetLabel(zone, utc) {
  const offset = offsetMinutesAt(utc, zone);
  const size = Math.abs(offset);
  const pad = (n) => String(n).padStart(2, '0');
  return `UTC${offset < 0 ? '−' : '+'}${pad(Math.floor(size / 60))}:${pad(size % 60)}`;
}

/** "America/New York (UTC-05:00)": for choosing a zone from the full list. */
export function zoneLabel(zone, utc = Date.now()) {
  return `${zone.replace(/_/g, ' ')} (${offsetLabel(zone, utc)})`;
}

/** "Eastern Time (UTC-05:00)": for telling a reader which zone they are looking at. */
export function zoneName(zone, utc = Date.now()) {
  let name = '';
  try {
    const parts = new Intl.DateTimeFormat(locale, { timeZone: zone, timeZoneName: 'longGeneric' }).formatToParts(new Date(utc));
    name = parts.find((part) => part.type === 'timeZoneName')?.value || '';
  } catch { /* fall back to the zone's own name */ }
  if (!name || /^(GMT|UTC)/.test(name)) name = zone === 'UTC' ? 'UTC' : `${zone.split('/').pop().replace(/_/g, ' ')} time`;
  return zone === 'UTC' ? 'UTC' : `${name} (${offsetLabel(zone, utc)})`;
}

/** "Thu, Dec 10 to Sat, Dec 12, 9:00 AM-5:00 PM, Eastern Time (UTC-05:00)" */
export function eventSummary(event, utc) {
  return `${daysSummary(event.dates)}, ${timeRange(event.startMinute, event.endMinute)}, ${zoneName(event.timezone, utc)}`;
}

/** "3 minutes ago" */
export function ago(ms, now = Date.now()) {
  const seconds = Math.round((ms - now) / 1000);
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' });
  const steps = [[60, 'second'], [60, 'minute'], [24, 'hour'], [30, 'day'], [12, 'month'], [Infinity, 'year']];
  let value = seconds;
  for (const [size, unit] of steps) {
    if (Math.abs(value) < size) return rtf.format(Math.round(value), unit);
    value /= size;
  }
  return '';
}

/** Joins names as "Ana, Ben and Chi". */
export function listNames(names) {
  try {
    return new Intl.ListFormat(locale, { style: 'long', type: 'conjunction' }).format(names);
  } catch {
    return names.join(', ');
  }
}
