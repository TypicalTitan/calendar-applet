// A month calendar for picking several days.
//
// Click a day to add or remove it. Drag across days (mouse or pen), or Shift+click, to add or
// remove a run of days. Arrow keys move, Space or Enter switches a day, Page Up/Down change month.

import { monthMatrix, addDays, dateRange } from '../core/dates.js';
import { h, icon } from './dom.js';
import { fullDate, monthYear, weekdayNames, weekStart, daysSummary, plural } from './format.js';

export function createDatePicker({ value = [], min, max, limit, label, onChange = () => {} }) {
  const selected = new Set(value);
  const start = weekStart();
  const firstShown = [...selected].sort()[0] || min;
  let year = Number(firstShown.slice(0, 4));
  let month = Number(firstShown.slice(5, 7));
  let focusDate = firstShown;
  let anchor = null;      // last day clicked, for Shift+click
  let drag = null;        // { from, to, adding }
  let lastPointerAt = -Infinity;

  const title = h('div', { class: 'cal-title', 'aria-live': 'polite' });
  const prev = h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Previous month', onclick: () => step(-1) }, icon('left'));
  const next = h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Next month', onclick: () => step(1) }, icon('right'));
  const body = h('tbody');
  const grid = h('table', { class: 'cal-grid', role: 'grid', 'aria-label': label, 'aria-multiselectable': 'true' },
    h('thead', null, h('tr', null, weekdayNames(start).map((d) => h('th', { scope: 'col', abbr: d.long }, d.short)))),
    body);
  const summary = h('p', { class: 'cal-summary muted', 'aria-live': 'polite' });
  const root = h('div', { class: 'cal' },
    h('div', { class: 'cal-head' }, prev, title, next),
    grid, summary);

  const allowed = (date) => date >= min && date <= max;
  const monthOf = (date) => [Number(date.slice(0, 4)), Number(date.slice(5, 7))];
  const inDrag = (date) => drag && date >= (drag.from < drag.to ? drag.from : drag.to) && date <= (drag.from < drag.to ? drag.to : drag.from);
  const isOn = (date) => (inDrag(date) ? drag.adding : selected.has(date));

  function sorted() { return [...selected].sort(); }

  function describe(note) {
    const dates = sorted();
    const count = dates.length ? `${plural(dates.length, 'day', 'days')}: ${daysSummary(dates)}` : 'No days picked yet.';
    summary.textContent = note ? `${count} ${note}` : count;
  }

  function apply(dates, adding) {
    let refused = false;
    for (const date of dates) {
      if (!allowed(date)) continue;
      if (!adding) selected.delete(date);
      else if (selected.size < limit || selected.has(date)) selected.add(date);
      else refused = true;
    }
    draw();
    describe(refused ? `That is the most an event can have (${limit}).` : '');
    onChange(sorted());
  }

  function draw() {
    title.textContent = monthYear(year, month);
    const today = min;
    body.replaceChildren(...monthMatrix(year, month, start).map((week) => h('tr', null, week.map((date) => {
      if (!date) return h('td', { class: 'cal-empty' });
      const disabled = !allowed(date);
      return h('td', {
        class: `cal-day${date === today ? ' is-today' : ''}`,
        role: 'gridcell',
        tabindex: date === focusDate ? '0' : '-1',
        dataset: { date },
        'aria-label': fullDate(date),
        'aria-selected': isOn(date) ? 'true' : 'false',
        'aria-disabled': disabled ? 'true' : null,
      }, String(Number(date.slice(8))));
    }))));
    const [minYear, minMonth] = monthOf(min);
    const [maxYear, maxMonth] = monthOf(max);
    prev.disabled = year < minYear || (year === minYear && month <= minMonth);
    next.disabled = year > maxYear || (year === maxYear && month >= maxMonth);
  }

  function step(delta) {
    month += delta;
    if (month < 1) { month = 12; year -= 1; }
    if (month > 12) { month = 1; year += 1; }
    const [fy, fm] = monthOf(focusDate);
    if (fy !== year || fm !== month) {
      focusDate = `${year}-${String(month).padStart(2, '0')}-01`;
      if (focusDate < min) focusDate = min;
      if (focusDate > max) focusDate = max;
    }
    draw();
  }

  function focusOn(date) {
    if (date < min) date = min;
    if (date > max) date = max;
    focusDate = date;
    [year, month] = monthOf(date);
    draw();
    body.querySelector(`[data-date="${date}"]`)?.focus();
  }

  const dateOf = (target) => (target instanceof Element ? target.closest('.cal-day')?.dataset.date : undefined);

  function click(date, shift) {
    if (!date || !allowed(date)) return;
    focusDate = date;
    if (shift && anchor) apply(dateRange(anchor, date), selected.has(anchor));
    else apply([date], !selected.has(date));
    anchor = date;
    body.querySelector(`[data-date="${date}"]`)?.focus();
  }

  grid.addEventListener('pointerdown', (e) => {
    const date = dateOf(e.target);
    if (!date || !allowed(date)) return;
    lastPointerAt = performance.now();
    if (e.pointerType === 'touch' || e.button !== 0 || e.shiftKey) return; // handled on pointerup as a tap/click
    e.preventDefault();
    drag = { from: date, to: date, adding: !selected.has(date), pointerId: e.pointerId };
    try { grid.setPointerCapture(e.pointerId); } catch { /* fine without capture */ }
    focusDate = date;
    draw();
  });
  grid.addEventListener('pointermove', (e) => {
    if (!drag || e.pointerId !== drag.pointerId) return;
    const date = dateOf(document.elementFromPoint(e.clientX, e.clientY));
    if (date && allowed(date) && date !== drag.to) { drag.to = date; draw(); }
  });
  grid.addEventListener('pointerup', (e) => {
    lastPointerAt = performance.now();
    if (e.pointerType !== 'touch' && e.button !== 0) return; // a right or middle click is not a pick
    if (drag && e.pointerId === drag.pointerId) {
      const { from, to, adding } = drag;
      drag = null;
      anchor = to;
      focusDate = to;
      apply(dateRange(from, to), adding);
      body.querySelector(`[data-date="${to}"]`)?.focus();
      return;
    }
    click(dateOf(e.target), e.shiftKey);
  });
  grid.addEventListener('pointercancel', () => { if (drag) { drag = null; draw(); } });
  grid.addEventListener('click', (e) => {
    // Clicks with no pointer event behind them come from assistive technology.
    if (performance.now() - lastPointerAt < 700) return;
    click(dateOf(e.target), false);
  });
  grid.addEventListener('keydown', (e) => {
    const date = dateOf(e.target);
    if (!date) return;
    const moves = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 };
    if (e.key in moves) { e.preventDefault(); focusOn(addDays(date, moves[e.key])); return; }
    if (e.key === 'PageUp' || e.key === 'PageDown') { e.preventDefault(); focusOn(addDays(date, e.key === 'PageUp' ? -28 : 28)); return; }
    if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); click(date, e.shiftKey); }
  });

  draw();
  describe('');

  return {
    el: root,
    getValue: sorted,
    clear() { selected.clear(); draw(); describe(''); onChange([]); },
  };
}
