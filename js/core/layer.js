import { createCanvas, cloneCanvas, rectUnion, rectIntersect } from './utils.js';

let nextLayerId = 1;

// null entries are separators in the blend-mode menu (grouped like Photoshop).
export const BLEND_MODES = [
  { value: 'source-over', label: 'Normal' },
  null,
  { value: 'darken', label: 'Darken' },
  { value: 'multiply', label: 'Multiply' },
  { value: 'color-burn', label: 'Color Burn' },
  null,
  { value: 'lighten', label: 'Lighten' },
  { value: 'screen', label: 'Screen' },
  { value: 'color-dodge', label: 'Color Dodge' },
  null,
  { value: 'overlay', label: 'Overlay' },
  { value: 'soft-light', label: 'Soft Light' },
  { value: 'hard-light', label: 'Hard Light' },
  null,
  { value: 'difference', label: 'Difference' },
  { value: 'exclusion', label: 'Exclusion' },
  null,
  { value: 'hue', label: 'Hue' },
  { value: 'saturation', label: 'Saturation' },
  { value: 'color', label: 'Color' },
  { value: 'luminosity', label: 'Luminosity' },
];

/** Groups default to Pass Through: their layers blend straight into what is below. */
export const PASS_THROUGH = 'pass-through';
export const GROUP_BLEND_MODES = [{ value: PASS_THROUGH, label: 'Pass Through' }, ...BLEND_MODES];

export const copyJSON = (v) => (v == null ? null : JSON.parse(JSON.stringify(v)));

/**
 * A layer. Pixel layers (and type layers) hold a canvas of any size at (x, y)
 * in document space, so pixels moved outside the document are kept, as in
 * Photoshop. Groups and adjustment layers have no pixels of their own (just a
 * 1×1 placeholder canvas, so masks and document-wide commands treat every
 * kind alike).
 *
 * The document keeps all layers in one list, bottom first; a group sits just
 * above its contents, which point to it through `parent`.
 */
export class Layer {
  constructor({ name = 'Layer', width = 1, height = 1, x = 0, y = 0, canvas = null, kind = 'pixel' } = {}) {
    this.id = nextLayerId++;
    this.kind = kind; // 'pixel' | 'group' | 'adjustment'
    this.parent = null; // the group this layer is in
    this.name = name;
    this.canvas = canvas || createCanvas(width, height);
    this.x = x;
    this.y = y;
    this.visible = true;
    this.opacity = 1;
    this.blendMode = 'source-over';
    this.locked = false;
    this.text = null; // type layers: settings from core/text.js, re-rendered on edit
    this.mask = null; // optional Mask (core/mask.js); maskSelected = the mask is being edited
    this.maskSelected = false;
    this.adjustment = null; // adjustment layers: { type, params } (core/adjustments.js)
    this.styles = null; // layer style effects (core/effects.js)
    this.collapsed = false; // groups: contents hidden in the Layers panel
    this.version = 0; // bumped on every change (used for thumbnails)
    this.contentVersion = 0; // bumped when pixels or the mask change (used for style caches)
  }

  static group(name) {
    const g = new Layer({ name, kind: 'group' });
    g.blendMode = PASS_THROUGH;
    return g;
  }

  static adjustmentLayer(name, type, params) {
    const l = new Layer({ name, kind: 'adjustment' });
    l.adjustment = { type, params: copyJSON(params) };
    return l;
  }

  get isGroup() { return this.kind === 'group'; }
  get isAdjustment() { return this.kind === 'adjustment'; }
  get isPixel() { return this.kind === 'pixel'; }

  get ctx() { return this.canvas.getContext('2d'); }
  get width() { return this.canvas.width; }
  get height() { return this.canvas.height; }
  get bounds() { return { x: this.x, y: this.y, w: this.canvas.width, h: this.canvas.height }; }

  touch() {
    this.version++;
    this.contentVersion++;
  }

  /** Grow the canvas (never shrinks) so it covers `rect` in document coordinates. */
  ensureCovers(rect) {
    if (!rect) return false;
    const cur = this.bounds;
    const u = rectUnion(cur, rect);
    if (u.x === cur.x && u.y === cur.y && u.w === cur.w && u.h === cur.h) return false;
    const c = createCanvas(u.w, u.h);
    c.getContext('2d').drawImage(this.canvas, cur.x - u.x, cur.y - u.y);
    this.canvas = c;
    this.x = u.x;
    this.y = u.y;
    if (this.mask) {
      // Keep the mask where it was in the document, and covering the layer.
      this.mask.ox += cur.x - u.x;
      this.mask.oy += cur.y - u.y;
      this.mask.ensureCovers(this, this.bounds);
    }
    return true;
  }

  /** Mask placement in document coordinates for compositing, or null when off. */
  get activeMask() {
    const m = this.mask;
    if (!m || !m.enabled) return null;
    m.ensureCovers(this, this.bounds);
    return { canvas: m.canvas, x: this.x + m.ox, y: this.y + m.oy };
  }

  /** Snapshot the whole layer, or just `rect` (document coordinates). */
  snapshot(rect) {
    if (!rect) {
      return {
        full: true, canvas: cloneCanvas(this.canvas), x: this.x, y: this.y,
        text: this.text ? { ...this.text } : null,
        mask: this.mask ? this.mask.clone() : null,
      };
    }
    const maskRegion = this.mask ? this.mask.snapshot(this, rect) : null;
    const r = rectIntersect(rect, this.bounds);
    if (!r) return { full: false, rect: null, maskRegion };
    const c = createCanvas(r.w, r.h);
    c.getContext('2d').drawImage(this.canvas, this.x - r.x, this.y - r.y);
    return { full: false, rect: r, canvas: c, maskRegion };
  }

  restore(snap) {
    if (snap.full) {
      this.canvas = cloneCanvas(snap.canvas);
      this.x = snap.x;
      this.y = snap.y;
      this.text = snap.text ? { ...snap.text } : null;
      this.mask = snap.mask ? snap.mask.clone() : null;
      if (!this.mask) this.maskSelected = false;
    } else {
      if (snap.rect) {
        this.ensureCovers(snap.rect);
        const ctx = this.ctx;
        const lx = snap.rect.x - this.x;
        const ly = snap.rect.y - this.y;
        ctx.clearRect(lx, ly, snap.rect.w, snap.rect.h);
        ctx.drawImage(snap.canvas, lx, ly);
      }
      if (snap.maskRegion && this.mask) this.mask.restoreRegion(this, snap.maskRegion);
    }
    this.touch();
  }

  /** A copy with a new id (the parent is kept; see cloneLayers for whole groups). */
  clone(name = this.name + ' copy') {
    const l = new Layer({ name, canvas: cloneCanvas(this.canvas), x: this.x, y: this.y, kind: this.kind });
    l.parent = this.parent;
    l.visible = this.visible;
    l.opacity = this.opacity;
    l.blendMode = this.blendMode;
    l.text = this.text ? { ...this.text } : null;
    l.mask = this.mask ? this.mask.clone() : null;
    l.adjustment = copyJSON(this.adjustment);
    l.styles = copyJSON(this.styles);
    l.collapsed = this.collapsed;
    return l;
  }

  /** Alpha (0-255) at a document point. */
  alphaAt(x, y) {
    const lx = Math.floor(x - this.x);
    const ly = Math.floor(y - this.y);
    if (lx < 0 || ly < 0 || lx >= this.width || ly >= this.height) return 0;
    return this.ctx.getImageData(lx, ly, 1, 1).data[3];
  }
}
