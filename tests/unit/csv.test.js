import { test } from 'node:test';
import assert from 'node:assert/strict';
import { csvCell, safeText, toCsv, gridRows, rangeRows, exportFileName, columnNames } from '../../js/core/csv.js';
import { buildSlots } from '../../js/core/slots.js';

test('csvCell quotes only when a value needs it and doubles embedded quotes', () => {
  assert.equal(csvCell('plain'), 'plain');
  assert.equal(csvCell(3), '3');
  assert.equal(csvCell(''), '');
  assert.equal(csvCell('a,b'), '"a,b"');
  assert.equal(csvCell('say "hi"'), '"say ""hi"""');
  assert.equal(csvCell('two\nlines'), '"two\nlines"');
  assert.equal(csvCell(' padded '), '" padded "');
});

test('safeText disarms text a spreadsheet would run as a formula', () => {
  assert.equal(safeText('=HYPERLINK("http://x","y")'), '\'=HYPERLINK("http://x","y")');
  assert.equal(safeText('+1'), "'+1");
  assert.equal(safeText('-Alex'), "'-Alex");
  assert.equal(safeText('@home'), "'@home");
  assert.equal(safeText('Alex'), 'Alex');
  assert.equal(safeText('A=B'), 'A=B');
});

test('safeText also disarms full-width formula characters and flattens line breaks and tabs', () => {
  assert.equal(safeText('\uFF1DSUM(A1)'), "'\uFF1DSUM(A1)");
  assert.equal(safeText('\uFF0B1'), "'\uFF0B1");
  assert.equal(safeText('\uFF0D1'), "'\uFF0D1");
  assert.equal(safeText('\uFF201'), "'\uFF201");
  assert.equal(safeText('two\r\nlines\tand a tab'), 'two lines and a tab');
  assert.equal(safeText('  =1+1'), "'=1+1");
});

test('toCsv writes a byte-order mark and CRLF line endings', () => {
  assert.equal(toCsv([['a', 'b'], ['1', 'x,y']]), '\uFEFFa,b\r\n1,"x,y"\r\n');
});

const event = {
  title: 'Board game weekend',
  timezone: 'America/New_York',
  dates: ['2026-11-21', '2026-11-22'],
  startMinute: 540,
  endMinute: 660,
  slotMinutes: 60,
};
const responses = [
  { name: 'Ana', slots: '1101' },
  { name: '=Ben', slots: '0101' },
];

test('gridRows has one row per time slot and one column per person', () => {
  const rows = gridRows(event, buildSlots(event), responses, 'America/New_York');
  assert.deepEqual(rows, [
    ['Date', 'Day', 'Start', 'End', 'Time zone', 'Start (UTC)', 'Available', 'Responses', 'Ana', "'=Ben"],
    ['2026-11-21', 'Sat', '09:00', '10:00', 'America/New_York', '2026-11-21T14:00:00Z', 1, 2, 1, 0],
    ['2026-11-21', 'Sat', '10:00', '11:00', 'America/New_York', '2026-11-21T15:00:00Z', 2, 2, 1, 1],
    ['2026-11-22', 'Sun', '09:00', '10:00', 'America/New_York', '2026-11-22T14:00:00Z', 0, 2, 0, 0],
    ['2026-11-22', 'Sun', '10:00', '11:00', 'America/New_York', '2026-11-22T15:00:00Z', 2, 2, 1, 1],
  ]);
});

test('gridRows can show times in another zone', () => {
  const rows = gridRows(event, buildSlots(event), responses, 'Asia/Tokyo');
  assert.deepEqual(rows[1].slice(0, 6), ['2026-11-21', 'Sat', '23:00', '00:00', 'Asia/Tokyo', '2026-11-21T14:00:00Z']);
  assert.deepEqual(rows[2].slice(0, 6), ['2026-11-22', 'Sun', '00:00', '01:00', 'Asia/Tokyo', '2026-11-21T15:00:00Z']);
});

test('gridRows tells people with the same name apart', () => {
  const rows = gridRows(event, buildSlots(event), [{ name: 'Sam', slots: '1000' }, { name: 'Sam', slots: '0100' }, { name: 'sam', slots: '0000' }], 'America/New_York');
  assert.deepEqual(rows[0].slice(8), ['Sam', 'Sam (2)', 'sam']);
});

test('gridRows shows the real local time of every slot across a clock change', () => {
  const spring = { timezone: 'America/New_York', dates: ['2026-03-08'], startMinute: 60, endMinute: 240, slotMinutes: 60 };
  const rows = gridRows(spring, buildSlots(spring), [{ name: 'Ana', slots: '111' }], 'America/New_York');
  assert.deepEqual(rows.slice(1).map((r) => [r[2], r[3]]), [['01:00', '03:00'], ['03:00', '04:00'], ['04:00', '05:00']]);
});

test('rangeRows lists each person\'s free time as merged ranges', () => {
  const rows = rangeRows(event, buildSlots(event), responses, 'America/New_York');
  assert.deepEqual(rows, [
    ['Name', 'Date', 'Day', 'Start', 'End', 'Minutes', 'Time zone', 'Answer updated (UTC)'],
    ['Ana', '2026-11-21', 'Sat', '09:00', '11:00', 120, 'America/New_York', ''],
    ['Ana', '2026-11-22', 'Sun', '10:00', '11:00', 60, 'America/New_York', ''],
    ["'=Ben", '2026-11-21', 'Sat', '10:00', '11:00', 60, 'America/New_York', ''],
    ["'=Ben", '2026-11-22', 'Sun', '10:00', '11:00', 60, 'America/New_York', ''],
  ]);
});

test('rangeRows records when each answer was last changed', () => {
  const rows = rangeRows(event, buildSlots(event), [{ name: 'Ana', slots: '1000', updatedAt: Date.UTC(2026, 10, 14, 10, 2, 0) }], 'America/New_York');
  assert.equal(rows[1][7], '2026-11-14T10:02:00Z');
});

test('rangeRows keeps a line for someone who marked nothing', () => {
  const rows = rangeRows(event, buildSlots(event), [{ name: 'Cy', slots: '0000' }], 'America/New_York');
  assert.deepEqual(rows[1], ['Cy', '', '', '', '', 0, 'America/New_York', '']);
});

test('exportFileName is safe on every operating system', () => {
  assert.equal(exportFileName('Board game weekend', 'grid'), 'board-game-weekend-grid.csv');
  assert.equal(exportFileName('../../etc/passwd: "x"', 'people'), 'etc-passwd-x-people.csv');
  assert.equal(exportFileName('', 'grid'), 'event-grid.csv');
  assert.equal(exportFileName('Fête d\'été 🎉', 'grid'), 'fête-d-été-grid.csv');
  assert.ok(exportFileName('x'.repeat(300), 'grid').length <= 80);
});

test('safeText also disarms a formula hidden after a semicolon', () => {
  // Spreadsheets in many countries split CSV lines on semicolons, so each one starts a new cell.
  assert.equal(safeText('x;=1+1;'), "x;'=1+1;");
  assert.equal(safeText('a; =WEBSERVICE(A1)'), "a; '=WEBSERVICE(A1)");
  assert.equal(safeText('one;two;+3;@four'), "one;two;'+3;'@four");
  assert.equal(safeText('Smith; Jr.'), 'Smith; Jr.');
});

test('columnNames numbers repeated names, with or without the spreadsheet escape', () => {
  const people = [{ name: '=Ben' }, { name: 'Sam' }, { name: 'Sam' }];
  assert.deepEqual(columnNames(people), ["'=Ben", 'Sam', 'Sam (2)']);
  assert.deepEqual(columnNames(people, { escape: false }), ['=Ben', 'Sam', 'Sam (2)']);
});

test('exportFileName never cuts a character in half', () => {
  const name = exportFileName('\u{20BB7}'.repeat(50), 'grid');
  assert.equal(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/.test(name), false);
  assert.equal(name.endsWith('-grid.csv'), true);
});

test('columnNames never gives two people the same heading', () => {
  assert.deepEqual(columnNames([{ name: 'Kim' }, { name: 'Kim' }, { name: 'Kim (2)' }], { escape: false }), ['Kim', 'Kim (2)', 'Kim (2) (2)']);
  assert.deepEqual(columnNames([{ name: 'Kim (2)' }, { name: 'Kim' }, { name: 'Kim' }], { escape: false }), ['Kim (2)', 'Kim', 'Kim (3)']);
});

test('csvCell quotes a cell that contains a semicolon', () => {
  assert.equal(csvCell('Smith; Jr.'), '"Smith; Jr."');
});

test('exportFileName keeps the vowel signs of scripts such as Hindi and Thai', () => {
  assert.equal(exportFileName('\u092C\u0948\u0920\u0915 \u0915\u0940 \u092F\u094B\u091C\u0928\u093E', 'grid'), '\u092C\u0948\u0920\u0915-\u0915\u0940-\u092F\u094B\u091C\u0928\u093E-grid.csv');
  assert.equal(exportFileName('\u0E1B\u0E23\u0E30\u0E0A\u0E38\u0E21\u0E17\u0E35\u0E21', 'grid'), '\u0E1B\u0E23\u0E30\u0E0A\u0E38\u0E21\u0E17\u0E35\u0E21-grid.csv');
});
