import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tidyLine, tidyText, looksBlank, truncate } from '../../js/core/text.js';

// Hostile and ordinary pieces to build test strings from.
const PIECES = ['Team', 'sync', ' ', '  ', '\t', '\n', '\r\n', '\u200B', '\u200E', '\u2069', '\u0007', '\u0301', 'Cafe', 'e\u0301', '\u00E9',
  '\u200D', '\u{1F469}\u200D\u{1F4BB}', '\uD83D', '\u3164', '\u00A0', 'a', 'Z', '9', '-', '\u0639\u200C\u0631'];

function samples(count) {
  const out = [];
  let seed = 12345;
  const next = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed; };
  for (let n = 0; n < count; n++) {
    let text = '';
    const parts = 1 + (next() % 7);
    for (let i = 0; i < parts; i++) text += PIECES[next() % PIECES.length];
    out.push(text);
  }
  return out;
}

test('tidyLine gives the same result when applied twice', () => {
  for (const text of samples(4000)) {
    const once = tidyLine(text);
    assert.equal(tidyLine(once), once, JSON.stringify(text));
  }
});

test('tidyText gives the same result when applied twice', () => {
  for (const text of samples(4000)) {
    const once = tidyText(text);
    assert.equal(tidyText(once), once, JSON.stringify(text));
  }
});

test('tidyLine removes an invisible character between two spaces without leaving a double space', () => {
  assert.equal(tidyLine('Team \u200B sync'), 'Team sync');
  assert.equal(tidyLine('Team \u0007 sync'), 'Team sync');
  assert.equal(tidyLine('Cafe\u200B\u0301'), 'Caf\u00E9');
});

test('tidyText turns tabs into spaces instead of gluing words together', () => {
  assert.equal(tidyText('Mon\t9am\nTue\t10am'), 'Mon 9am\nTue 10am');
});

test('tidy functions never leave half a character behind', () => {
  assert.equal(tidyLine('x\uD83D').isWellFormed(), true);
  assert.equal(tidyText('x\uDC00y').isWellFormed(), true);
});

test('looksBlank spots text with nothing visible in it', () => {
  assert.equal(looksBlank('\u200E\u200F\u061C'), true);
  assert.equal(looksBlank(' '), true);
  assert.equal(looksBlank('a'), false);
});

test('truncate cuts on whole characters', () => {
  assert.equal(truncate('ab\u{1F600}cd', 3), 'ab');
  assert.equal(truncate('abc', 10), 'abc');
});
