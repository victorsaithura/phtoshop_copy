import { h, checkbox } from './dom.js';
import { openModal, promptDialog } from './dialogs.js';
import { resizeImage, resizeCanvas, rotateDocument, duplicateDocument } from '../core/transform.js';
import { MAX_SIDE, MAX_PIXELS } from '../io.js';

const row = (label, ...controls) => h('div', { class: 'form-row' }, h('label', {}, label), ...controls);
const errorLine = () => h('div', { class: 'form-note', style: { color: 'var(--danger)' } });

function validSize(w, hh) {
  return w >= 1 && hh >= 1 && w <= MAX_SIDE && hh <= MAX_SIDE && w * hh <= MAX_PIXELS;
}
const sizeError = `Size must be 1–${MAX_SIDE} px per side and at most ${Math.round(MAX_PIXELS / 1e6)} megapixels.`;

export function imageSizeDialog(app) {
  const doc = app.doc;
  const ratio = doc.width / doc.height;
  const width = h('input', { type: 'number', min: 1, max: MAX_SIDE, value: doc.width });
  const height = h('input', { type: 'number', min: 1, max: MAX_SIDE, value: doc.height });
  const percent = h('input', { type: 'number', min: 1, max: 1000, step: 1, value: 100 });
  let constrain = true;
  const method = h('select', { value: 'smooth' },
    h('option', { value: 'smooth' }, 'Bicubic (smooth gradients)'),
    h('option', { value: 'nearest' }, 'Nearest Neighbor (hard edges)'));
  const error = errorLine();

  width.addEventListener('input', () => {
    if (constrain) height.value = Math.max(1, Math.round(Number(width.value) / ratio));
    percent.value = Math.round((Number(width.value) / doc.width) * 1000) / 10;
  });
  height.addEventListener('input', () => {
    if (constrain) width.value = Math.max(1, Math.round(Number(height.value) * ratio));
    percent.value = Math.round((Number(width.value) / doc.width) * 1000) / 10;
  });
  percent.addEventListener('input', () => {
    const s = Number(percent.value) / 100;
    width.value = Math.max(1, Math.round(doc.width * s));
    height.value = constrain ? Math.max(1, Math.round(doc.height * s)) : height.value;
  });

  openModal({
    title: 'Image Size',
    width: 420,
    body: h('div', {},
      h('p', { class: 'form-note' }, `Current size: ${doc.width} × ${doc.height} px`),
      row('Width (px)', width),
      row('Height (px)', height),
      row('Scale (%)', percent),
      row('', checkbox({ label: 'Constrain proportions', checked: true, onChange: (v) => { constrain = v; } })),
      row('Resample', method),
      error),
    buttons: [
      { label: 'Cancel' },
      {
        label: 'OK',
        primary: true,
        onClick: () => {
          const w = Math.round(Number(width.value));
          const hh = Math.round(Number(height.value));
          if (!validSize(w, hh)) {
            error.textContent = sizeError;
            return false;
          }
          resizeImage(app, w, hh, method.value);
          return true;
        },
      },
    ],
  });
}

const ANCHORS = [0, 0.5, 1].flatMap((y) => [0, 0.5, 1].map((x) => ({ x, y })));

export function canvasSizeDialog(app) {
  const doc = app.doc;
  const width = h('input', { type: 'number', value: doc.width });
  const height = h('input', { type: 'number', value: doc.height });
  let relative = false;
  let anchor = { x: 0.5, y: 0.5 };
  const grid = h('div', { class: 'anchor-grid', role: 'group', 'aria-label': 'Anchor' });
  for (const a of ANCHORS) {
    const b = h('button', {
      type: 'button', title: 'Anchor', class: a.x === 0.5 && a.y === 0.5 ? 'active' : null,
      onClick: () => {
        anchor = a;
        for (const other of grid.children) other.classList.toggle('active', other === b);
      },
    });
    grid.append(b);
  }
  const color = h('select', { value: 'background' },
    h('option', { value: 'background' }, 'Background color'),
    h('option', { value: 'foreground' }, 'Foreground color'),
    h('option', { value: '#ffffff' }, 'White'),
    h('option', { value: '#000000' }, 'Black'),
    h('option', { value: '#808080' }, 'Gray'),
    h('option', { value: 'transparent' }, 'Transparent'));
  const error = errorLine();
  const rel = checkbox({
    label: 'Relative',
    onChange: (v) => {
      relative = v;
      width.value = v ? 0 : doc.width;
      height.value = v ? 0 : doc.height;
    },
  });

  openModal({
    title: 'Canvas Size',
    width: 420,
    body: h('div', {},
      h('p', { class: 'form-note' }, `Current size: ${doc.width} × ${doc.height} px`),
      row('Width (px)', width),
      row('Height (px)', height),
      row('', rel),
      row('Anchor', grid),
      row('Extension color', color),
      error),
    buttons: [
      { label: 'Cancel' },
      {
        label: 'OK',
        primary: true,
        onClick: () => {
          let w = Math.round(Number(width.value));
          let hh = Math.round(Number(height.value));
          if (relative) {
            w += doc.width;
            hh += doc.height;
          }
          if (!validSize(w, hh)) {
            error.textContent = sizeError;
            return false;
          }
          const c = color.value;
          const fill = c === 'transparent' ? null : c === 'background' ? app.colors.bg : c === 'foreground' ? app.colors.fg : c;
          resizeCanvas(app, w, hh, anchor, fill);
          return true;
        },
      },
    ],
  });
}

export function rotateDialog(app) {
  const angle = h('input', { type: 'number', min: -359.99, max: 359.99, step: 0.1, value: 15 });
  const direction = h('select', { value: 'cw' }, h('option', { value: 'cw' }, 'Clockwise'), h('option', { value: 'ccw' }, 'Counter Clockwise'));
  openModal({
    title: 'Rotate Canvas',
    width: 360,
    body: h('div', {}, row('Angle (°)', angle), row('Direction', direction),
      h('p', { class: 'form-note' }, 'The canvas grows to fit the rotated image; new areas are transparent.')),
    buttons: [
      { label: 'Cancel' },
      {
        label: 'OK',
        primary: true,
        onClick: () => {
          const a = Number(angle.value) || 0;
          rotateDocument(app, direction.value === 'cw' ? a : -a);
        },
      },
    ],
  });
}

export async function duplicateDialog(app) {
  const name = await promptDialog({ title: 'Duplicate Image', label: 'As', value: `${app.doc.name.replace(/\.[a-z0-9]+$/i, '')} copy` });
  if (name) duplicateDocument(app, name);
}
