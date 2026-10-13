import { h } from './dom.js';
import { ColorPicker } from './color-panel.js';
import { formatShortcut } from '../core/utils.js';

let openCount = 0;
export const isModalOpen = () => openCount > 0;

/**
 * Generic modal. buttons: [{ label, primary?, value?, onClick?() }]
 * onClick returning false keeps the dialog open.
 */
export function openModal({ title, body, buttons = [], width, onClose }) {
  const root = document.getElementById('modal-root');
  const footer = h('div', { class: 'modal-footer' });
  const modal = h('div', {
    class: 'modal', role: 'dialog', 'aria-modal': 'true', 'aria-label': title,
    style: width ? { maxWidth: `${width}px` } : null,
  }, h('div', { class: 'modal-header' }, title), h('div', { class: 'modal-body' }, body), footer);
  const backdrop = h('div', { class: 'modal-backdrop' }, modal);

  let closed = false;
  const close = (result) => {
    if (closed) return;
    closed = true;
    openCount--;
    backdrop.remove();
    document.removeEventListener('keydown', onKey, true);
    onClose?.(result);
  };
  const activate = (b) => {
    if (b.onClick && b.onClick() === false) return;
    close(b.value);
  };
  const primary = buttons.find((b) => b.primary);
  for (const b of buttons) {
    footer.append(h('button', {
      type: 'button', class: b.primary ? 'btn btn-primary' : 'btn', onClick: () => activate(b),
    }, b.label));
  }
  const onKey = (e) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      close(undefined);
    } else if (e.key === 'Enter' && primary && !['TEXTAREA', 'BUTTON', 'SELECT'].includes(e.target.tagName)) {
      e.preventDefault();
      e.stopPropagation();
      activate(primary);
    }
  };
  document.addEventListener('keydown', onKey, true);
  let downOnBackdrop = false;
  backdrop.addEventListener('pointerdown', (e) => { downOnBackdrop = e.target === backdrop; });
  backdrop.addEventListener('click', (e) => {
    if (downOnBackdrop && e.target === backdrop) close(undefined);
  });

  root.append(backdrop);
  openCount++;
  setTimeout(() => {
    const f = modal.querySelector('input:not([type=checkbox]), select, .btn-primary');
    f?.focus();
    if (f?.select && f.type === 'text') f.select();
  });
  return { close, el: modal };
}

export function promptDialog({ title, label, value = '' }) {
  return new Promise((resolve) => {
    const input = h('input', { type: 'text', value });
    let result = null;
    openModal({
      title,
      body: h('div', { class: 'form-row' }, h('label', {}, label), input),
      buttons: [
        { label: 'Cancel' },
        { label: 'OK', primary: true, onClick: () => { result = input.value.trim(); } },
      ],
      onClose: () => resolve(result),
    });
  });
}

export function confirmDialog({ title, message, okLabel = 'OK', cancelLabel = 'Cancel' }) {
  return new Promise((resolve) => {
    let ok = false;
    openModal({
      title,
      body: h('p', { style: { margin: '0 0 6px' } }, message),
      buttons: [
        { label: cancelLabel },
        { label: okLabel, primary: true, onClick: () => { ok = true; } },
      ],
      onClose: () => resolve(ok),
    });
  });
}

export function colorPickerDialog(app, which) {
  const original = app.colors[which];
  const picker = new ColorPicker({ color: original, svHeight: 200 });
  const now = h('div', { style: { background: original }, title: 'New' });
  const current = h('div', { style: { background: original }, title: 'Current' });
  picker.onChange = (hex) => { now.style.background = hex; };
  openModal({
    title: which === 'fg' ? 'Color Picker (Foreground Color)' : 'Color Picker (Background Color)',
    width: 340,
    body: h('div', {}, picker.el,
      h('div', { class: 'form-note' }, 'New (left) · Current (right)'),
      h('div', { class: 'color-compare' }, now, current)),
    buttons: [
      { label: 'Cancel' },
      { label: 'OK', primary: true, onClick: () => app.setColor(which, picker.color) },
    ],
  });
}

const EXTRA_KEYS = [
  ['Temporary Hand tool', 'Space (hold)'],
  ['Eyedropper while painting', 'Alt (hold) + click'],
  ['Decrease / increase brush size', '[  /  ]'],
  ['Decrease / increase brush hardness', 'Shift+[  /  Shift+]'],
  ['Tool opacity (Move tool: layer opacity)', '1 … 9, 0 = 100%'],
  ['Switch foreground/background colors', 'X'],
  ['Default colors', 'D'],
  ['Nudge layer or selection (Move tool)', 'Arrow keys (Shift = 10px)'],
  ['Zoom', 'Ctrl + mouse wheel / pinch'],
];

export function shortcutsDialog(app, menus) {
  const row = (a, b) => h('tr', {}, h('td', {}, a), h('td', {}, b));
  const rows = [h('tr', {}, h('th', { colspan: 2 }, 'Tools'))];
  for (const t of app.tools.values()) rows.push(row(t.name, t.key));
  for (const [a, b] of EXTRA_KEYS) rows.push(row(a, b));
  for (const menu of menus) {
    const items = menu.items.map((id) => app.actions[id]).filter((a) => a && a.shortcut);
    if (!items.length) continue;
    rows.push(h('tr', {}, h('th', { colspan: 2 }, menu.label)));
    for (const a of items) rows.push(row(a.label, formatShortcut(a.shortcut)));
  }
  openModal({
    title: 'Keyboard Shortcuts',
    width: 520,
    body: h('table', { class: 'shortcut-table' }, h('tbody', {}, rows)),
    buttons: [{ label: 'Close', primary: true }],
  });
}

export function aboutDialog() {
  openModal({
    title: 'About PhotoForge',
    body: h('div', {},
      h('p', {}, 'PhotoForge is a layer-based photo editor that runs entirely in your browser. ' +
        'Images are processed locally and never uploaded.'),
      h('p', { class: 'form-note' }, 'Phase 1: layers, selections, painting, fills, gradients, history and export.')),
    buttons: [{ label: 'Close', primary: true }],
  });
}
