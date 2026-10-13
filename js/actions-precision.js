import { saveViewOptions } from './guides.js';
import { modifySelection } from './core/select-ops.js';
import { toggleQuickMask, inQuickMask } from './quick-mask.js';
import { colorRangeDialog } from './ui/color-range-dialog.js';
import { numberDialog, openModal } from './ui/dialogs.js';
import { h } from './ui/dom.js';

/** View ▸ rulers, grid, guides and snapping; Select ▸ Modify, Color Range and Quick Mask. */
export function registerPrecisionActions(app, A) {
  const def = (id, label, run, opts = {}) => {
    A[id] = { id, label, run, ...opts, keys: opts.keys || (opts.shortcut ? [opts.shortcut] : []) };
  };
  const o = app.viewOptions;
  const hasDoc = () => !!app.doc;
  const hasSel = () => !!app.doc && !app.doc.selection.isEmpty();
  const changed = () => {
    saveViewOptions(o);
    app.emit('view-options');
    app.renderer.request(false);
  };

  /* ---------- View ---------- */

  const toggle = (key, label, opts = {}) => def(`view.${key}`, label, () => {
    o[key] = !o[key];
    changed();
  }, { checked: () => o[key], ...opts });
  toggle('rulers', 'Rulers', { shortcut: 'Ctrl+R' });
  toggle('grid', 'Grid', { shortcut: "Ctrl+'" });
  toggle('guides', 'Guides', { shortcut: 'Ctrl+;' });
  toggle('snap', 'Snap', { shortcut: 'Ctrl+Shift+;' });
  toggle('lockGuides', 'Lock Guides', { shortcut: 'Ctrl+Alt+;' });
  def('view.snapGuides', 'Guides', () => { o.snapGuides = !o.snapGuides; changed(); }, { checked: () => o.snapGuides });
  def('view.snapGrid', 'Grid', () => { o.snapGrid = !o.snapGrid; changed(); }, { checked: () => o.snapGrid });
  def('view.snapDocument', 'Document Bounds', () => { o.snapDocument = !o.snapDocument; changed(); }, { checked: () => o.snapDocument });

  def('view.clearGuides', 'Clear Guides', () => {
    app.transact('Clear Guides', { structure: true }, () => { app.doc.guides = []; });
  }, { enabled: () => !!app.doc?.guides.length });

  def('view.newGuide', 'New Guide…', () => {
    const doc = app.doc;
    const orient = h('select', { 'aria-label': 'Orientation' },
      h('option', { value: 'h' }, 'Horizontal'), h('option', { value: 'v' }, 'Vertical'));
    const pos = h('input', { type: 'number', class: 'num-input', value: 0, 'aria-label': 'Position' });
    openModal({
      title: 'New Guide',
      body: h('div', {},
        h('div', { class: 'form-row' }, h('label', {}, 'Orientation'), orient),
        h('div', { class: 'form-row' }, h('label', {}, 'Position'), h('span', { class: 'num-unit' }, pos, ' px'))),
      buttons: [
        { label: 'Cancel' },
        {
          label: 'OK',
          primary: true,
          onClick: () => {
            const p = Math.round(Number(pos.value));
            if (!Number.isFinite(p)) return false;
            o.guides = true;
            changed();
            app.transact('New Guide', { structure: true }, () => doc.guides.push({ o: orient.value, p }));
            return undefined;
          },
        },
      ],
    });
  }, { enabled: hasDoc });

  def('view.gridSettings', 'Grid Settings…', () => {
    const size = h('input', { type: 'number', class: 'num-input', min: 2, max: 5000, value: o.gridSize, 'aria-label': 'Gridline every' });
    const subs = h('input', { type: 'number', class: 'num-input', min: 1, max: 20, value: o.gridSubdivisions, 'aria-label': 'Subdivisions' });
    openModal({
      title: 'Grid Settings',
      body: h('div', {},
        h('div', { class: 'form-row' }, h('label', {}, 'Gridline every'), h('span', { class: 'num-unit' }, size, ' px')),
        h('div', { class: 'form-row' }, h('label', {}, 'Subdivisions'), subs)),
      buttons: [
        { label: 'Cancel' },
        {
          label: 'OK',
          primary: true,
          onClick: () => {
            o.gridSize = Math.min(5000, Math.max(2, Number(size.value) || 100));
            o.gridSubdivisions = Math.min(20, Math.max(1, Math.round(Number(subs.value) || 1)));
            o.grid = true;
            changed();
          },
        },
      ],
    });
  });

  /* ---------- Select ---------- */

  const modify = (op, label, title, max, unit = 'pixels') => async () => {
    const amount = await numberDialog({ title, label, value: op === 'feather' ? 5 : op === 'border' ? 10 : 2, min: 1, max, unit });
    if (!amount || !hasSel()) return;
    app.transact(title, { selection: true }, () => modifySelection(app.doc.selection, op, amount));
    if (app.doc.selection.isEmpty()) app.toast('Nothing is left selected.');
  };
  def('select.expand', 'Expand…', modify('expand', 'Expand By', 'Expand Selection', 500), { enabled: hasSel });
  def('select.contract', 'Contract…', modify('contract', 'Contract By', 'Contract Selection', 500), { enabled: hasSel });
  def('select.smooth', 'Smooth…', modify('smooth', 'Sample Radius', 'Smooth Selection', 100), { enabled: hasSel });
  def('select.border', 'Border…', modify('border', 'Width', 'Border Selection', 200), { enabled: hasSel });
  def('select.feather', 'Feather…', modify('feather', 'Feather Radius', 'Feather Selection', 250),
    { enabled: hasSel, shortcut: 'Shift+F6' });
  def('select.colorRange', 'Color Range…', () => colorRangeDialog(app), { enabled: () => hasDoc() && !inQuickMask(app) });
  def('select.quickMask', 'Edit in Quick Mask Mode', () => toggleQuickMask(app), {
    enabled: hasDoc, shortcut: 'Q', checked: () => inQuickMask(app),
  });
}
