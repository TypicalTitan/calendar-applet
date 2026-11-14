// Tidying text that people type, before it is stored or shown.

// Characters that are invisible or reorder surrounding text. Joiners needed by emoji and by
// scripts such as Persian (U+200C, U+200D) are deliberately kept.
const INVISIBLE = /[\u200B\u2060\uFEFF\u202A-\u202E\u2066-\u2069]/gu;
const CONTROL = /\p{Cc}/gu;
const CONTROL_EXCEPT_NEWLINE = /[^\P{Cc}\n]/gu;

/** One line: no control or invisible characters, runs of white space become one space. */
export function tidyLine(value) {
  if (typeof value !== 'string') return '';
  return value.normalize('NFC').replace(/\s+/gu, ' ').replace(CONTROL, '').replace(INVISIBLE, '').trim();
}

/** Several lines: as tidyLine, but line breaks survive (always as "\n"). */
export function tidyText(value) {
  if (typeof value !== 'string') return '';
  return value
    .normalize('NFC')
    .replace(/\r\n?/g, '\n')
    .replace(CONTROL_EXCEPT_NEWLINE, '')
    .replace(INVISIBLE, '')
    .replace(/[^\S\n]+/gu, ' ')
    .replace(/ ?\n ?/g, '\n')
    .trim();
}

/** Shortens to at most `max` UTF-16 units without cutting a character in half. */
export function truncate(text, max) {
  let out = '';
  for (const ch of text) {
    if (out.length + ch.length > max) break;
    out += ch;
  }
  return out;
}
