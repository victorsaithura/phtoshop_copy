import { ADJUSTMENTS } from './core/adjustments.js';
import { FILTERS } from './core/filters.js';
import { rotateDocument, flipDocument, cropDocument, transformLayer } from './core/transform.js';
import { runPixelCommand } from './ui/adjust-dialog.js';
import { editMask, editingMask } from './actions-mask.js';
import { imageSizeDialog, canvasSizeDialog, rotateDialog, duplicateDialog } from './ui/image-dialogs.js';

const ADJUSTMENT_SHORTCUTS = {
  levels: 'Ctrl+L',
  curves: 'Ctrl+M',
  hueSaturation: 'Ctrl+U',
  colorBalance: 'Ctrl+B',
  blackWhite: 'Ctrl+Alt+Shift+B',
  invert: 'Ctrl+I',
  desaturate: 'Ctrl+Shift+U',
  autoTone: 'Ctrl+Shift+L',
  autoContrast: 'Ctrl+Alt+Shift+L',
};

/** Image, Filter and Edit ▸ Transform commands, added to the action map `A`. */
export function registerImageActions(app, A) {
  const def = (id, label, run, opts = {}) => {
    A[id] = { id, label, run, ...opts, keys: opts.keys || (opts.shortcut ? [opts.shortcut] : []) };
  };
  const hasDoc = () => !!app.doc;
  const hasLayer = () => !!app.doc?.activeLayer;
  const hasSel = () => !!app.doc && !app.doc.selection.isEmpty();
  const ellipsis = (d) => (d.custom || d.params?.length ? '…' : '');

  for (const [key, adj] of Object.entries(ADJUSTMENTS)) {
    const id = key.startsWith('auto') ? `image.${key}` : `adjust.${key}`;
    const run = key === 'invert'
      ? () => {
        // Ctrl+I on a selected mask inverts the mask.
        if (editingMask(app)) {
          const doc = app.doc;
          editMask(app, 'Invert', doc.selection.isEmpty() ? doc.bounds : doc.selection.bounds, (v) => 255 - v);
        } else runPixelCommand(app, adj, { id });
      }
      : () => runPixelCommand(app, adj, { id });
    def(id, adj.title + ellipsis(adj), run, { enabled: hasLayer, shortcut: ADJUSTMENT_SHORTCUTS[key] });
  }

  for (const [key, f] of Object.entries(FILTERS)) {
    def(`filter.${key}`, f.title + ellipsis(f), () => runPixelCommand(app, f, {
      id: `filter.${key}`,
      onApplied: (params) => { app.lastFilter = { key, params }; },
    }), { enabled: hasLayer });
  }
  def('filter.last', 'Last Filter', () => {
    const last = app.lastFilter;
    if (last) runPixelCommand(app, FILTERS[last.key], { id: `filter.${last.key}`, params: last.params });
  }, {
    enabled: () => hasLayer() && !!app.lastFilter,
    shortcut: 'Ctrl+Alt+F',
    dynamicLabel: () => (app.lastFilter ? `Last Filter (${FILTERS[app.lastFilter.key].title})` : 'Last Filter'),
  });

  def('image.size', 'Image Size…', () => imageSizeDialog(app), { enabled: hasDoc, shortcut: 'Ctrl+Alt+I' });
  def('image.canvasSize', 'Canvas Size…', () => canvasSizeDialog(app), { enabled: hasDoc, shortcut: 'Ctrl+Alt+C' });
  def('image.rotate180', '180°', () => rotateDocument(app, 180), { enabled: hasDoc });
  def('image.rotateCW', '90° Clockwise', () => rotateDocument(app, 90), { enabled: hasDoc });
  def('image.rotateCCW', '90° Counter Clockwise', () => rotateDocument(app, 270), { enabled: hasDoc });
  def('image.rotateArbitrary', 'Arbitrary…', () => rotateDialog(app), { enabled: hasDoc });
  def('image.flipH', 'Flip Canvas Horizontal', () => flipDocument(app, true), { enabled: hasDoc });
  def('image.flipV', 'Flip Canvas Vertical', () => flipDocument(app, false), { enabled: hasDoc });
  def('image.crop', 'Crop to Selection', () => cropDocument(app, app.doc.selection.bounds, true), { enabled: hasSel });
  def('image.duplicate', 'Duplicate…', () => duplicateDialog(app), { enabled: hasDoc });

  const transforms = [
    ['flipH', 'Flip Horizontal'],
    ['flipV', 'Flip Vertical'],
    ['rot180', 'Rotate 180°'],
    ['rot90cw', 'Rotate 90° Clockwise'],
    ['rot90ccw', 'Rotate 90° Counter Clockwise'],
  ];
  for (const [kind, label] of transforms) {
    def(`transform.${kind}`, label, () => transformLayer(app, kind), { enabled: hasLayer });
  }
}
