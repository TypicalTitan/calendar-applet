// Small DOM helpers. Text always goes in through textContent or text nodes, never as HTML, so
// nothing a person types (names, event titles) can ever be run as markup.

const SVG_NS = 'http://www.w3.org/2000/svg';

/**
 * h('button', { class: 'btn', onclick: fn, 'aria-label': 'Close' }, 'Close')
 * Props: `class`, `dataset` (object), `style` (object of CSS properties), `on<event>` handlers,
 * DOM properties that exist on the element, and anything else as an attribute.
 * Children: nodes, strings, numbers, arrays of those; null, undefined and false are skipped.
 */
export function h(tag, props, ...children) {
  const el = document.createElement(tag);
  if (props) {
    for (const [key, value] of Object.entries(props)) {
      if (value === null || value === undefined || value === false) continue;
      if (key === 'class') el.className = value;
      else if (key === 'dataset') Object.assign(el.dataset, value);
      else if (key === 'style') for (const [k, v] of Object.entries(value)) el.style.setProperty(k, v);
      else if (key.startsWith('on') && typeof value === 'function') el.addEventListener(key.slice(2), value);
      else if (key in el && !key.startsWith('aria-') && key !== 'role' && key !== 'list' && key !== 'form') el[key] = value;
      else el.setAttribute(key, value === true ? '' : String(value));
    }
  }
  append(el, children);
  return el;
}

export function append(parent, children) {
  for (const child of children) {
    if (child === null || child === undefined || child === false) continue;
    if (Array.isArray(child)) append(parent, child);
    else parent.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return parent;
}

export function replace(parent, ...children) {
  parent.replaceChildren();
  return append(parent, children);
}

const ICONS = {
  trash: 'M5 7h14 M10 7V4h4v3 M7 7l1 13h8l1-13',
  left: 'M14.5 6l-6 6 6 6',
  right: 'M9.5 6l6 6-6 6',
  x: 'M6 6l12 12 M18 6L6 18',
};

/** A small stroked icon. Decorative: hidden from screen readers. */
export function icon(name) {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '2');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  const path = document.createElementNS(SVG_NS, 'path');
  path.setAttribute('d', ICONS[name]);
  svg.append(path);
  return svg;
}

/** The wordmark's glyph: two marker strokes and the darker patch where they overlap. */
export function logoMark() {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 30 22');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  const rect = (cls, x, y, w, hgt) => {
    const r = document.createElementNS(SVG_NS, 'rect');
    r.setAttribute('class', cls);
    r.setAttribute('x', x); r.setAttribute('y', y); r.setAttribute('width', w); r.setAttribute('height', hgt); r.setAttribute('rx', 2);
    return r;
  };
  svg.append(rect('mark-a', 0, 0, 19, 14), rect('mark-b', 11, 8, 19, 14), rect('mark-c', 11, 8, 8, 6));
  return svg;
}

let toastRegion;
let errorRegion;

/**
 * A short notice that also reaches screen readers.
 * A confirmation ("Link copied") goes away by itself. A failure, `toast(message, { error: true })`,
 * stays until it is dismissed: something did not happen, and the person must not miss that.
 */
export function toast(message, { error = false } = {}) {
  if (!toastRegion) {
    errorRegion = h('div', { class: 'toasts-errors' });
    toastRegion = h('div', { class: 'toasts-passing', role: 'status', 'aria-live': 'polite' });
    document.body.append(h('div', { class: 'toasts' }, errorRegion, toastRegion));
  }
  if (error) {
    const item = h('div', { class: 'toast toast-error', role: 'alert' },
      h('span', null, message),
      h('button', { type: 'button', class: 'toast-close', 'aria-label': 'Dismiss', onclick: () => item.remove() }, icon('x')));
    errorRegion.replaceChildren(item); // one at a time: a newer failure replaces an older one
    return;
  }
  const item = h('div', { class: 'toast' }, message);
  toastRegion.append(item);
  setTimeout(() => item.remove(), 4000);
}

/**
 * A modal question. Resolves true if the person confirms, false if they cancel.
 * `body` may be a string or a node (for example form fields).
 * `onConfirm`, if given, runs when they confirm; returning false keeps the dialog open, so a form
 * inside it can show what needs fixing.
 */
export function confirmDialog({ title, body, confirmLabel, danger = false, cancelLabel = 'Cancel', onConfirm }) {
  return new Promise((resolve) => {
    let busy = false;
    async function submit(e) {
      e.preventDefault();
      if (busy) return;
      if (!onConfirm) { done(true); return; }
      busy = true;
      try {
        if (await onConfirm() !== false) done(true);
      } finally {
        busy = false;
      }
    }
    const dialog = h('dialog', { 'aria-labelledby': 'dialog-title' },
      h('form', { method: 'dialog', novalidate: true, onsubmit: submit },
        h('h2', { id: 'dialog-title' }, title),
        typeof body === 'string' ? h('p', { class: 'muted' }, body) : body,
        h('div', { class: 'actions' },
          h('button', { type: 'button', class: 'btn btn-quiet', onclick: () => done(false) }, cancelLabel),
          h('button', { type: 'submit', class: danger ? 'btn btn-danger' : 'btn' }, confirmLabel))));
    let settled = false;
    function done(result) {
      if (settled) return;
      settled = true;
      dialog.close();
      dialog.remove();
      resolve(result);
    }
    dialog.addEventListener('cancel', (e) => { e.preventDefault(); done(false); });
    document.body.append(dialog);
    dialog.showModal();
  });
}

/** Copies text, reporting whether it worked so the caller can say so. */
export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

/** Hands a file to the browser to save. */
export function downloadFile(name, text, type = 'text/csv;charset=utf-8') {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const link = h('a', { href: url, download: name, hidden: true });
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 40_000); // revoking at once can cancel the save in some browsers
}

let ids = 0;
/**
 * Marks a button as busy without disabling it. A disabled button throws away the keyboard
 * focus; this one keeps it and looks the same, and its handler checks isBusy() before acting.
 */
export function setBusy(button, busy) {
  if (busy) button.setAttribute('aria-disabled', 'true');
  else button.removeAttribute('aria-disabled');
}

export const isBusy = (button) => button.getAttribute('aria-disabled') === 'true';

/**
 * True where a finger is the main way of pointing (a phone or tablet), so instructions can say
 * "tap". A laptop that also has a touch screen still counts as a mouse.
 */
export function touchFirst() {
  const matches = (query) => (typeof window.matchMedia === 'function' ? window.matchMedia(query).matches : false);
  if (matches('(pointer: coarse)')) return true;
  if (matches('(pointer: fine)')) return false;
  return navigator.maxTouchPoints > 0;
}

export function uid(prefix = 'id') {
  ids += 1;
  return `${prefix}-${ids}`;
}

/**
 * A labelled form control. Returns { el, input, setError }.
 * `control` is the input/select/textarea element; hint and error are wired up for screen readers.
 */
export function field({ label, control, hint, optional = false }) {
  const id = control.id || uid('f');
  control.id = id;
  const hintEl = hint ? h('span', { class: 'hint', id: `${id}-hint` }, hint) : null;
  const errorEl = h('span', { class: 'error', id: `${id}-error`, role: 'alert', hidden: true });
  const describedBy = [hintEl && hintEl.id].filter(Boolean);
  if (describedBy.length) control.setAttribute('aria-describedby', describedBy.join(' '));
  const el = h('div', { class: 'field' },
    h('label', { for: id }, label, optional ? h('span', { class: 'optional' }, ' (optional)') : null),
    control, hintEl, errorEl);
  function setError(message) {
    errorEl.hidden = !message;
    errorEl.textContent = message || '';
    if (message) {
      control.setAttribute('aria-invalid', 'true');
      control.setAttribute('aria-describedby', [...describedBy, errorEl.id].join(' '));
    } else {
      control.removeAttribute('aria-invalid');
      if (describedBy.length) control.setAttribute('aria-describedby', describedBy.join(' '));
      else control.removeAttribute('aria-describedby');
    }
  }
  return { el, input: control, setError };
}
