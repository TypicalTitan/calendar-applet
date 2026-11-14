import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  slotsPerDay, slotCount, computeDayStarts, plausibleDayStarts, encodeDayStarts, decodeDayStarts, buildSlots, describeGrid, slotWall, sameClock,
} from '../../js/core/slots.js';

const iso = (ms) => new Date(ms).toISOString();

const weekend = {
  timezone: 'America/New_York',
  dates: ['2026-11-21', '2026-11-22', '2026-11-23'],
  startMinute: 9 * 60,
  endMinute: 17 * 60,
  slotMinutes: 30,
};

test('slotsPerDay and slotCount follow from the window and slot length', () => {
  assert.equal(slotsPerDay(weekend), 16);
  assert.equal(slotCount(weekend), 48);
  assert.equal(slotsPerDay({ ...weekend, slotMinutes: 15 }), 32);
  assert.equal(slotsPerDay({ ...weekend, slotMinutes: 60 }), 8);
});

test('buildSlots numbers slots day by day and anchors them to the event zone', () => {
  const s = buildSlots(weekend);
  assert.equal(s.perDay, 16);
  assert.equal(s.count, 48);
  assert.equal(iso(s.utc[0]), '2026-11-21T14:00:00.000Z');
  assert.equal(iso(s.utc[1]), '2026-11-21T14:30:00.000Z');
  assert.equal(iso(s.utc[15]), '2026-11-21T21:30:00.000Z');
  assert.equal(iso(s.utc[16]), '2026-11-22T14:00:00.000Z');
  assert.equal(iso(s.utc[47]), '2026-11-23T21:30:00.000Z');
});

test('computeDayStarts gives the instant each day\'s window opens, in whole minutes since 1970', () => {
  assert.deepEqual(computeDayStarts(weekend), [
    Date.UTC(2026, 10, 21, 14) / 60000, Date.UTC(2026, 10, 22, 14) / 60000, Date.UTC(2026, 10, 23, 14) / 60000,
  ]);
});

test('computeDayStarts moves a start time skipped by a clock change forward to the next real time', () => {
  const e = { timezone: 'America/New_York', dates: ['2026-03-08'], startMinute: 150, endMinute: 270, slotMinutes: 60 };
  assert.equal(iso(computeDayStarts(e)[0] * 60000), '2026-03-08T07:30:00.000Z'); // 03:30 EDT
});

test('buildSlots trusts the start instants stored with the event over its own arithmetic', () => {
  const stored = [Date.UTC(2026, 10, 21, 15) / 60000, Date.UTC(2026, 10, 22, 15) / 60000, Date.UTC(2026, 10, 23, 15) / 60000];
  const s = buildSlots({ ...weekend, dayStarts: stored });
  assert.equal(iso(s.utc[0]), '2026-11-21T15:00:00.000Z');
  assert.equal(iso(s.utc[17]), '2026-11-22T15:30:00.000Z');
});

test('plausibleDayStarts accepts stored instants near the chosen days and rejects nonsense', () => {
  const starts = computeDayStarts(weekend);
  assert.equal(plausibleDayStarts({ ...weekend, dayStarts: starts }), true);
  assert.equal(plausibleDayStarts({ ...weekend, dayStarts: starts.map((m) => m + 60) }), true);
  assert.equal(plausibleDayStarts({ ...weekend, dayStarts: starts.slice(0, 2) }), false);
  assert.equal(plausibleDayStarts({ ...weekend, dayStarts: starts.map((m) => m + 2 * 1440) }), false);
  assert.equal(plausibleDayStarts({ ...weekend, dayStarts: starts.map(String) }), false);
  assert.equal(plausibleDayStarts({ ...weekend, dayStarts: [starts[0], starts[0], starts[0]] }), false);
  assert.equal(plausibleDayStarts({ ...weekend, dayStarts: 'soon' }), false);
});

test('buildSlots keeps 9am at 9am on both sides of a daylight-saving change', () => {
  const s = buildSlots({ ...weekend, dates: ['2026-10-31', '2026-11-01'], slotMinutes: 60 });
  assert.equal(iso(s.utc[0]), '2026-10-31T13:00:00.000Z');
  assert.equal(iso(s.utc[8]), '2026-11-01T14:00:00.000Z');
});

test('buildSlots steps through real time, so a window over a clock change keeps every real half hour', () => {
  const s = buildSlots({ timezone: 'America/New_York', dates: ['2026-03-08'], startMinute: 0, endMinute: 240, slotMinutes: 30 });
  assert.equal(s.count, 8);
  assert.equal(iso(s.utc[3]), '2026-03-08T06:30:00.000Z'); // 01:30 EST
  assert.equal(iso(s.utc[4]), '2026-03-08T07:00:00.000Z'); // 03:00 EDT, the next real half hour
});

test('buildSlots supports a window that runs past midnight', () => {
  const s = buildSlots({ timezone: 'America/New_York', dates: ['2026-11-21'], startMinute: 20 * 60, endMinute: 26 * 60, slotMinutes: 60 });
  assert.equal(s.count, 6);
  assert.equal(iso(s.utc[0]), '2026-11-22T01:00:00.000Z');
  assert.equal(iso(s.utc[5]), '2026-11-22T06:00:00.000Z');
});

test('describeGrid in the event zone labels columns with the chosen dates and rows with the window', () => {
  const s = buildSlots(weekend);
  const g = describeGrid(weekend, s, 'America/New_York');
  assert.deepEqual(g.columns.map((c) => c.date), weekend.dates);
  assert.deepEqual(g.columns.map((c) => c.lastDate), weekend.dates);
  assert.deepEqual(g.columns.map((c) => c.shifts), [[], [], []]);
  assert.equal(g.rows.length, 16);
  assert.deepEqual(g.rows[0], { k: 0, minute: 540, dayOffset: 0, labelled: true });
  assert.deepEqual(g.rows[15], { k: 15, minute: 990, dayOffset: 0, labelled: false });
});

test('describeGrid in another zone shows local times and flags rows that fall on the next day', () => {
  const s = buildSlots(weekend);
  const g = describeGrid(weekend, s, 'Asia/Tokyo');
  assert.deepEqual(g.columns.map((c) => c.date), ['2026-11-21', '2026-11-22', '2026-11-23']);
  assert.deepEqual(g.columns.map((c) => c.lastDate), ['2026-11-22', '2026-11-23', '2026-11-24']);
  assert.deepEqual(g.rows[0], { k: 0, minute: 23 * 60, dayOffset: 0, labelled: true });
  assert.deepEqual(g.rows[1], { k: 1, minute: 23 * 60 + 30, dayOffset: 0, labelled: false });
  assert.deepEqual(g.rows[2], { k: 2, minute: 0, dayOffset: 1, labelled: true });
  assert.deepEqual(g.rows[15], { k: 15, minute: 6 * 60 + 30, dayOffset: 1, labelled: false });
});

test('describeGrid marks the after-midnight rows of an overnight window', () => {
  const party = { timezone: 'America/New_York', dates: ['2026-11-21'], startMinute: 20 * 60, endMinute: 26 * 60, slotMinutes: 60 };
  const g = describeGrid(party, buildSlots(party), 'America/New_York');
  assert.deepEqual(g.rows.map((r) => r.minute), [1200, 1260, 1320, 1380, 0, 60]);
  assert.deepEqual(g.rows.map((r) => r.dayOffset), [0, 0, 0, 0, 1, 1]);
});

test('describeGrid labels rows by what most columns show and reports the columns that differ', () => {
  // Phoenix never changes its clocks; Los Angeles goes back an hour on 1 November.
  const desert = { timezone: 'America/Phoenix', dates: ['2026-10-31', '2026-11-01', '2026-11-02'], startMinute: 540, endMinute: 720, slotMinutes: 60 };
  const g = describeGrid(desert, buildSlots(desert), 'America/Los_Angeles');
  assert.deepEqual(g.rows.map((r) => r.minute), [480, 540, 600]);
  assert.deepEqual(g.columns.map((c) => c.shifts), [[{ k: 0, minutes: 60 }], [], []]);
});

test('describeGrid reports a clock change that happens part-way down a column', () => {
  const spring = { timezone: 'America/New_York', dates: ['2026-03-08', '2026-03-09', '2026-03-10'], startMinute: 0, endMinute: 240, slotMinutes: 60 };
  const g = describeGrid(spring, buildSlots(spring), 'America/New_York');
  assert.deepEqual(g.rows.map((r) => r.minute), [0, 60, 120, 180]);
  assert.deepEqual(g.columns.map((c) => c.shifts), [[{ k: 2, minutes: 60 }], [], []]);
});

test('describeGrid reports when a column returns to the labelled times', () => {
  // A Tokyo afternoon seen from New York on the night the US clocks go back.
  const tokyo = { timezone: 'Asia/Tokyo', dates: ['2026-11-01', '2026-11-02', '2026-11-03'], startMinute: 13 * 60, endMinute: 17 * 60, slotMinutes: 60 };
  const g = describeGrid(tokyo, buildSlots(tokyo), 'America/New_York');
  // Later days: 13:00 JST is 23:00 EST the evening before. On 1 November it is 00:00 EDT.
  assert.deepEqual(g.rows.map((r) => [r.minute, r.dayOffset]), [[1380, 0], [0, 1], [60, 1], [120, 1]]);
  assert.deepEqual(g.columns[0].shifts, [{ k: 0, minutes: 60 }, { k: 2, minutes: 0 }]);
  assert.deepEqual(g.columns[1].shifts, []);
});

test('sameClock is true only when two zones show the same time for every slot', () => {
  const s = buildSlots(weekend);
  assert.equal(sameClock(s, 'America/New_York', 'America/Toronto'), true);
  assert.equal(sameClock(s, 'America/New_York', 'America/Chicago'), false);
  const desert = { timezone: 'America/Phoenix', dates: ['2026-10-31', '2026-11-02'], startMinute: 540, endMinute: 720, slotMinutes: 60 };
  assert.equal(sameClock(buildSlots(desert), 'America/Phoenix', 'America/Los_Angeles'), false);
});

test('slotWall gives the exact local start and end of one slot', () => {
  const s = buildSlots(weekend);
  assert.deepEqual(slotWall(weekend, s, 0, 'America/New_York'), { date: '2026-11-21', weekday: 6, startMinute: 540, endMinute: 570 });
  assert.deepEqual(slotWall(weekend, s, 2, 'Asia/Tokyo'), { date: '2026-11-22', weekday: 0, startMinute: 0, endMinute: 30 });
  assert.deepEqual(slotWall(weekend, s, 1, 'Asia/Tokyo'), { date: '2026-11-21', weekday: 6, startMinute: 1410, endMinute: 1440 });
});

test('encodeDayStarts and decodeDayStarts turn the start instants into the stored string and back', () => {
  const startsList = computeDayStarts(weekend);
  const text = encodeDayStarts(startsList);
  assert.equal(text, '29921160,29922600,29924040');
  assert.deepEqual(decodeDayStarts(text), startsList);
});

test('decodeDayStarts gives null for anything that is not eight-digit numbers joined by commas', () => {
  for (const bad of ['', '1,2,3', '29921160,', ',29921160', '29921160 29922600', '29921160.5', '-29921160', 'soon', null, undefined, 29921160, ['29921160']]) {
    assert.equal(decodeDayStarts(bad), null, JSON.stringify(bad));
  }
});

test('describeGrid says which rows to label: one per hour counted from the first row', () => {
  // Kathmandu is 15 minutes ahead of India, so every half-hour slot starts at :15 or :45 there.
  const nepal = { timezone: 'Asia/Kathmandu', dates: ['2026-11-21'], startMinute: 540, endMinute: 720, slotMinutes: 30 };
  const g = describeGrid(nepal, buildSlots(nepal), 'Asia/Kolkata');
  assert.deepEqual(g.rows.map((r) => r.minute), [525, 555, 585, 615, 645, 675]);
  assert.deepEqual(g.rows.map((r) => r.labelled), [true, false, true, false, true, false]);
  const hourly = { ...nepal, slotMinutes: 60 };
  assert.deepEqual(describeGrid(hourly, buildSlots(hourly), 'Asia/Kolkata').rows.map((r) => r.labelled), [true, true, true]);
  const quarter = { ...weekend, dates: ['2026-11-21'], endMinute: 600, slotMinutes: 15 };
  assert.deepEqual(describeGrid(quarter, buildSlots(quarter), 'America/New_York').rows.map((r) => r.labelled), [true, false, false, false]);
});

test('sameClock notices zones that differ only in the middle of a window', () => {
  // Cuba and the US change clocks on the same night, two hours apart.
  const night = { timezone: 'America/New_York', dates: ['2027-03-13'], startMinute: 1200, endMinute: 1680, slotMinutes: 60 };
  assert.equal(sameClock(buildSlots(night), 'America/New_York', 'America/Havana'), false);
});
