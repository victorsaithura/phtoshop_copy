import { createCanvas, cloneCanvas, hexToRgb, rectIntersect, rectUnion } from './utils.js';
import { luma } from './pixels.js';

/**
 * Layer mask: a greyscale map stored as alpha (255 = reveal, 0 = hide) in a
 * canvas whose position (ox, oy) is relative to its layer, so the mask moves
 * with the layer. Areas outside the canvas use the `outside` value.
 */
export class Mask {
  constructor(w, h, ox = 0, oy = 0, value = 255) {
    this.canvas = createCanvas(w, h, { readFrequently: true });
    this.ox = ox;
    this.oy = oy;
    this.outside = value;
    this.enabled = true;
    if (value) fillValue(this.canvas.getContext('2d'), { x: 0, y: 0, w, h }, value);
  }

  get width() { return this.canvas.width; }
  get height() { return this.canvas.height; }

  /** Mask bounds in document coordinates. */
  bounds(layer) {
    return { x: layer.x + this.ox, y: layer.y + this.oy, w: this.canvas.width, h: this.canvas.height };
  }

  clone() {
    const m = new Mask(1, 1, this.ox, this.oy, 0);
    m.canvas = cloneCanvas(this.canvas, { readFrequently: true });
    m.outside = this.outside;
    m.enabled = this.enabled;
    return m;
  }

  /** Grow (never shrink) to cover `rect` (document coordinates); new area gets `outside`. */
  ensureCovers(layer, rect) {
    const cur = this.bounds(layer);
    const u = rectUnion(cur, rect);
    if (u.x === cur.x && u.y === cur.y && u.w === cur.w && u.h === cur.h) return;
    const c = createCanvas(u.w, u.h, { readFrequently: true });
    const ctx = c.getContext('2d');
    if (this.outside) fillValue(ctx, { x: 0, y: 0, w: u.w, h: u.h }, this.outside);
    ctx.clearRect(cur.x - u.x, cur.y - u.y, cur.w, cur.h);
    ctx.drawImage(this.canvas, cur.x - u.x, cur.y - u.y);
    this.canvas = c;
    this.ox = u.x - layer.x;
    this.oy = u.y - layer.y;
  }

  /** Mask values (0–255) for a document rect. */
  read(layer, r) {
    const out = new Uint8Array(r.w * r.h).fill(this.outside);
    const b = this.bounds(layer);
    const ir = rectIntersect(r, b);
    if (!ir) return out;
    const data = this.canvas.getContext('2d', { willReadFrequently: true })
      .getImageData(ir.x - b.x, ir.y - b.y, ir.w, ir.h).data;
    for (let y = 0; y < ir.h; y++) {
      for (let x = 0; x < ir.w; x++) {
        out[(ir.y - r.y + y) * r.w + (ir.x - r.x + x)] = data[(y * ir.w + x) * 4 + 3];
      }
    }
    return out;
  }

  /** Write mask values for a document rect, into `target` (defaults to this mask's canvas). */
  write(layer, r, values, target = null) {
    this.ensureCovers(layer, r); // may replace this.canvas, so pick the target afterwards
    const out = target || this.canvas;
    const b = this.bounds(layer);
    const img = new ImageData(r.w, r.h);
    for (let i = 0; i < values.length; i++) {
      img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = 255;
      img.data[i * 4 + 3] = values[i];
    }
    out.getContext('2d').putImageData(img, r.x - b.x, r.y - b.y);
  }

  snapshot(layer, rect) {
    if (!rect) return { full: true, mask: this.clone() };
    const b = this.bounds(layer);
    const r = rectIntersect(rect, b);
    if (!r) return { full: false, rect: null };
    const c = createCanvas(r.w, r.h);
    c.getContext('2d').drawImage(this.canvas, b.x - r.x, b.y - r.y);
    return { full: false, rect: r, canvas: c };
  }

  restoreRegion(layer, snap) {
    if (!snap.rect) return;
    this.ensureCovers(layer, snap.rect);
    const b = this.bounds(layer);
    const ctx = this.canvas.getContext('2d');
    ctx.clearRect(snap.rect.x - b.x, snap.rect.y - b.y, snap.rect.w, snap.rect.h);
    ctx.drawImage(snap.canvas, snap.rect.x - b.x, snap.rect.y - b.y);
  }
}

function fillValue(ctx, r, value) {
  ctx.clearRect(r.x, r.y, r.w, r.h);
  ctx.fillStyle = `rgba(255,255,255,${value / 255})`;
  ctx.fillRect(r.x, r.y, r.w, r.h);
}

/** A layer's pixels with its (enabled) mask applied, as a canvas at layer.x/y. */
export function maskedPixels(layer) {
  const c = cloneCanvas(layer.canvas);
  const m = layer.mask;
  if (m && m.enabled) {
    m.ensureCovers(layer, layer.bounds);
    const ctx = c.getContext('2d');
    ctx.globalCompositeOperation = 'destination-in';
    ctx.drawImage(m.canvas, m.ox, m.oy);
  }
  return c;
}

/** Mask value (0 = hide … 255 = reveal) for a colour, by its brightness. */
export function maskValue(hex) {
  const { r, g, b } = hexToRgb(hex);
  return Math.round(luma(r, g, b));
}
