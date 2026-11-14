// The timetable: one column per event day, one row per slot.
//
// Two flavours share the same table:
//   createPaintGrid  an invitee marks the times they are free
//   createHeatGrid   the organizer sees how many people are free at each time
//
// Both are a WAI-ARIA grid: one cell is in the tab order, arrow keys move between cells.

import { describeGrid } from '../core/slots.js';
import { utcToWall } from '../core/tz.js';
import { daysBetween } from '../core/dates.js';
import { heatScale } from '../core/availability.js';
import { h } from './dom.js';
import {
  longDate, weekdayShort, dayNumber, monthShort, timeLabel, hourLabel, shiftLabel, shiftBadge,
} from './format.js';

const HOLD_MS = 300; // how long a finger rests before a drag paints instead of scrolling
const SLOP_PX = 10;

/** "Saturday, November 21, 9:00 AM": the exact local start of a slot. */
export function slotName(event, slots, index, zone) {
  const wall = utcToWall(slots.utc[index], zone);
  return `${longDate(wall.date)}, ${timeLabel(wall.minute)}`;
}

function buildTable({ event, slots, zone, label, multiselect, describedBy }) {
  const layout = describeGrid(event, slots, zone);
  const { perDay } = slots;
  const cells = new Array(slots.count);
  const names = new Array(slots.count);

  const headRow = h('tr', null, h('td', { class: 'tt-corner' }));
  layout.columns.forEach((column, d) => {
    const previous = layout.columns[d - 1];
    const newMonth = !previous || previous.date.slice(0, 7) !== column.date.slice(0, 7);
    const afterGap = previous && daysBetween(previous.date, column.date) > 1;
    const wholeColumnShift = column.shifts[0] && column.shifts[0].k === 0 ? column.shifts[0].minutes : 0;
    const notes = [];
    if (column.lastDate !== column.date) notes.push(`to ${weekdayShort(column.lastDate)} ${dayNumber(column.lastDate)}`);
    if (wholeColumnShift) notes.push(shiftLabel(wholeColumnShift));
    headRow.append(h('th', {
      scope: 'col',
      class: `tt-col${afterGap ? ' is-month-start' : ''}`,
      'aria-label': [longDate(column.date), ...notes].join(', '),
    },
      h('span', { class: 'mo' }, newMonth ? monthShort(column.date) : ''),
      h('span', { class: 'wd' }, weekdayShort(column.date)),
      h('span', { class: 'dn' }, dayNumber(column.date)),
      notes.map((note) => h('span', { class: 'note' }, note))));
  });

  const body = h('tbody');
  layout.rows.forEach((row, k) => {
    const previous = layout.rows[k - 1];
    const nextDay = previous ? row.dayOffset > previous.dayOffset : false;
    const tr = h('tr', { class: `tt-row${row.minute % 60 === 0 ? ' is-hour' : ''}${nextDay ? ' is-nextday' : ''}` },
      h('th', { scope: 'row', class: 'tt-time' },
        row.labelled ? h('span', null, hourLabel(row.minute)) : h('span', { class: 'vh' }, timeLabel(row.minute)),
        nextDay ? h('span', { class: 'next' }, 'next day') : null));
    layout.columns.forEach((column, d) => {
      const index = d * perDay + k;
      const shift = column.shifts.find((s) => s.k === k && k > 0);
      names[index] = slotName(event, slots, index, zone);
      const cell = h('td', {
        class: 'tt-cell',
        role: 'gridcell',
        tabindex: '-1',
        dataset: { i: String(index) },
        'aria-label': names[index],
      }, shift ? h('span', { class: 'shift', 'aria-hidden': 'true' }, shiftBadge(shift.minutes)) : null);
      cells[index] = cell;
      tr.append(cell);
    });
    body.append(tr);
  });

  const table = h('table', {
    class: `tt-table tt-s${event.slotMinutes}`,
    role: 'grid',
    'aria-label': label,
    'aria-multiselectable': multiselect ? 'true' : null,
    'aria-describedby': describedBy || null,
    'aria-rowcount': String(perDay + 1),
    'aria-colcount': String(layout.columns.length + 1),
  }, h('thead', null, headRow), body);
  table.style.setProperty('--cols', String(layout.columns.length));
  return { table, cells, names };
}

function indexOfCell(table, target) {
  const cell = target instanceof Element ? target.closest('.tt-cell') : null;
  return cell && table.contains(cell) ? Number(cell.dataset.i) : -1;
}

/** Where an arrow, Home/End or Page key takes the focus; -1 if the key is not a movement key. */
function moveTarget(key, index, perDay, days) {
  let d = Math.floor(index / perDay);
  let k = index % perDay;
  switch (key) {
    case 'ArrowRight': d += 1; break;
    case 'ArrowLeft': d -= 1; break;
    case 'ArrowDown': k += 1; break;
    case 'ArrowUp': k -= 1; break;
    case 'Home': d = 0; break;
    case 'End': d = days - 1; break;
    case 'PageUp': k = 0; break;
    case 'PageDown': k = perDay - 1; break;
    default: return -1;
  }
  d = Math.min(days - 1, Math.max(0, d));
  k = Math.min(perDay - 1, Math.max(0, k));
  return d * perDay + k;
}

/**
 * A grid for marking free times.
 *   value      Uint8Array-like, one flag per slot
 *   onChange   called with a fresh Uint8Array after every completed change
 *
 * Mouse and pen: press and drag to mark a block (or clear one, if the drag starts on a marked
 * cell). Touch: tap a cell to switch it; press and hold, then drag, to mark a block, so an
 * ordinary swipe still scrolls the page. Keyboard: arrows move, Space or Enter switches a cell,
 * Shift+arrow carries the current cell's state to the next one.
 */
export function createPaintGrid({ event, slots, zone, value, readOnly = false, label, describedBy, onChange = () => {}, onPreview = () => {} }) {
  const { perDay, count } = slots;
  const days = event.dates.length;
  let bits = Uint8Array.from(value);
  let shown = new Uint8Array(count).fill(2);
  let drag = null;
  let hold = null;
  let focusIndex = 0;
  let lastPointerAt = -Infinity;
  let table;
  let cells;

  const scroller = h('div', { class: 'tt-scroll' });
  const root = h('div', { class: 'tt tt-paint' }, scroller);

  const inDrag = (i) => {
    if (!drag) return false;
    const d = Math.floor(i / perDay);
    const k = i % perDay;
    const d0 = Math.floor(drag.anchor / perDay);
    const d1 = Math.floor(drag.current / perDay);
    const k0 = drag.anchor % perDay;
    const k1 = drag.current % perDay;
    return d >= Math.min(d0, d1) && d <= Math.max(d0, d1) && k >= Math.min(k0, k1) && k <= Math.max(k0, k1);
  };

  // Tells the page what the drag in progress covers, so it can say so in words: the finger or
  // cursor hides the cells being painted.
  function announcePreview() {
    if (!drag) { onPreview(null); return; }
    const d = [Math.floor(drag.anchor / perDay), Math.floor(drag.current / perDay)];
    const k = [drag.anchor % perDay, drag.current % perDay];
    onPreview({
      adding: drag.mode === 1,
      firstIndex: Math.min(...d) * perDay + Math.min(...k),
      lastIndex: Math.max(...d) * perDay + Math.max(...k),
      days: Math.abs(d[0] - d[1]) + 1,
      slotsPerDay: Math.abs(k[0] - k[1]) + 1,
    });
  }

  // The cell under a point. A pointer that has left the grid counts as the nearest edge cell.
  function indexAtPoint(x, y) {
    const direct = indexOfCell(table, document.elementFromPoint(x, y));
    if (direct >= 0) return direct;
    const body = table.tBodies[0].getBoundingClientRect();
    const first = cells[0].getBoundingClientRect();
    const view = scroller.getBoundingClientRect();
    // The part of the cells actually on screen: inside the grid's scroll box and the window.
    const left = Math.max(first.left, view.left, 0) + 2;
    const right = Math.min(body.right, view.right, window.innerWidth) - 2;
    const top = Math.max(body.top, view.top, 0) + 2;
    const bottom = Math.min(body.bottom, view.bottom, window.innerHeight) - 2;
    if (right < left || bottom < top) return -1;
    return indexOfCell(table, document.elementFromPoint(Math.min(right, Math.max(left, x)), Math.min(bottom, Math.max(top, y))));
  }

  function render() {
    for (let i = 0; i < count; i++) {
      const on = inDrag(i) ? drag.mode : bits[i];
      if (shown[i] !== on) {
        cells[i].setAttribute('aria-selected', on ? 'true' : 'false');
        shown[i] = on;
      }
    }
  }

  function setFocus(index, moveFocus) {
    cells[focusIndex].tabIndex = -1;
    focusIndex = index;
    cells[index].tabIndex = 0;
    if (moveFocus) cells[index].focus({ preventScroll: false });
  }

  // While a drag is under way, Escape abandons it wherever the keyboard focus happens to be
  // (usually still in the name box).
  const onEscape = (e) => { if (e.key === 'Escape' && drag) { e.preventDefault(); finish(false); } };

  function begin(index, pointerId, touch) {
    drag = { anchor: index, current: index, mode: bits[index] ? 0 : 1, pointerId, touch };
    document.addEventListener('keydown', onEscape, true);
    root.classList.add('is-painting');
    setFocus(index, false);
    render();
    announcePreview();
  }

  function finish(commit) {
    if (!drag) return;
    if (commit) for (let i = 0; i < count; i++) if (inDrag(i)) bits[i] = drag.mode;
    drag = null;
    document.removeEventListener('keydown', onEscape, true);
    root.classList.remove('is-painting');
    render();
    announcePreview();
    if (commit) onChange(bits.slice());
  }

  function toggle(index) {
    bits[index] = bits[index] ? 0 : 1;
    setFocus(index, false);
    render();
    onChange(bits.slice());
  }

  function cancelHold() {
    if (hold) clearTimeout(hold.timer);
    hold = null;
  }

  function onPointerDown(e) {
    const index = indexOfCell(table, e.target);
    if (readOnly || index < 0 || drag) return;
    lastPointerAt = performance.now();
    if (e.pointerType === 'touch') {
      cancelHold();
      hold = {
        index, x: e.clientX, y: e.clientY, pointerId: e.pointerId,
        timer: setTimeout(() => {
          const held = hold;
          hold = null;
          begin(held.index, held.pointerId, true);
          if (navigator.vibrate) navigator.vibrate(8);
        }, HOLD_MS),
      };
      return;
    }
    if (e.button !== 0) return;
    e.preventDefault();
    begin(index, e.pointerId, false);
    try { table.setPointerCapture(e.pointerId); } catch { /* the drag still works without capture */ }
  }

  function onPointerMove(e) {
    if (hold && e.pointerId === hold.pointerId) {
      if (Math.hypot(e.clientX - hold.x, e.clientY - hold.y) > SLOP_PX) cancelHold();
      return;
    }
    if (!drag || e.pointerId !== drag.pointerId) return;
    const index = indexAtPoint(e.clientX, e.clientY);
    if (index >= 0 && index !== drag.current) {
      drag.current = index;
      render();
      announcePreview();
    }
  }

  function onPointerUp(e) {
    lastPointerAt = performance.now();
    if (hold && e.pointerId === hold.pointerId) {
      const { index } = hold;
      cancelHold();
      toggle(index); // a tap
      return;
    }
    if (drag && e.pointerId === drag.pointerId) finish(true);
  }

  function onPointerCancel(e) {
    if (hold && e.pointerId === hold.pointerId) cancelHold();
    if (drag && e.pointerId === drag.pointerId) finish(false);
  }

  function onClick(e) {
    // Pointer input is handled above. A click with no recent pointer event comes from assistive
    // technology activating the cell.
    if (readOnly || performance.now() - lastPointerAt < 700) return;
    const index = indexOfCell(table, e.target);
    if (index >= 0) toggle(index);
  }

  function onKeyDown(e) {
    if (e.altKey || e.ctrlKey || e.metaKey) return;
    if (e.key === ' ' || e.key === 'Enter') {
      e.preventDefault();
      if (!readOnly) toggle(focusIndex);
      return;
    }
    const target = moveTarget(e.key, focusIndex, perDay, days);
    if (target < 0) return;
    e.preventDefault();
    if (e.shiftKey && !readOnly && target !== focusIndex) {
      bits[target] = bits[focusIndex];
      render();
      onChange(bits.slice());
    }
    setFocus(target, true);
  }

  function mount(displayZone) {
    ({ table, cells } = buildTable({ event, slots, zone: displayZone, label, multiselect: true, describedBy }));
    shown = new Uint8Array(count).fill(2);
    focusIndex = Math.min(focusIndex, Math.max(0, count - 1));
    if (count > 0) cells[focusIndex].tabIndex = 0;
    table.addEventListener('pointerdown', onPointerDown);
    table.addEventListener('pointermove', onPointerMove);
    table.addEventListener('pointerup', onPointerUp);
    table.addEventListener('pointercancel', onPointerCancel);
    // Capture can be taken away without a pointerup (another window, a system gesture): give up
    // on the drag rather than leave it stuck.
    table.addEventListener('lostpointercapture', (e) => { if (drag && e.pointerId === drag.pointerId) finish(false); });
    table.addEventListener('click', onClick);
    table.addEventListener('keydown', onKeyDown);
    table.addEventListener('focusin', (e) => {
      const index = indexOfCell(table, e.target);
      if (index >= 0 && index !== focusIndex) setFocus(index, false);
    });
    // Once a held finger has started painting, stop the page from scrolling under it.
    table.addEventListener('touchmove', (e) => { if (drag && drag.touch && e.cancelable) e.preventDefault(); }, { passive: false });
    table.addEventListener('contextmenu', (e) => { if (hold || drag) e.preventDefault(); });
    table.addEventListener('dragstart', (e) => e.preventDefault());
    scroller.replaceChildren(table);
    root.classList.toggle('is-readonly', readOnly);
    render();
  }

  mount(zone);

  const abandon = () => { cancelHold(); finish(false); };
  window.addEventListener('blur', abandon);

  return {
    el: root,
    destroy() { window.removeEventListener('blur', abandon); abandon(); },
    getValue: () => bits.slice(),
    setValue(next) { bits = Uint8Array.from(next); render(); },
    setZone(next) { finish(false); cancelHold(); mount(next); },
    setReadOnly(next) { readOnly = next; root.classList.toggle('is-readonly', readOnly); },
    clear() { bits = new Uint8Array(count); render(); onChange(bits.slice()); },
  };
}

/**
 * A grid shaded by how many people are free.
 *   setData({ counts, total })           one number per slot, out of `total` people
 *   setData({ counts, total, person })   also given one person's flags: show only their times
 *   onSelect(index)                      a cell was picked (or -1 when unpicked)
 */
export function createHeatGrid({ event, slots, zone, label, onSelect = () => {} }) {
  const { perDay, count } = slots;
  const days = event.dates.length;
  let counts = new Array(count).fill(0);
  let total = 0;
  let person = null;
  let selected = -1;
  let focusIndex = 0;
  let lit = new Set();
  let table;
  let cells;
  let names = [];

  const scroller = h('div', { class: 'tt-scroll' });
  const tip = h('div', { class: 'tt-tip', hidden: true, 'aria-hidden': 'true' });
  const root = h('div', { class: 'tt tt-heat' }, scroller, tip);

  // Before anyone has answered there is nothing to pick or to count.
  const empty = () => !person && total === 0;
  const describe = (i) => (person ? (person[i] ? 'free' : 'not free') : empty() ? 'no answers yet' : `${counts[i]} of ${total} free`);

  function render() {
    root.classList.toggle('is-person', Boolean(person));
    root.classList.toggle('is-empty', empty());
    const scale = heatScale(person ? 1 : counts.reduce((a, b) => Math.max(a, b), 0));
    for (let i = 0; i < count; i++) {
      const cell = cells[i];
      const shade = scale.classOf(person ? person[i] : counts[i]);
      cell.dataset.n = String(shade);
      cell.style.setProperty('--t', String(shadeStrength(shade, scale.classes)));
      cell.classList.toggle('is-all', !person && total >= 2 && counts[i] === total);
      cell.setAttribute('aria-label', `${names[i]}, ${describe(i)}`);
      cell.setAttribute('aria-selected', i === selected ? 'true' : 'false');
      cell.classList.toggle('is-lit', lit.has(i));
    }
  }

  function setFocus(index, moveFocus) {
    cells[focusIndex].tabIndex = -1;
    focusIndex = index;
    cells[index].tabIndex = 0;
    if (moveFocus) cells[index].focus();
  }

  function select(index) {
    if (empty()) return;
    selected = index === selected ? -1 : index;
    if (index >= 0) setFocus(index, false);
    render();
    onSelect(selected);
  }

  function showTip(index) {
    if (index < 0 || empty()) { tip.hidden = true; return; }
    const cell = cells[index].getBoundingClientRect();
    const box = root.getBoundingClientRect();
    tip.textContent = describe(index);
    tip.style.left = `${cell.left - box.left + cell.width / 2}px`;
    tip.style.top = `${cell.top - box.top}px`;
    tip.hidden = false;
  }

  function mount(displayZone) {
    ({ table, cells, names } = buildTable({ event, slots, zone: displayZone, label, multiselect: false }));
    focusIndex = Math.min(focusIndex, Math.max(0, count - 1));
    if (count > 0) cells[focusIndex].tabIndex = 0;
    table.addEventListener('click', (e) => {
      const index = indexOfCell(table, e.target);
      if (index >= 0) select(index);
    });
    table.addEventListener('keydown', (e) => {
      if (e.altKey || e.ctrlKey || e.metaKey) return;
      if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); select(focusIndex); return; }
      const target = moveTarget(e.key, focusIndex, perDay, days);
      if (target < 0) return;
      e.preventDefault();
      setFocus(target, true);
    });
    table.addEventListener('focusin', (e) => {
      const index = indexOfCell(table, e.target);
      if (index < 0) return;
      if (index !== focusIndex) setFocus(index, false);
      if (cells[index].matches(':focus-visible')) showTip(index);
    });
    table.addEventListener('focusout', () => showTip(-1));
    table.addEventListener('pointermove', (e) => { if (e.pointerType === 'mouse') showTip(indexOfCell(table, e.target)); });
    table.addEventListener('pointerleave', () => showTip(-1));
    scroller.addEventListener('scroll', () => showTip(-1), { passive: true });
    scroller.replaceChildren(table);
    render();
  }

  mount(zone);

  return {
    el: root,
    setData(next) {
      counts = next.counts;
      total = next.total;
      person = next.person || null;
      if (empty()) selected = -1; // the last answer went: nothing stays picked
      render();
    },
    setZone(next) { mount(next); },
    setHighlight(indices) { lit = new Set(indices); render(); },
    select(index) { selected = index; render(); },
    get selected() { return selected; },
  };
}

/** Where a shade sits between the lightest (0) and the darkest (1). */
function shadeStrength(shade, classes) {
  return classes <= 1 ? 1 : (shade - 1) / (classes - 1);
}

/** The key to the shading: one swatch per shade in use, labelled with the head-counts it covers. */
export function heatLegend(counts, total) {
  const scale = heatScale(counts.reduce((a, b) => Math.max(a, b), 0));
  const everyone = total >= 2 && counts.some((n) => n === total);
  return h('div', { class: 'legend-scale' },
    h('span', null, 'People free'),
    h('ol', null, scale.ranges.map(([low, high], shade) => h('li', null,
      h('span', { class: 'sw', dataset: { n: String(shade) }, style: { '--t': String(shadeStrength(shade, scale.classes)) } }),
      h('span', null, low === high ? String(low) : `${low}\u2013${high}`)))),
    everyone ? h('span', { class: 'legend-all' }, h('span', { class: 'sw-all', 'aria-hidden': 'true' }), 'everyone') : null);
}
