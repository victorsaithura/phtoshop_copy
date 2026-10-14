import { h } from './dom.js';
import { openModal } from './dialogs.js';
import { ColorPicker } from './color-panel.js';
import { PSDocument } from '../core/document.js';
import { BLEND_MODES } from '../core/layer.js';
import { exportDocument, MAX_SIDE, MAX_PIXELS } from '../io.js';

const PRESETS = [
  { label: 'Default (7×5 in @ 300 ppi)', w: 2100, h: 1500 },
  { label: 'HD 720p', w: 1280, h: 720 },
  { label: 'Full HD 1080p', w: 1920, h: 1080 },
  { label: '4K UHD', w: 3840, h: 2160 },
  { label: 'Square post', w: 1080, h: 1080 },
  { label: 'Story / Reel', w: 1080, h: 1920 },
  { label: 'A4 @ 300 ppi', w: 2480, h: 3508 },
  { label: 'US Letter @ 300 ppi', w: 2550, h: 3300 },
];

const row = (label, ...controls) => h('div', { class: 'form-row' }, h('label', {}, label), ...controls);

export function newDocumentDialog(app) {
  const name = h('input', { type: 'text', placeholder: 'Untitled' });
  const width = h('input', { type: 'number', min: 1, max: MAX_SIDE, value: 1920 });
  const height = h('input', { type: 'number', min: 1, max: MAX_SIDE, value: 1080 });
  const bg = h('select', { value: 'white' },
    h('option', { value: 'white' }, 'White'),
    h('option', { value: 'black' }, 'Black'),
    h('option', { value: 'background' }, 'Background Color'),
    h('option', { value: 'transparent' }, 'Transparent'));

  const presets = [...PRESETS];
  if (app.clipboard) presets.unshift({ label: 'Clipboard', w: app.clipboard.canvas.width, h: app.clipboard.canvas.height });
  const presetButtons = presets.map((p) => h('button', {
    type: 'button', class: 'btn', title: `${p.w} × ${p.h} px`,
    onClick: (e) => {
      width.value = p.w;
      height.value = p.h;
      for (const b of presetButtons) b.classList.toggle('active', b === e.currentTarget);
    },
  }, p.label));
  const swap = h('button', {
    type: 'button', class: 'btn btn-small', title: 'Swap orientation',
    onClick: () => { [width.value, height.value] = [height.value, width.value]; },
  }, '⇄');
  if (app.clipboard) presetButtons[0].click();

  const error = h('div', { class: 'form-note', style: { color: 'var(--danger)' } });
  openModal({
    title: 'New Document',
    width: 520,
    body: h('div', {},
      h('div', { class: 'preset-list' }, presetButtons),
      row('Name', name),
      row('Width (px)', width),
      row('Height (px)', h('div', { class: 'form-inline' }, height, swap)),
      row('Background', bg),
      error),
    buttons: [
      { label: 'Cancel' },
      {
        label: 'Create',
        primary: true,
        onClick: () => {
          const w = Math.round(Number(width.value));
          const hgt = Math.round(Number(height.value));
          if (!(w >= 1 && hgt >= 1 && w <= MAX_SIDE && hgt <= MAX_SIDE) || w * hgt > MAX_PIXELS) {
            error.textContent = `Size must be 1–${MAX_SIDE} px per side and at most ${Math.round(MAX_PIXELS / 1e6)} megapixels.`;
            return false;
          }
          const background = { white: '#ffffff', black: '#000000', background: app.colors.bg, transparent: 'transparent' }[bg.value];
          app.addDocument(new PSDocument({ width: w, height: hgt, name: name.value.trim() || undefined, background }), 'New');
          return true;
        },
      },
    ],
  });
}

export function exportDialog(app) {
  const doc = app.doc;
  if (!doc) return;
  const baseName = doc.name.replace(/\.[a-z0-9]+$/i, '');
  const filename = h('input', { type: 'text', value: baseName });
  const format = h('select', { value: 'png' },
    h('option', { value: 'png' }, 'PNG'),
    h('option', { value: 'jpeg' }, 'JPEG'),
    h('option', { value: 'webp' }, 'WebP'));
  const quality = h('input', { type: 'range', class: 'range', min: 1, max: 100, value: 90, style: { width: '100%' } });
  const qualityLabel = h('span', { class: 'opt-label' }, '90');
  const scale = h('input', { type: 'number', min: 1, max: 400, value: 100 });
  const info = h('div', { class: 'form-note' });
  const qualityRow = row('Quality', h('div', { class: 'form-inline' }, quality, qualityLabel));
  const update = () => {
    qualityRow.hidden = format.value === 'png';
    qualityLabel.textContent = quality.value;
    const s = Math.max(1, Number(scale.value) || 100) / 100;
    info.textContent = `Output: ${Math.max(1, Math.round(doc.width * s))} × ${Math.max(1, Math.round(doc.height * s))} px` +
      (format.value === 'jpeg' ? ' · transparent areas become white' : '');
  };
  for (const el of [format, quality, scale]) el.addEventListener('input', update);
  update();

  openModal({
    title: 'Export As',
    width: 440,
    body: h('div', {},
      row('File name', filename),
      row('Format', format),
      qualityRow,
      row('Scale (%)', scale),
      info),
    buttons: [
      { label: 'Cancel' },
      {
        label: 'Export',
        primary: true,
        onClick: () => {
          exportDocument(doc, {
            format: format.value,
            quality: Number(quality.value) / 100,
            scale: Math.min(400, Math.max(1, Number(scale.value) || 100)) / 100,
            filename: filename.value.trim() || baseName,
          }).catch((err) => app.toast(`Export failed: ${err.message}`));
        },
      },
    ],
  });
}

/**
 * Edit ▸ Fill… — onFill(color, opacity, blendMode). With a selection,
 * Contents also offers Content-Aware, which calls onContentAware().
 */
export function fillDialog(app, onFill, onContentAware = null) {
  const aware = onContentAware && !app.doc.selection.isEmpty();
  const contents = h('select', { value: 'fg' },
    h('option', { value: 'fg' }, 'Foreground Color'),
    h('option', { value: 'bg' }, 'Background Color'),
    h('option', { value: 'custom' }, 'Color…'),
    aware ? h('option', { value: 'content-aware' }, 'Content-Aware') : null,
    h('option', { value: '#000000' }, 'Black'),
    h('option', { value: '#808080' }, '50% Gray'),
    h('option', { value: '#ffffff' }, 'White'));
  const picker = new ColorPicker({ color: app.colors.fg, svHeight: 110 });
  picker.el.hidden = true;
  const mode = h('select', { value: 'source-over' },
    BLEND_MODES.filter(Boolean).map((m) => h('option', { value: m.value }, m.label)));
  const opacity = h('input', { type: 'number', min: 1, max: 100, value: 100 });
  const modeRow = row('Mode', mode);
  const opacityRow = row('Opacity (%)', opacity);
  contents.addEventListener('change', () => {
    picker.el.hidden = contents.value !== 'custom';
    // Content-Aware fills with texture, so mode and opacity don't apply.
    modeRow.hidden = opacityRow.hidden = contents.value === 'content-aware';
  });

  openModal({
    title: 'Fill',
    width: 380,
    body: h('div', {}, row('Contents', contents), picker.el, modeRow, opacityRow),
    buttons: [
      { label: 'Cancel' },
      {
        label: 'OK',
        primary: true,
        onClick: () => {
          const v = contents.value;
          if (v === 'content-aware') {
            // Let this dialog close before the fill opens its progress dialog.
            setTimeout(onContentAware);
            return;
          }
          const color = v === 'fg' ? app.colors.fg : v === 'bg' ? app.colors.bg : v === 'custom' ? picker.color : v;
          onFill(color, Math.min(100, Math.max(1, Number(opacity.value) || 100)) / 100, mode.value);
        },
      },
    ],
  });
}
