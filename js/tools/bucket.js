import { Tool } from './tool.js';
import { createCanvas, hexToRgb } from '../core/utils.js';

/**
 * Flood-fill mask in document space. Returns { mask, bounds } where mask
 * holds 255 for pixels within `tol` of the seed colour on every channel.
 */
export function floodMask(data, w, h, sx, sy, tol, contiguous) {
  const p0 = (sy * w + sx) * 4;
  const r0 = data[p0], g0 = data[p0 + 1], b0 = data[p0 + 2], a0 = data[p0 + 3];
  const match = (i) => {
    const p = i * 4;
    return Math.abs(data[p] - r0) <= tol && Math.abs(data[p + 1] - g0) <= tol &&
      Math.abs(data[p + 2] - b0) <= tol && Math.abs(data[p + 3] - a0) <= tol;
  };
  const mask = new Uint8Array(w * h);
  let minX = w, minY = h, maxX = -1, maxY = -1;
  const mark = (x, y) => {
    mask[y * w + x] = 255;
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  };

  if (!contiguous) {
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (match(y * w + x)) mark(x, y);
  } else {
    // Scanline fill.
    const stack = [sx, sy];
    while (stack.length) {
      const y = stack.pop();
      const x = stack.pop();
      const row = y * w;
      if (mask[row + x] || !match(row + x)) continue;
      let lx = x;
      while (lx > 0 && !mask[row + lx - 1] && match(row + lx - 1)) lx--;
      let rx = x;
      while (rx < w - 1 && !mask[row + rx + 1] && match(row + rx + 1)) rx++;
      for (let i = lx; i <= rx; i++) mark(i, y);
      for (const ny of [y - 1, y + 1]) {
        if (ny < 0 || ny >= h) continue;
        const nrow = ny * w;
        let inRun = false;
        for (let i = lx; i <= rx; i++) {
          const ok = !mask[nrow + i] && match(nrow + i);
          if (ok && !inRun) {
            stack.push(i, ny);
            inRun = true;
          } else if (!ok) {
            inRun = false;
          }
        }
      }
    }
  }
  if (maxX < 0) return { mask, bounds: null };
  return { mask, bounds: { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 } };
}

/** Paint Bucket: fills similar-coloured pixels with the foreground colour. */
export class PaintBucketTool extends Tool {
  constructor(app) {
    super(app, { id: 'bucket', name: 'Paint Bucket Tool', key: 'G', cursor: 'crosshair' });
    this.options = { tolerance: 32, contiguous: true, allLayers: false, opacity: 1 };
    this.altEyedropper = true;
  }

  onPointerDown(e) {
    const doc = this.doc;
    const x = Math.floor(e.x);
    const y = Math.floor(e.y);
    if (x < 0 || y < 0 || x >= doc.width || y >= doc.height) return;
    const layer = this.app.editableLayer('paint bucket');
    if (!layer) return;
    const sel = doc.selection;
    if (!sel.isEmpty() && !sel.contains(x, y)) return;

    const W = doc.width;
    const H = doc.height;
    const src = createCanvas(W, H, { readFrequently: true });
    const sctx = src.getContext('2d', { willReadFrequently: true });
    if (this.options.allLayers) doc.composite(src);
    else sctx.drawImage(layer.canvas, layer.x, layer.y);
    const data = sctx.getImageData(0, 0, W, H).data;

    const { mask, bounds } = floodMask(data, W, H, x, y, this.options.tolerance, this.options.contiguous);
    if (!bounds) return;

    // Fill pixels, limited (and softened) by the selection.
    const { r, g, b } = hexToRgb(this.app.colors.fg);
    const fill = createCanvas(bounds.w, bounds.h);
    const fctx = fill.getContext('2d');
    const img = fctx.createImageData(bounds.w, bounds.h);
    const selAlpha = sel.isEmpty() ? null : sel.alpha;
    for (let yy = 0; yy < bounds.h; yy++) {
      for (let xx = 0; xx < bounds.w; xx++) {
        const di = (yy + bounds.y) * W + xx + bounds.x;
        let a = mask[di];
        if (!a) continue;
        if (selAlpha) a = (a * selAlpha[di]) / 255;
        const o = (yy * bounds.w + xx) * 4;
        img.data[o] = r;
        img.data[o + 1] = g;
        img.data[o + 2] = b;
        img.data[o + 3] = a;
      }
    }
    fctx.putImageData(img, 0, 0);

    layer.ensureCovers(bounds);
    this.app.transact('Paint Bucket', { layers: [{ layer, rect: bounds }] }, () => {
      const c = layer.ctx;
      c.save();
      c.globalAlpha = this.options.opacity;
      c.drawImage(fill, bounds.x - layer.x, bounds.y - layer.y);
      c.restore();
    });
  }

  buildOptions(bar) {
    const o = this.options;
    bar.slider({ label: 'Opacity', min: 1, max: 100, value: Math.round(o.opacity * 100), unit: '%',
      onInput: (v) => this.setOption('opacity', v / 100) });
    bar.number({ label: 'Tolerance', min: 0, max: 255, value: o.tolerance,
      onInput: (v) => this.setOption('tolerance', v) });
    bar.sep();
    bar.checkbox({ label: 'Contiguous', checked: o.contiguous, onChange: (v) => this.setOption('contiguous', v) });
    bar.checkbox({ label: 'All Layers', checked: o.allLayers, onChange: (v) => this.setOption('allLayers', v) });
  }
}
