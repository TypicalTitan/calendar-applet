// CSV export. Everything here is pure: it turns an event and its answers into rows of cells,
// and rows into text. The browser download lives with the page code.

import { slotWall } from './slots.js';
import { fromAnswer, countAvailable } from './availability.js';
import { utcToWall } from './tz.js';
import { truncate } from './text.js';

const MINUTE = 60000;
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const pad = (n) => String(n).padStart(2, '0');
const clock = (minute) => `${pad(Math.floor(minute / 60) % 24)}:${pad(minute % 60)}`;
const utcStamp = (ms) => new Date(ms).toISOString().replace('.000Z', 'Z');

/** One cell, quoted only when it has to be (RFC 4180). */
export function csvCell(value) {
  const text = value === null || value === undefined ? '' : String(value);
  return /[",;\r\n]|^\s|\s$/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

const FORMULA_START = '=+\\-@\\uFF1D\\uFF0B\\uFF0D\\uFF20';
const STARTS_FORMULA = new RegExp(`^[${FORMULA_START}]`);
const FORMULA_AFTER_SEMICOLON = new RegExp(`;(\\s*)(?=[${FORMULA_START}])`, 'g');

/**
 * Makes text typed by a person safe to put in a cell. Line breaks and tabs become spaces, and a
 * character that would make a spreadsheet treat the cell as a formula (including the full-width
 * look-alikes) gets an apostrophe in front, which spreadsheets read as "plain text" (OWASP "CSV
 * injection"). That applies at the start of the text and after every semicolon: spreadsheets in
 * many countries split CSV lines on semicolons, so each one can begin a new cell.
 */
export function safeText(text) {
  const flat = String(text).replace(/[\t\r\n]+/g, ' ').trim().replace(FORMULA_AFTER_SEMICOLON, ";$1'");
  return STARTS_FORMULA.test(flat) ? `'${flat}` : flat;
}

/** Rows to a CSV file body: UTF-8 byte-order mark so Excel reads accents, CRLF line endings. */
export function toCsv(rows) {
  return '\uFEFF' + rows.map((row) => row.map(csvCell).join(',') + '\r\n').join('');
}

/**
 * A column heading per person: their name, numbered when it repeats ("Sam", "Sam (2)").
 * Headings are made safe for spreadsheets unless `escape` is false (for showing on a page).
 */
export function columnNames(responses, { escape = true } = {}) {
  const used = new Set();
  return responses.map((r) => {
    let heading = r.name;
    for (let n = 2; used.has(heading); n++) heading = `${r.name} (${n})`;
    used.add(heading);
    return escape ? safeText(heading) : heading;
  });
}

/** One row per time slot, one column per person (1 = free, 0 = not). */
export function gridRows(event, slots, responses, zone) {
  const names = columnNames(responses);
  const answers = responses.map((r) => fromAnswer(r.slots, slots.count));
  const totals = countAvailable(responses.map((r) => r.slots), slots.count);
  const rows = [['Date', 'Day', 'Start', 'End', 'Time zone', 'Start (UTC)', 'Available', 'Responses', ...names]];
  for (let i = 0; i < slots.count; i++) {
    const w = slotWall(event, slots, i, zone);
    rows.push([
      w.date, DAYS[w.weekday], clock(w.startMinute), clock(w.endMinute), zone, utcStamp(slots.utc[i]),
      totals[i], responses.length, ...answers.map((a) => a[i]),
    ]);
  }
  return rows;
}

/** One row per person per unbroken stretch of free time. */
export function rangeRows(event, slots, responses, zone) {
  const names = columnNames(responses);
  const step = event.slotMinutes * MINUTE;
  const rows = [['Name', 'Date', 'Day', 'Start', 'End', 'Minutes', 'Time zone', 'Answer updated (UTC)']];
  responses.forEach((response, p) => {
    const flags = fromAnswer(response.slots, slots.count);
    const updated = Number.isFinite(response.updatedAt) ? utcStamp(response.updatedAt) : '';
    let any = false;
    for (let day = 0; day < event.dates.length; day++) {
      let run = null;
      const flush = () => {
        if (!run) return;
        const start = utcToWall(run.from, zone);
        const end = utcToWall(run.to, zone);
        rows.push([names[p], start.date, DAYS[start.weekday], clock(start.minute), clock(end.minute), (run.to - run.from) / MINUTE, zone, updated]);
        any = true;
        run = null;
      };
      for (let k = 0; k < slots.perDay; k++) {
        const i = day * slots.perDay + k;
        if (!flags[i]) { flush(); continue; }
        if (run && run.to === slots.utc[i]) run.to += step;
        else { flush(); run = { from: slots.utc[i], to: slots.utc[i] + step }; }
      }
      flush();
    }
    if (!any) rows.push([names[p], '', '', '', '', 0, zone, updated]);
  });
  return rows;
}

/** A download name built from the event title that is safe on any file system. */
export function exportFileName(title, kind) {
  const slug = String(title || '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\p{M}]+/gu, '-') // letters, digits, and the marks that belong to letters
    .replace(/^-+|-+$/g, '');
  const short = truncate(slug, 60).replace(/-+$/g, '');
  return `${short || 'event'}-${kind}.csv`;
}
