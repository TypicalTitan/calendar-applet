// Answers and the sums done over them.
//
// One person's answer is a string with one character per slot: "1" free, "0" not.
// That shape is easy for the database rules to check and cheap to store.

import { tidyLine, truncate } from './text.js';

export const NAME_MAX = 60;

export function emptyAnswer(count) {
  return '0'.repeat(count);
}

export function isAnswer(value, count) {
  return typeof value === 'string' && value.length === count && /^[01]*$/.test(value);
}

/** Flags (any truthy/falsy list) to the stored string. */
export function toAnswer(flags) {
  let out = '';
  for (const flag of flags) out += flag ? '1' : '0';
  return out;
}

/** The stored string to flags. Anything malformed counts as "not free anywhere". */
export function fromAnswer(value, count) {
  const flags = new Uint8Array(count);
  if (!isAnswer(value, count)) return flags;
  for (let i = 0; i < count; i++) flags[i] = value.charCodeAt(i) === 49 ? 1 : 0;
  return flags;
}

/** How many people are free in each slot. */
export function countAvailable(answers, count) {
  const totals = Array(count).fill(0);
  for (const answer of answers) {
    if (!isAnswer(answer, count)) continue;
    for (let i = 0; i < count; i++) if (answer.charCodeAt(i) === 49) totals[i]++;
  }
  return totals;
}

/**
 * The best times for a meeting lasting `length` slots.
 *
 * A person counts for a start time only if they are free for the whole meeting. Neighbouring
 * start times that suit exactly the same people are merged into one block:
 *   { day, startK, lastStartK, length, count, who }
 * meaning the meeting can start at any slot from startK to lastStartK on that day, and `who`
 * (positions in `answers`) can all make it. Ordered by most people, then most choice of start
 * time, then earliest.
 */
export function bestWindows(grid, answers, length, limit = Infinity) {
  const { perDay, count } = grid;
  const days = perDay > 0 ? count / perDay : 0;
  if (length < 1 || length > perDay) return [];

  // Running totals so "free for the whole window" is a subtraction, not a scan.
  const free = answers.map((answer) => prefixSums(fromAnswer(answer, count), count));

  const blocks = [];
  for (let day = 0; day < days; day++) {
    let open = null;
    for (let k = 0; k + length <= perDay; k++) {
      const from = day * perDay + k;
      const to = from + length;
      const who = [];
      for (let p = 0; p < free.length; p++) if (free[p][to] - free[p][from] === length) who.push(p);
      const key = who.join(',');
      if (open && open.key === key) {
        open.block.lastStartK = k;
        continue;
      }
      open = null;
      if (who.length === 0) continue;
      const block = { day, startK: k, lastStartK: k, length, count: who.length, who };
      blocks.push(block);
      open = { key, block };
    }
  }

  blocks.sort((a, b) =>
    b.count - a.count ||
    (b.lastStartK - b.startK) - (a.lastStartK - a.startK) ||
    a.day - b.day ||
    a.startK - b.startK);
  return blocks.slice(0, limit);
}

/**
 * How head-counts map to shades on the results grid. Up to five people-counts each get their own
 * shade; beyond that, counts are grouped into five bands so neighbouring shades stay tellable
 * apart. Zero is always its own class (no shade), so one person free never looks like nobody.
 *   classes        number of shades in use (0 when nobody is free anywhere)
 *   classOf(n)     0 for nobody, otherwise 1..classes
 *   ranges[c]      [lowest, highest] head-count shown in class c
 */
export function heatScale(max) {
  const classes = Math.min(Math.max(0, max), 5);
  const classOf = (n) => (n <= 0 || classes === 0 ? 0 : 1 + Math.floor(((Math.min(n, max) - 1) * classes) / max));
  const ranges = [[0, 0]];
  for (let n = 1; n <= max; n++) {
    const c = classOf(n);
    if (ranges[c]) ranges[c][1] = n;
    else ranges[c] = [n, n];
  }
  return { classes, classOf, ranges };
}

function prefixSums(flags, count) {
  const sums = new Int32Array(count + 1);
  for (let i = 0; i < count; i++) sums[i + 1] = sums[i] + (flags[i] ? 1 : 0);
  return sums;
}

/** Tidies a typed name: no control or invisible characters, single spaces, at most NAME_MAX long. */
export function cleanName(value, max = NAME_MAX) {
  return truncate(tidyLine(value), max).trim();
}
