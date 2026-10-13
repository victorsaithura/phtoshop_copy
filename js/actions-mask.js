import { Mask, maskedPixels, maskValue } from './core/mask.js';
import { rectIntersect, rectUnion } from './core/utils.js';

export { maskValue };

/** Whether edits currently go to the active layer's mask. */
export function editingMask(app) {
  const layer = app.doc?.activeLayer;
  return !!(layer && layer.mask && layer.maskSelected);
}

/**
 * Change the active layer's mask inside `rect` (document coordinates):
 * fn(oldValue) → newValue, blended by the selection. One undoable step.
 */
export function editMask(app, label, rect, fn) {
  const doc = app.doc;
  const layer = doc.activeLayer;
  const r = rectIntersect(rect, doc.bounds);
  if (!r || !layer?.mask) return;
  const sel = doc.selection;
  const W = doc.width;
  app.transact(label, { layers: [{ layer, rect: r }] }, () => {
    const vals = layer.mask.read(layer, r);
    for (let y = 0; y < r.h; y++) {
      for (let x = 0; x < r.w; x++) {
        const i = y * r.w + x;
        const a = sel.isEmpty() ? 1 : sel.alpha[(r.y + y) * W + r.x + x] / 255;
        if (!a) continue;
        const old = vals[i];
        vals[i] = Math.max(0, Math.min(255, Math.round(old + (fn(old) - old) * a)));
      }
    }
    layer.mask.write(layer, r, vals);
  });
}

export function registerMaskActions(app, A) {
  const def = (id, label, run, opts = {}) => {
    A[id] = { id, label, run, ...opts, keys: opts.keys || (opts.shortcut ? [opts.shortcut] : []) };
  };
  const layer = () => app.doc?.activeLayer;
  const hasMask = () => !!layer()?.mask;
  const canAdd = () => !!layer() && !layer().mask;
  const hasSel = () => !!app.doc && !app.doc.selection.isEmpty();

  /** mode: reveal | hide | revealSelection | hideSelection */
  function addMask(mode) {
    const doc = app.doc;
    const l = doc.activeLayer;
    if (!l || l.mask) return;
    const area = rectUnion(l.bounds, doc.bounds);
    app.transact('Add Layer Mask', { structure: true, layers: [l] }, () => {
      const outside = mode === 'hide' || mode === 'revealSelection' ? 0 : 255;
      const m = new Mask(area.w, area.h, area.x - l.x, area.y - l.y, outside);
      if (mode === 'revealSelection' || mode === 'hideSelection') {
        const alpha = doc.selection.alpha;
        const vals = new Uint8Array(doc.width * doc.height);
        for (let i = 0; i < vals.length; i++) vals[i] = mode === 'revealSelection' ? alpha[i] : 255 - alpha[i];
        m.write(l, doc.bounds, vals);
      }
      l.mask = m;
      l.maskSelected = true;
    });
  }

  def('mask.revealAll', 'Reveal All', () => addMask('reveal'), { enabled: canAdd });
  def('mask.hideAll', 'Hide All', () => addMask('hide'), { enabled: canAdd });
  def('mask.revealSelection', 'Reveal Selection', () => addMask('revealSelection'), { enabled: () => canAdd() && hasSel() });
  def('mask.hideSelection', 'Hide Selection', () => addMask('hideSelection'), { enabled: () => canAdd() && hasSel() });
  // Layers panel button: from the selection when there is one (Alt hides instead).
  def('mask.add', 'Add Layer Mask', () => addMask(hasSel() ? 'revealSelection' : 'reveal'), { enabled: canAdd });

  def('mask.toggle', 'Disable Layer Mask', () => {
    const l = layer();
    app.transact(l.mask.enabled ? 'Disable Layer Mask' : 'Enable Layer Mask', { structure: true, layers: [l] }, () => {
      l.mask.enabled = !l.mask.enabled;
    });
  }, {
    enabled: hasMask,
    dynamicLabel: () => (layer()?.mask && !layer().mask.enabled ? 'Enable Layer Mask' : 'Disable Layer Mask'),
  });
  def('mask.apply', 'Apply Layer Mask', () => {
    const l = layer();
    app.transact('Apply Layer Mask', { structure: true, layers: [l] }, () => {
      l.text = null;
      if (l.mask.enabled) l.canvas = maskedPixels(l);
      l.mask = null;
      l.maskSelected = false;
    });
  }, { enabled: hasMask });
  def('mask.delete', 'Delete Layer Mask', () => {
    const l = layer();
    app.transact('Delete Layer Mask', { structure: true, layers: [l] }, () => {
      l.mask = null;
      l.maskSelected = false;
    });
  }, { enabled: hasMask });
}
