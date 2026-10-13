import { createCanvas, cloneCanvas, rectInflate, rectIntersect, rectRound, rectUnion } from './utils.js';

/**
 * Pixel selection stored as an alpha mask (document size). An empty
 * selection has no mask. `path` is the marching-ants outline in document
 * coordinates and `alpha` is a cached copy of the mask's alpha channel.
 */
export class Selection {
  constructor(width, height) {
    this.width = width;
    this.height = height;
    this.mask = null;
    this.alpha = null;
    this.bounds = null;
    this.path = null;
    this.version = 0;
  }

  isEmpty() { return !this.mask; }

  _newMask() {
    return createCanvas(this.width, this.height, { readFrequently: true });
  }

  /**
   * Re-scan the mask: bounds, alpha cache and outline. `region` (optional)
   * is the only area that can contain selected pixels, which keeps updates
   * fast on large documents.
   */
  _update(region = null) {
    this.version++;
    const W = this.width;
    const H = this.height;
    const r = this.mask && rectIntersect(region ? rectRound(region) : { x: 0, y: 0, w: W, h: H }, { x: 0, y: 0, w: W, h: H });
    if (!r) {
      this.mask = this.alpha = this.bounds = this.path = null;
      return;
    }
    const data = this.mask.getContext('2d', { willReadFrequently: true }).getImageData(r.x, r.y, r.w, r.h).data;
    const alpha = new Uint8Array(W * H);
    let minX = W, minY = H, maxX = -1, maxY = -1;
    for (let y = 0; y < r.h; y++) {
      const row = (y + r.y) * W + r.x;
      for (let x = 0; x < r.w; x++) {
        const a = data[(y * r.w + x) * 4 + 3];
        if (!a) continue;
        alpha[row + x] = a;
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
    if (maxX < 0) {
      this.mask = this.alpha = this.bounds = this.path = null;
      return;
    }
    this.alpha = alpha;
    this.bounds = { x: minX + r.x, y: minY + r.y, w: maxX - minX + 1, h: maxY - minY + 1 };
    this.path = this._buildPath();
  }

  /** Outline of pixels with alpha >= 128, merged into straight runs. */
  _buildPath() {
    const { alpha, width: w, height: h } = this;
    const b = this.bounds;
    const inside = (x, y) => x >= 0 && y >= 0 && x < w && y < h && alpha[y * w + x] >= 128;
    const path = new Path2D();
    const x0 = b.x, x1 = b.x + b.w, y0 = b.y, y1 = b.y + b.h;
    // Horizontal edges along the line between rows y-1 and y.
    for (let y = y0; y <= y1; y++) {
      let start = -1;
      for (let x = x0; x <= x1; x++) {
        const edge = x < x1 && inside(x, y - 1) !== inside(x, y);
        if (edge && start < 0) start = x;
        else if (!edge && start >= 0) {
          path.moveTo(start, y);
          path.lineTo(x, y);
          start = -1;
        }
      }
    }
    // Vertical edges along the line between columns x-1 and x.
    for (let x = x0; x <= x1; x++) {
      let start = -1;
      for (let y = y0; y <= y1; y++) {
        const edge = y < y1 && inside(x - 1, y) !== inside(x, y);
        if (edge && start < 0) start = y;
        else if (!edge && start >= 0) {
          path.moveTo(x, start);
          path.lineTo(x, y);
          start = -1;
        }
      }
    }
    return path;
  }

  /**
   * Combine a shape with the selection.
   * drawShape(ctx) must fill the shape (fill style is preset to white).
   * mode: 'new' | 'add' | 'subtract' | 'intersect'
   */
  combine(drawShape, mode = 'new', feather = 0, shapeBounds = null) {
    let region = null;
    if (shapeBounds) {
      const sb = feather > 0 ? rectInflate(shapeBounds, Math.ceil(feather * 1.5) + 2) : shapeBounds;
      if (mode === 'new') region = sb;
      else if (mode === 'add') region = rectUnion(this.bounds, sb);
      else region = this.bounds; // subtract / intersect can only shrink
    }
    const shape = this._newMask();
    const sctx = shape.getContext('2d');
    sctx.fillStyle = '#fff';
    drawShape(sctx);
    if (feather > 0) {
      const blurred = this._newMask();
      const bctx = blurred.getContext('2d');
      bctx.filter = `blur(${feather / 2}px)`;
      bctx.drawImage(shape, 0, 0);
      shape.getContext('2d').clearRect(0, 0, this.width, this.height);
      shape.getContext('2d').drawImage(blurred, 0, 0);
    }
    if (mode === 'new' || (mode === 'add' && !this.mask)) {
      this.mask = shape;
    } else if (!this.mask) {
      // subtracting from / intersecting with nothing leaves nothing
      return this._update();
    } else {
      const ctx = this.mask.getContext('2d');
      ctx.save();
      ctx.globalCompositeOperation =
        mode === 'add' ? 'source-over' : mode === 'subtract' ? 'destination-out' : 'destination-in';
      ctx.drawImage(shape, 0, 0);
      ctx.restore();
    }
    this._update(region);
  }

  selectAll() {
    this.mask = this._newMask();
    const ctx = this.mask.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, this.width, this.height);
    // Known result: no need to scan the mask.
    this.version++;
    this.alpha = new Uint8Array(this.width * this.height).fill(255);
    this.bounds = { x: 0, y: 0, w: this.width, h: this.height };
    this.path = new Path2D();
    this.path.rect(0, 0, this.width, this.height);
  }

  clear() {
    if (this.mask) {
      // Remembered for Select ▸ Reselect.
      this.lastMask = this.mask;
      this.lastBounds = this.bounds;
    }
    this.mask = null;
    this._update();
  }

  /** Empty selection for a document of a new size (after crop, resize, rotate…). */
  reset(width, height) {
    this.width = width;
    this.height = height;
    this.mask = null;
    this.lastMask = null;
    this._update();
  }

  reselect() {
    if (!this.lastMask) return false;
    this.mask = cloneCanvas(this.lastMask, { readFrequently: true });
    this._update(this.lastBounds);
    return true;
  }

  invert() {
    const old = this.mask;
    this.mask = this._newMask();
    const ctx = this.mask.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, this.width, this.height);
    if (old) {
      ctx.globalCompositeOperation = 'destination-out';
      ctx.drawImage(old, 0, 0);
      ctx.globalCompositeOperation = 'source-over';
    }
    this._update();
  }

  translate(dx, dy) {
    if (!this.mask || (!dx && !dy)) return;
    const m = this._newMask();
    m.getContext('2d').drawImage(this.mask, dx, dy);
    this.mask = m;
    this._update({ x: this.bounds.x + dx, y: this.bounds.y + dy, w: this.bounds.w, h: this.bounds.h });
  }

  /**
   * Replace the selection with alpha values (0–255, one per document pixel).
   * `region` bounds where values can be non-zero, which keeps this fast.
   */
  fromAlpha(alpha, region = null) {
    const W = this.width;
    const r = rectIntersect(region ? rectRound(region) : { x: 0, y: 0, w: W, h: this.height }, { x: 0, y: 0, w: W, h: this.height });
    if (!r) {
      this.mask = null;
      this._update();
      return;
    }
    const img = new ImageData(r.w, r.h);
    const d = img.data;
    for (let y = 0; y < r.h; y++) {
      for (let x = 0; x < r.w; x++) {
        const a = alpha[(r.y + y) * W + r.x + x];
        if (!a) continue;
        const i = (y * r.w + x) * 4;
        d[i] = d[i + 1] = d[i + 2] = 255;
        d[i + 3] = a;
      }
    }
    this.mask = this._newMask();
    this.mask.getContext('2d').putImageData(img, r.x, r.y);
    this._update(r);
  }

  /** Is the document pixel at (x, y) selected (alpha >= 128)? */
  contains(x, y) {
    if (!this.alpha) return false;
    x = Math.floor(x);
    y = Math.floor(y);
    if (x < 0 || y < 0 || x >= this.width || y >= this.height) return false;
    return this.alpha[y * this.width + x] >= 128;
  }

  snapshot() {
    return {
      mask: this.mask ? cloneCanvas(this.mask, { readFrequently: true }) : null,
      bounds: this.bounds,
      width: this.width,
      height: this.height,
    };
  }

  restore(snap) {
    this.width = snap.width;
    this.height = snap.height;
    this.mask = snap.mask ? cloneCanvas(snap.mask, { readFrequently: true }) : null;
    this._update(snap.bounds);
  }
}
