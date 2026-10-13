import { Layer } from './core/layer.js';
import { Mask } from './core/mask.js';

/*
 * Quick Mask mode (Q): the selection becomes a red overlay that painting
 * tools edit (black removes from the selection, white adds, greys make it
 * partial). Pressing Q again turns the overlay back into a selection.
 * The mask lives on a stand-in layer, doc.quickMask, outside the layer list,
 * so brushes, fills and gradients work on it unchanged.
 */

export const inQuickMask = (app) => !!app.doc?.quickMask;

export function toggleQuickMask(app) {
  const doc = app.doc;
  if (!doc) return;
  const sel = doc.selection;
  const before = sel.snapshot();
  if (!doc.quickMask) {
    const qm = new Layer({ name: 'Quick Mask' });
    qm.mask = new Mask(doc.width, doc.height, 0, 0, 0);
    if (!sel.isEmpty()) qm.mask.write(qm, doc.bounds, sel.alpha);
    qm.maskSelected = true;
    const enter = () => {
      doc.quickMask = qm;
      sel.mask = null;
      sel._update();
    };
    enter();
    app.record('Quick Mask', () => {
      doc.quickMask = null;
      sel.restore(before);
    }, enter, { selection: true });
  } else {
    const qm = doc.quickMask;
    qm.mask.ensureCovers(qm, doc.bounds);
    const alpha = qm.mask.read(qm, doc.bounds);
    const leave = () => {
      doc.quickMask = null;
      sel.fromAlpha(alpha);
    };
    leave();
    app.record('Exit Quick Mask', () => {
      doc.quickMask = qm;
      sel.restore(before);
    }, leave, { selection: true });
  }
  app.emit('quickmask');
}

/** Red tint over the unselected parts, cached until the mask changes. */
export class QuickMaskOverlay {
  constructor() {
    this.canvas = null;
    this.key = null;
  }

  /** The tint for the current document (live strokes come from the tool's preview). */
  get(app) {
    const doc = app.doc;
    const qm = doc?.quickMask;
    if (!qm) return null;
    const live = app.tool?.layerOverride?.(qm, null);
    const m = live && live.mask !== undefined ? live.mask : { canvas: qm.mask.canvas, x: qm.x + qm.mask.ox, y: qm.y + qm.mask.oy };
    const key = live ? null : `${doc.id}:${qm.contentVersion}:${doc.width}x${doc.height}`;
    if (key && key === this.key && this.canvas) return this.canvas;
    this.key = key;
    if (!this.canvas || this.canvas.width !== doc.width || this.canvas.height !== doc.height) {
      this.canvas = document.createElement('canvas');
      this.canvas.width = doc.width;
      this.canvas.height = doc.height;
    }
    const ctx = this.canvas.getContext('2d');
    ctx.globalCompositeOperation = 'copy';
    ctx.fillStyle = 'rgba(255, 0, 0, 0.5)';
    ctx.fillRect(0, 0, doc.width, doc.height);
    if (m) {
      ctx.globalCompositeOperation = 'destination-out';
      ctx.drawImage(m.canvas, m.x, m.y);
    }
    ctx.globalCompositeOperation = 'source-over';
    return this.canvas;
  }
}
