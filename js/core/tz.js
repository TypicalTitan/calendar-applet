// Time zone arithmetic built on Intl only, so it runs unchanged in browsers and in Node.
//
// "Wall" time is what a clock on the wall shows in a zone: a calendar date plus minutes
// after midnight. An "instant" is a UTC timestamp in milliseconds.

const MINUTE = 60000;
const DAY = 86400000;

const formatters = new Map();

function partsFormatter(timeZone) {
  let f = formatters.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone,
      calendar: 'iso8601',
      numberingSystem: 'latn',
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    formatters.set(timeZone, f);
  }
  return f;
}

// The zone's wall clock at `utc`, expressed as if it were a UTC timestamp.
function wallClockAsUtc(utc, timeZone) {
  const p = {};
  for (const part of partsFormatter(timeZone).formatToParts(new Date(utc))) p[part.type] = part.value;
  // Some engines have reported midnight as hour 24; fold it back to 0.
  return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour % 24, +p.minute, +p.second);
}

export function isValidTimeZone(timeZone) {
  if (typeof timeZone !== 'string' || timeZone === '') return false;
  try {
    partsFormatter(timeZone);
    return true;
  } catch {
    return false;
  }
}

/** Minutes the zone is ahead of UTC at the given instant (negative when behind). */
export function offsetMinutesAt(utc, timeZone) {
  const whole = Math.floor(utc / 1000) * 1000;
  return Math.round((wallClockAsUtc(whole, timeZone) - whole) / MINUTE);
}

/** Splits "YYYY-MM-DD" into numbers. */
export function parseDate(date) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!m) throw new RangeError(`Not a calendar date: ${date}`);
  return { year: +m[1], month: +m[2], day: +m[3] };
}

/**
 * The instant at which a zone's wall clock shows `date` plus `minute` minutes after midnight.
 * `minute` may exceed 1440 to mean the following day.
 *
 * Daylight-saving changes make some wall times special:
 *   - a time skipped when clocks go forward never happens: `valid` is false;
 *   - a time repeated when clocks go back happens twice: the first occurrence is returned.
 */
export function wallToUtc(date, minute, timeZone) {
  const { year, month, day } = parseDate(date);
  const wall = Date.UTC(year, month - 1, day) + minute * MINUTE;
  // The real instant is within 14 hours of `wall`, so a day either side brackets any change.
  const before = offsetMinutesAt(wall - DAY, timeZone);
  const after = offsetMinutesAt(wall + DAY, timeZone);
  const candidates = [];
  for (const offset of before === after ? [before] : [before, after]) {
    const utc = wall - offset * MINUTE;
    if (offsetMinutesAt(utc, timeZone) === offset) candidates.push(utc);
  }
  if (candidates.length === 0) return { utc: wall - before * MINUTE, valid: false };
  return { utc: Math.min(...candidates), valid: true };
}

/** The zone's wall clock at an instant: local date, minutes after midnight, weekday (0 = Sunday). */
export function utcToWall(utc, timeZone) {
  const wall = new Date(wallClockAsUtc(utc, timeZone));
  const pad = (n) => String(n).padStart(2, '0');
  return {
    date: `${wall.getUTCFullYear()}-${pad(wall.getUTCMonth() + 1)}-${pad(wall.getUTCDate())}`,
    minute: wall.getUTCHours() * 60 + wall.getUTCMinutes(),
    weekday: wall.getUTCDay(),
  };
}

/** The viewer's own zone, or UTC if the browser will not say. */
export function localTimeZone() {
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    return isValidTimeZone(tz) ? tz : 'UTC';
  } catch {
    return 'UTC';
  }
}

/** Every zone the runtime knows, always including UTC. */
export function listTimeZones() {
  let zones = [];
  try {
    zones = Intl.supportedValuesOf('timeZone');
  } catch {
    zones = [];
  }
  const set = new Set(zones);
  set.add('UTC');
  set.add(localTimeZone());
  return [...set].sort((a, b) => a.localeCompare(b));
}
