import { test } from 'node:test';
import assert from 'node:assert/strict';
import { wallToUtc, utcToWall, isValidTimeZone, offsetMinutesAt } from '../../js/core/tz.js';

const iso = (ms) => new Date(ms).toISOString();

test('offsetMinutesAt gives the UTC offset in force at an instant', () => {
  assert.equal(offsetMinutesAt(Date.UTC(2026, 10, 21, 14, 0), 'America/New_York'), -300);
  assert.equal(offsetMinutesAt(Date.UTC(2026, 6, 1, 12, 0), 'America/New_York'), -240);
  assert.equal(offsetMinutesAt(Date.UTC(2026, 0, 1), 'Asia/Kathmandu'), 345);
  assert.equal(offsetMinutesAt(Date.UTC(2026, 0, 1), 'UTC'), 0);
});

test('wallToUtc converts an ordinary wall-clock time', () => {
  const r = wallToUtc('2026-11-21', 9 * 60, 'America/New_York');
  assert.equal(r.valid, true);
  assert.equal(iso(r.utc), '2026-11-21T14:00:00.000Z');
});

test('wallToUtc handles half-hour and 45-minute zones', () => {
  assert.equal(iso(wallToUtc('2026-11-21', 9 * 60, 'Asia/Kolkata').utc), '2026-11-21T03:30:00.000Z');
  assert.equal(iso(wallToUtc('2026-11-21', 9 * 60, 'Asia/Kathmandu').utc), '2026-11-21T03:15:00.000Z');
});

test('wallToUtc accepts minutes past midnight as the following day', () => {
  const r = wallToUtc('2026-11-21', 25 * 60, 'America/New_York');
  assert.equal(r.valid, true);
  assert.equal(iso(r.utc), '2026-11-22T06:00:00.000Z');
});

test('wallToUtc flags a time skipped by the spring-forward change as not valid', () => {
  // US clocks jump from 02:00 to 03:00 on 8 March 2026.
  assert.equal(wallToUtc('2026-03-08', 2 * 60 + 30, 'America/New_York').valid, false);
  assert.equal(wallToUtc('2026-03-08', 1 * 60 + 30, 'America/New_York').valid, true);
  const after = wallToUtc('2026-03-08', 3 * 60, 'America/New_York');
  assert.equal(after.valid, true);
  assert.equal(iso(after.utc), '2026-03-08T07:00:00.000Z');
});

test('wallToUtc picks the first occurrence of a time repeated by the fall-back change', () => {
  // US clocks go from 02:00 back to 01:00 on 1 November 2026; 01:30 happens twice.
  const r = wallToUtc('2026-11-01', 1 * 60 + 30, 'America/New_York');
  assert.equal(r.valid, true);
  assert.equal(iso(r.utc), '2026-11-01T05:30:00.000Z');
  assert.equal(iso(wallToUtc('2026-11-01', 2 * 60, 'America/New_York').utc), '2026-11-01T07:00:00.000Z');
});

test('wallToUtc handles a zone whose daylight change is thirty minutes', () => {
  // Lord Howe Island moves from +10:30 to +11:00 at 02:00 on 4 October 2026.
  assert.equal(wallToUtc('2026-10-04', 2 * 60 + 15, 'Australia/Lord_Howe').valid, false);
  const r = wallToUtc('2026-10-04', 2 * 60 + 45, 'Australia/Lord_Howe');
  assert.equal(r.valid, true);
  assert.equal(iso(r.utc), '2026-10-03T15:45:00.000Z');
});

test('wallToUtc handles a southern-hemisphere zone ahead of UTC', () => {
  assert.equal(iso(wallToUtc('2026-01-15', 9 * 60, 'Australia/Sydney').utc), '2026-01-14T22:00:00.000Z');
  assert.equal(iso(wallToUtc('2026-07-15', 9 * 60, 'Australia/Sydney').utc), '2026-07-14T23:00:00.000Z');
});

test('utcToWall gives the local date, minute of day and weekday', () => {
  assert.deepEqual(utcToWall(Date.UTC(2026, 10, 21, 14, 0), 'America/New_York'), {
    date: '2026-11-21', minute: 540, weekday: 6,
  });
  assert.deepEqual(utcToWall(Date.UTC(2026, 10, 21, 14, 0), 'Asia/Tokyo'), {
    date: '2026-11-21', minute: 23 * 60, weekday: 6,
  });
  assert.deepEqual(utcToWall(Date.UTC(2026, 10, 21, 15, 0), 'Asia/Tokyo'), {
    date: '2026-11-22', minute: 0, weekday: 0,
  });
});

test('utcToWall and wallToUtc round-trip across a year of hourly instants', () => {
  for (const tz of ['America/New_York', 'Europe/London', 'Australia/Lord_Howe', 'Asia/Kathmandu', 'Pacific/Auckland']) {
    for (let t = Date.UTC(2026, 0, 1); t < Date.UTC(2027, 0, 1); t += 3600000 * 7) {
      const w = utcToWall(t, tz);
      const back = wallToUtc(w.date, w.minute, tz);
      assert.equal(back.valid, true, `${tz} ${iso(t)}`);
      // A repeated hour resolves to its first occurrence, which is at most an hour earlier.
      assert.ok(back.utc === t || back.utc === t - 3600000 || back.utc === t - 1800000, `${tz} ${iso(t)} -> ${iso(back.utc)}`);
    }
  }
});

test('isValidTimeZone accepts IANA names and rejects junk', () => {
  assert.equal(isValidTimeZone('Europe/Berlin'), true);
  assert.equal(isValidTimeZone('UTC'), true);
  assert.equal(isValidTimeZone('Mars/Olympus_Mons'), false);
  assert.equal(isValidTimeZone(''), false);
  assert.equal(isValidTimeZone(undefined), false);
});
