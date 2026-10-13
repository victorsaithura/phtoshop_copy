import { clamp } from '../core/utils.js';
import { icon } from './icons.js';

/** Tiny hyperscript helper: h('div', { class: 'x', onClick() {} }, ...children) */
export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  let value;
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else if (k === 'value') value = v;
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (typeof v === 'boolean' || typeof v === 'function') el[k] = v;
    else el.setAttribute(k, v);
  }
  append(el, children);
  if (value !== undefined) el.value = value; // after <option>s exist
  return el;
}

function append(el, children) {
  for (const c of children) {
    if (c == null || c === false) continue;
    if (Array.isArray(c)) append(el, c);
    else el.append(c instanceof Node ? c : String(c));
  }
}

/** Scroll `container` just enough to show `el`, without scrolling the page. */
export function revealInList(container, el) {
  if (!container || !el) return;
  const c = container.getBoundingClientRect();
  const r = el.getBoundingClientRect();
  if (r.top < c.top) container.scrollTop -= c.top - r.top;
  else if (r.bottom > c.bottom) container.scrollTop += r.bottom - c.bottom;
}

export function clear(el) {
  while (el.firstChild) el.firstChild.remove();
  return el;
}

/* ---------- Controls (options bar, panels, dialogs) ---------- */

export function slider({ label, min, max, step = 1, value, unit = '', curve = 'linear', onInput }) {
  const log = curve === 'log';
  const toPos = (v) => (log ? Math.round((1000 * Math.log(v / min)) / Math.log(max / min)) : v);
  const fromPos = (p) => (log ? Math.round(min * Math.pow(max / min, p / 1000)) : Number(p));
  const range = h('input', {
    type: 'range', class: 'range', 'aria-label': label,
    min: log ? 0 : min, max: log ? 1000 : max, step: log ? 1 : step, value: toPos(value),
  });
  const num = h('input', { type: 'number', class: 'num-input', 'aria-label': label, min, max, step, value });
  range.addEventListener('input', () => {
    const v = fromPos(range.value);
    num.value = v;
    onInput(v);
  });
  num.addEventListener('change', () => {
    const v = clamp(Number(num.value) || min, min, max);
    num.value = v;
    range.value = toPos(v);
    onInput(v);
  });
  return h('div', { class: 'opt-group' },
    label ? h('span', { class: 'opt-label' }, label + ':') : null,
    range, num, unit ? h('span', { class: 'opt-unit' }, unit) : null);
}

export function numberInput({ label, min, max, step = 1, value, unit = '', onInput }) {
  const num = h('input', { type: 'number', class: 'num-input', 'aria-label': label, min, max, step, value });
  num.addEventListener('change', () => {
    const v = clamp(Number(num.value) || 0, min, max);
    num.value = v;
    onInput(v);
  });
  return h('div', { class: 'opt-group' },
    label ? h('span', { class: 'opt-label' }, label + ':') : null,
    num, unit ? h('span', { class: 'opt-unit' }, unit) : null);
}

/** options: [{ value, label }] — null entries become separators. */
export function selectInput({ label, value, options, onChange, title }) {
  const sel = h('select', { 'aria-label': label || title, title, value: String(value) },
    options.map((o) => (o
      ? h('option', { value: String(o.value) }, o.label)
      : h('option', { disabled: true }, '──────────'))));
  sel.addEventListener('change', () => onChange(sel.value));
  if (!label) return sel;
  return h('div', { class: 'opt-group' }, h('span', { class: 'opt-label' }, label + ':'), sel);
}

export function checkbox({ label, checked, onChange, title }) {
  const input = h('input', { type: 'checkbox', checked: !!checked });
  input.addEventListener('change', () => onChange(input.checked));
  return h('label', { class: 'check', title }, input, label);
}

/** options: [{ value, icon?, label?, title? }] */
export function segmented({ value, options, onChange }) {
  const wrap = h('div', { class: 'seg', role: 'group' });
  for (const o of options) {
    const b = h('button', {
      type: 'button', title: o.title || o.label, 'aria-label': o.title || o.label,
      class: o.value === value ? 'active' : null,
    }, o.icon ? icon(o.icon, 16) : null, o.label && !o.icon ? o.label : null);
    b.addEventListener('click', () => {
      for (const other of wrap.children) other.classList.toggle('active', other === b);
      onChange(o.value);
    });
    wrap.append(b);
  }
  return wrap;
}

export function button({ label, title, onClick, iconName, className = 'btn btn-small' }) {
  return h('button', { type: 'button', class: className, title: title || label, onClick },
    iconName ? icon(iconName, 16) : null, label || null);
}

export function iconButton(name, title, onClick) {
  return h('button', { type: 'button', class: 'icon-btn', title, 'aria-label': title, onClick }, icon(name, 16));
}
