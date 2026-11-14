import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isDateString, addDays, weekdayOf, dateRange, monthMatrix, todayIn, daysBetween } from '../../js/core/dates.js';

test('isDateString accepts real calendar dates only', () => {
  assert.equal(isDateString('2026-11-21'), true);
  assert.equal(isDateString('2028-02-29'), true);
  assert.equal(isDateString('2026-02-29'), false);
  assert.equal(isDateString('2026-13-01'), false);
  assert.equal(isDateString('2026-1-1'), false);
  assert.equal(isDateString('21/11/2026'), false);
  assert.equal(isDateString(20261121), false);
});

test('addDays crosses month and year boundaries', () => {
  assert.equal(addDays('2026-11-30', 1), '2026-12-01');
  assert.equal(addDays('2026-12-31', 1), '2027-01-01');
  assert.equal(addDays('2026-03-01', -1), '2026-02-28');
  assert.equal(addDays('2026-11-21', 0), '2026-11-21');
});

test('weekdayOf counts from Sunday as zero', () => {
  assert.equal(weekdayOf('2026-11-21'), 6);
  assert.equal(weekdayOf('2026-11-22'), 0);
});

test('daysBetween counts whole days from the first date to the second', () => {
  assert.equal(daysBetween('2026-11-21', '2026-11-23'), 2);
  assert.equal(daysBetween('2026-11-23', '2026-11-21'), -2);
  assert.equal(daysBetween('2026-03-07', '2026-03-09'), 2);
});

test('dateRange lists every day between two dates in either order', () => {
  assert.deepEqual(dateRange('2026-11-21', '2026-11-23'), ['2026-11-21', '2026-11-22', '2026-11-23']);
  assert.deepEqual(dateRange('2026-11-23', '2026-11-21'), ['2026-11-21', '2026-11-22', '2026-11-23']);
  assert.deepEqual(dateRange('2026-11-21', '2026-11-21'), ['2026-11-21']);
});

test('monthMatrix lays a month out in whole weeks starting on the chosen weekday', () => {
  const sundayFirst = monthMatrix(2026, 11, 0);
  assert.equal(sundayFirst.length, 5);
  assert.deepEqual(sundayFirst[0], ['2026-11-01', '2026-11-02', '2026-11-03', '2026-11-04', '2026-11-05', '2026-11-06', '2026-11-07']);
  assert.equal(sundayFirst[4][1], '2026-11-30');
  assert.equal(sundayFirst[4][2], null);

  const mondayFirst = monthMatrix(2026, 11, 1);
  assert.equal(mondayFirst.length, 6);
  assert.deepEqual(mondayFirst[0], [null, null, null, null, null, null, '2026-11-01']);
  assert.equal(mondayFirst[5][0], '2026-11-30');
});

test('todayIn gives the calendar date in a zone at a given instant', () => {
  const instant = Date.UTC(2026, 10, 22, 2, 0);
  assert.equal(todayIn('America/New_York', instant), '2026-11-21');
  assert.equal(todayIn('Asia/Tokyo', instant), '2026-11-22');
});
