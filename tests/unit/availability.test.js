import { test } from 'node:test';
import assert from 'node:assert/strict';
import { emptyAnswer, isAnswer, toAnswer, fromAnswer, countAvailable, bestWindows, cleanName, heatScale } from '../../js/core/availability.js';

test('emptyAnswer is one zero per slot', () => {
  assert.equal(emptyAnswer(4), '0000');
  assert.equal(emptyAnswer(0), '');
});

test('isAnswer accepts only zeros and ones of the right length', () => {
  assert.equal(isAnswer('0101', 4), true);
  assert.equal(isAnswer('010', 4), false);
  assert.equal(isAnswer('01012', 5), false);
  assert.equal(isAnswer('01 1', 4), false);
  assert.equal(isAnswer(null, 4), false);
  assert.equal(isAnswer('', 0), true);
});

test('toAnswer and fromAnswer convert between flags and the stored string', () => {
  assert.equal(toAnswer([1, 0, 1, 1]), '1011');
  assert.equal(toAnswer([true, false]), '10');
  assert.deepEqual([...fromAnswer('1011', 4)], [1, 0, 1, 1]);
});

test('fromAnswer treats a malformed stored answer as no availability', () => {
  assert.deepEqual([...fromAnswer('10', 4)], [0, 0, 0, 0]);
  assert.deepEqual([...fromAnswer('1x11', 4)], [0, 0, 0, 0]);
  assert.deepEqual([...fromAnswer(undefined, 2)], [0, 0]);
});

test('countAvailable adds up how many people are free in each slot', () => {
  assert.deepEqual(countAvailable(['1110', '0111', '0110'], 4), [1, 3, 3, 1]);
  assert.deepEqual(countAvailable([], 3), [0, 0, 0]);
  assert.deepEqual(countAvailable(['11', 'bad'], 2), [1, 1]);
});

const oneDay = { perDay: 4, count: 4 };

test('bestWindows groups start times that suit exactly the same people', () => {
  const blocks = bestWindows(oneDay, ['1110', '0111', '0110'], 1);
  assert.deepEqual(blocks, [
    { day: 0, startK: 1, lastStartK: 2, length: 1, count: 3, who: [0, 1, 2] },
    { day: 0, startK: 0, lastStartK: 0, length: 1, count: 1, who: [0] },
    { day: 0, startK: 3, lastStartK: 3, length: 1, count: 1, who: [1] },
  ]);
});

test('bestWindows only counts people free for the whole meeting length', () => {
  const blocks = bestWindows(oneDay, ['1110', '0111', '0110'], 2);
  assert.deepEqual(blocks, [
    { day: 0, startK: 1, lastStartK: 1, length: 2, count: 3, who: [0, 1, 2] },
    { day: 0, startK: 0, lastStartK: 0, length: 2, count: 1, who: [0] },
    { day: 0, startK: 2, lastStartK: 2, length: 2, count: 1, who: [1] },
  ]);
});

test('bestWindows never lets a meeting run from one day into the next', () => {
  const twoDays = { perDay: 2, count: 4 };
  const blocks = bestWindows(twoDays, ['1111', '0011'], 2);
  assert.deepEqual(blocks, [
    { day: 1, startK: 0, lastStartK: 0, length: 2, count: 2, who: [0, 1] },
    { day: 0, startK: 0, lastStartK: 0, length: 2, count: 1, who: [0] },
  ]);
});

test('bestWindows prefers more people, then more choice of start time, then the earliest', () => {
  const grid = { perDay: 6, count: 6 };
  const blocks = bestWindows(grid, ['110111', '110111'], 1);
  assert.deepEqual(blocks.map((b) => [b.startK, b.lastStartK]), [[3, 5], [0, 1]]);
});

test('bestWindows leaves out times nobody can make and meetings longer than the day', () => {
  assert.deepEqual(bestWindows(oneDay, ['0000'], 1), []);
  assert.deepEqual(bestWindows(oneDay, [], 1), []);
  assert.deepEqual(bestWindows(oneDay, ['1111'], 5), []);
});

test('bestWindows returns at most the requested number of blocks', () => {
  const grid = { perDay: 5, count: 5 };
  assert.equal(bestWindows(grid, ['10101'], 1, 2).length, 2);
});

test('cleanName trims, collapses spaces and removes control characters', () => {
  assert.equal(cleanName('  Ana   Maria \n'), 'Ana Maria');
  assert.equal(cleanName('Bo\u0000b\u200B'), 'Bob');
  assert.equal(cleanName(null), '');
});

test('cleanName limits length without cutting a character in half', () => {
  assert.equal(cleanName('x'.repeat(80)).length, 60);
  const emoji = cleanName('😀'.repeat(40));
  assert.ok(emoji.length <= 60);
  assert.equal([...emoji].every((ch) => ch === '😀'), true);
});

test('heatScale gives every head-count its own shade when there are only a few', () => {
  const scale = heatScale(3);
  assert.equal(scale.classes, 3);
  assert.deepEqual([0, 1, 2, 3].map(scale.classOf), [0, 1, 2, 3]);
  assert.deepEqual(scale.ranges, [[0, 0], [1, 1], [2, 2], [3, 3]]);
});

test('heatScale groups head-counts into at most five shades, and never hides a single person', () => {
  const scale = heatScale(12);
  assert.equal(scale.classes, 5);
  assert.equal(scale.classOf(0), 0);
  assert.equal(scale.classOf(1), 1);
  assert.equal(scale.classOf(12), 5);
  assert.deepEqual(scale.ranges, [[0, 0], [1, 3], [4, 5], [6, 8], [9, 10], [11, 12]]);
  for (let n = 1; n < 12; n++) assert.ok(scale.classOf(n) <= scale.classOf(n + 1));
});

test('heatScale copes with nobody free anywhere', () => {
  const scale = heatScale(0);
  assert.equal(scale.classes, 0);
  assert.equal(scale.classOf(0), 0);
  assert.deepEqual(scale.ranges, [[0, 0]]);
});

test('cleanName treats a name with nothing visible in it as no name at all', () => {
  for (const blank of ['\u200D', '\u00AD', '\u3164', '\u2800', '\u200E', '\u034F', '\u200D\u200C \u3164', '\u0301']) {
    assert.equal(cleanName(blank), '', JSON.stringify(blank));
  }
  assert.equal(cleanName('\u0639\u0644\u06CC\u200C\u0631\u0636\u0627'), '\u0639\u0644\u06CC\u200C\u0631\u0636\u0627'); // a Persian name keeps its joiner
  assert.equal(cleanName('Zo\u00EB'), 'Zo\u00EB');
});
