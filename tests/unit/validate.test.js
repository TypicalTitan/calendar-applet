import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateEvent, parseEvent, endMinuteFor, LIMITS } from '../../js/core/validate.js';
import { computeDayStarts } from '../../js/core/slots.js';

const good = {
  title: 'Board game weekend',
  description: 'Bring snacks.',
  timezone: 'America/New_York',
  dates: ['2026-11-21', '2026-11-22', '2026-11-23'],
  startMinute: 540,
  endMinute: 1020,
  slotMinutes: 30,
};

test('validateEvent accepts a well-formed event and reports its slot count', () => {
  const r = validateEvent(good);
  assert.equal(r.ok, true);
  assert.deepEqual(r.errors, {});
  assert.deepEqual(r.value, { ...good, slotCount: 48 });
});

test('validateEvent tidies the title and description', () => {
  const r = validateEvent({ ...good, title: '  Board   game\u0000 weekend ', description: '  line one\r\nline two\u0007  ' });
  assert.equal(r.value.title, 'Board game weekend');
  assert.equal(r.value.description, 'line one\nline two');
});

test('validateEvent sorts the days and drops repeats', () => {
  const r = validateEvent({ ...good, dates: ['2026-11-23', '2026-11-21', '2026-11-23'] });
  assert.equal(r.ok, true);
  assert.deepEqual(r.value.dates, ['2026-11-21', '2026-11-23']);
  assert.equal(r.value.slotCount, 32);
});

test('validateEvent requires a title', () => {
  const r = validateEvent({ ...good, title: '   ' });
  assert.equal(r.ok, false);
  assert.ok(r.errors.title);
});

test('validateEvent rejects an over-long title or description', () => {
  assert.ok(validateEvent({ ...good, title: 'x'.repeat(LIMITS.titleMax + 1) }).errors.title);
  assert.ok(validateEvent({ ...good, description: 'x'.repeat(LIMITS.descriptionMax + 1) }).errors.description);
  assert.equal(validateEvent({ ...good, title: 'x'.repeat(LIMITS.titleMax) }).ok, true);
});

test('validateEvent requires at least one real day and no more than the limit', () => {
  assert.ok(validateEvent({ ...good, dates: [] }).errors.dates);
  assert.ok(validateEvent({ ...good, dates: ['2026-02-30'] }).errors.dates);
  assert.ok(validateEvent({ ...good, dates: 'tomorrow' }).errors.dates);
  const many = Array.from({ length: LIMITS.maxDays + 1 }, (_, i) => `2027-${String(1 + Math.floor(i / 28)).padStart(2, '0')}-${String(1 + (i % 28)).padStart(2, '0')}`);
  assert.ok(validateEvent({ ...good, dates: many }).errors.dates);
  assert.equal(validateEvent({ ...good, dates: many.slice(0, LIMITS.maxDays) }).ok, true);
});

test('validateEvent rejects an unknown time zone', () => {
  assert.ok(validateEvent({ ...good, timezone: 'Mars/Olympus_Mons' }).errors.timezone);
});

test('validateEvent checks the daily window', () => {
  assert.ok(validateEvent({ ...good, endMinute: 540 }).errors.time, 'end equal to start');
  assert.ok(validateEvent({ ...good, endMinute: 500 }).errors.time, 'end before start');
  assert.ok(validateEvent({ ...good, startMinute: 545 }).errors.time, 'start off the quarter hour');
  assert.ok(validateEvent({ ...good, slotMinutes: 60, endMinute: 1050 }).errors.time, 'window not a whole number of slots');
  assert.ok(validateEvent({ ...good, slotMinutes: 20 }).errors.time, 'unsupported slot length');
  assert.ok(validateEvent({ ...good, startMinute: 1440, endMinute: 1500 }).errors.time, 'start after the end of the day');
  assert.ok(validateEvent({ ...good, startMinute: 540, endMinute: 540 + 1440 + 30 }).errors.time, 'window longer than a day');
  assert.ok(validateEvent({ ...good, startMinute: 540.5 }).errors.time, 'fractional minute');
});

test('validateEvent allows a window that runs past midnight or covers the whole day', () => {
  assert.equal(validateEvent({ ...good, startMinute: 1200, endMinute: 1560 }).ok, true);
  const allDay = validateEvent({ ...good, startMinute: 0, endMinute: 1440, slotMinutes: 60 });
  assert.equal(allDay.ok, true);
  assert.equal(allDay.value.slotCount, 72);
});

test('endMinuteFor treats an end at or before the start as the following day', () => {
  assert.equal(endMinuteFor(540, 1020), 1020);
  assert.equal(endMinuteFor(1200, 120), 1560);
  assert.equal(endMinuteFor(540, 540), 1980);
  assert.equal(endMinuteFor(0, 0), 1440);
});

const stored = () => ({
  ...good,
  ownerUid: 'olga',
  dayStarts: computeDayStarts(good),
  slotCount: 48,
  open: true,
  createdAt: 1794000000000,
  updatedAt: 1794000000000,
});

test('parseEvent accepts an event as it is stored and keeps what the pages need', () => {
  const e = parseEvent('ev1', stored());
  assert.equal(e.id, 'ev1');
  assert.equal(e.title, 'Board game weekend');
  assert.equal(e.ownerUid, 'olga');
  assert.equal(e.open, true);
  assert.equal(e.slotCount, 48);
  assert.deepEqual(e.dayStarts, computeDayStarts(good));
  assert.equal(e.createdAt, 1794000000000);
});

test('parseEvent rejects anything that is not a well-formed event', () => {
  assert.equal(parseEvent('ev1', null), null);
  assert.equal(parseEvent('ev1', 'event'), null);
  assert.equal(parseEvent('ev1', { ...stored(), title: '' }), null);
  assert.equal(parseEvent('ev1', { ...stored(), dates: ['2026-11-23', '2026-11-21', '2026-11-22'] }), null, 'days out of order');
  assert.equal(parseEvent('ev1', { ...stored(), dates: ['2026-11-21', '2026-11-21', '2026-11-22'] }), null, 'repeated day');
  assert.equal(parseEvent('ev1', { ...stored(), slotCount: 49 }), null);
  assert.equal(parseEvent('ev1', { ...stored(), dayStarts: [1, 2, 3] }), null);
  assert.equal(parseEvent('ev1', { ...stored(), dayStarts: undefined }), null);
  assert.equal(parseEvent('ev1', { ...stored(), timezone: 'Mars/Olympus_Mons' }), null);
  assert.equal(parseEvent('ev1', { ...stored(), ownerUid: 7 }), null);
  assert.equal(parseEvent('ev1', { ...stored(), open: 'yes' }), null);
  assert.equal(parseEvent('ev1', { ...stored(), title: '  padded  ' }), null, 'not already tidy');
});
