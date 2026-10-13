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

/**
 * A raster layer. Its canvas can be any size and sits at (x, y) in document
 * space, so pixels moved outside the document are kept, as in Photoshop.
 */
export class Layer {
  constructor({ name = 'Layer', width = 1, height = 1, x = 0, y = 0, canvas = null } = {}) {
    this.id = nextLayerId++;
    this.name = name;
    this.canvas = canvas || createCanvas(width, height);
    this.x = x;
    this.y = y;
    this.visible = true;
    this.opacity = 1;
    this.blendMode = 'source-over';
    this.locked = false;
    this.version = 0; // bumped on every pixel change (used for thumbnails)
  }

  get ctx() { return this.canvas.getContext('2d'); }
  get width() { return this.canvas.width; }
  get height() { return this.canvas.height; }
  get bounds() { return { x: this.x, y: this.y, w: this.canvas.width, h: this.canvas.height }; }

  touch() { this.version++; }

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
    return true;
  }

  /** Snapshot the whole layer, or just `rect` (document coordinates). */
  snapshot(rect) {
    if (!rect) return { full: true, canvas: cloneCanvas(this.canvas), x: this.x, y: this.y };
    const r = rectIntersect(rect, this.bounds);
    if (!r) return { full: false, rect: null };
    const c = createCanvas(r.w, r.h);
    c.getContext('2d').drawImage(this.canvas, this.x - r.x, this.y - r.y);
    return { full: false, rect: r, canvas: c };
  }

  restore(snap) {
    if (snap.full) {
      this.canvas = cloneCanvas(snap.canvas);
      this.x = snap.x;
      this.y = snap.y;
    } else if (snap.rect) {
      this.ensureCovers(snap.rect);
      const ctx = this.ctx;
      const lx = snap.rect.x - this.x;
      const ly = snap.rect.y - this.y;
      ctx.clearRect(lx, ly, snap.rect.w, snap.rect.h);
      ctx.drawImage(snap.canvas, lx, ly);
    }
    this.touch();
  }

  clone(name = this.name + ' copy') {
    const l = new Layer({ name, canvas: cloneCanvas(this.canvas), x: this.x, y: this.y });
    l.visible = this.visible;
    l.opacity = this.opacity;
    l.blendMode = this.blendMode;
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
