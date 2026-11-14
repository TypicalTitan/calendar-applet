// Tidying text that people type, before it is stored or shown.
//
// Every function here gives the same result when applied to its own output. That matters: an
// event's name is tidied when it is saved and checked again when it is read, and the two must
// agree.

// Characters that are invisible or reorder surrounding text. Joiners needed by emoji and by
// scripts such as Persian (U+200C, U+200D) are deliberately kept.
const INVISIBLE = /[​‎‏؜⁠﻿‪-‮⁦-⁩]/gu;
const CONTROL = /\p{Cc}/gu;
const CONTROL_EXCEPT_NEWLINE = /[^\P{Cc}\n]/gu;
// Half of a two-part character with its other half missing (no "u" flag: this works on halves).
const BROKEN_HALF = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g;

/** One line: no control or invisible characters, runs of white space become one space. */
export function tidyLine(value) {
  if (typeof value !== 'string') return '';
  return value
    .replace(BROKEN_HALF, '')
    .replace(/\s+/gu, ' ')       // tabs and line breaks become spaces before controls are dropped
    .replace(CONTROL, '')
    .replace(INVISIBLE, '')
    .normalize('NFC')            // after the removals, so an accent can join the letter before it
    .replace(/ {2,}/g, ' ')      // removing something between two spaces leaves two spaces
    .trim();
}

/** Several lines: as tidyLine, but line breaks survive (always as "\n"). */
export function tidyText(value) {
  if (typeof value !== 'string') return '';
  return value
    .replace(BROKEN_HALF, '')
    .replace(/\r\n?/g, '\n')
    .replace(/[^\S\n]+/gu, ' ')
    .replace(CONTROL_EXCEPT_NEWLINE, '')
    .replace(INVISIBLE, '')
    .normalize('NFC')
    .replace(/ {2,}/g, ' ')
    .replace(/ ?\n ?/g, '\n')
    .trim();
}

// Everything that takes up no ink: format characters, combining marks on their own, spaces, and
// the "filler" letters that render as blanks.
const NOTHING_TO_SEE = /[\p{Cf}\p{Mn}\p{Z}\u034F\u115F\u1160\u2800\u3164\uFFA0]/gu;

/** True when the text would show as nothing at all. */
export function looksBlank(text) {
  return text.replace(NOTHING_TO_SEE, '') === '';
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
