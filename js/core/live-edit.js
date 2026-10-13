import { cloneCanvas, rectInflate, rectIntersect } from './utils.js';
import { copyImageData } from './pixels.js';

/**
 * A pixel operation on the active layer, limited (and feathered) by the
 * selection, with an optional live preview. `margin` widens the area read
 * around a selection for filters that sample neighbouring pixels.
 */
export class LiveEdit {
  static start(app, commandName, margin = 0) {
    const layer = app.editableLayer(commandName);
    if (!layer) return null;
    const sel = app.doc.selection;
    const region = sel.isEmpty()
      ? layer.bounds
      : rectIntersect(rectInflate(sel.bounds, Math.min(1000, Math.ceil(margin))), layer.bounds);
    if (!region) {
      app.toast('Could not complete the command because the selected area is empty.');
      return null;
    }
    return new LiveEdit(app, layer, region);
  }

  constructor(app, layer, region) {
    this.app = app;
    this.doc = app.doc;
    this.layer = layer;
    this.region = region;
    this.src = layer.ctx.getImageData(region.x - layer.x, region.y - layer.y, region.w, region.h);
    this.mask = this._selectionMask();
    this.result = null;
    this.canvas = null;
  }

  /** Selection alpha for each pixel of the region (null = no selection). */
  _selectionMask() {
    const sel = this.doc.selection;
    if (sel.isEmpty()) return null;
    const { x, y, w, h } = this.region;
    const W = sel.width;
    const H = sel.height;
    const m = new Uint8Array(w * h);
    for (let yy = 0; yy < h; yy++) {
      const dy = y + yy;
      if (dy < 0 || dy >= H) continue;
      for (let xx = 0; xx < w; xx++) {
        const dx = x + xx;
        if (dx >= 0 && dx < W) m[yy * w + xx] = sel.alpha[dy * W + dx];
      }
    }
    return m;
  }

  get context() {
    return {
      fg: this.app.colors.fg,
      bg: this.app.colors.bg,
      mask: this.mask,
      region: this.region,
      docWidth: this.doc.width,
      docHeight: this.doc.height,
    };
  }

  /** Run fn(imageData, ctx) on a copy of the original pixels and blend through the selection. */
  compute(fn) {
    const out = fn(copyImageData(this.src), this.context);
    if (this.mask) {
      const d = out.data;
      const s = this.src.data;
      const m = this.mask;
      for (let p = 0, i = 0; p < m.length; p++, i += 4) {
        const a = m[p];
        if (a === 255) continue;
        if (a === 0) {
          d[i] = s[i];
          d[i + 1] = s[i + 1];
          d[i + 2] = s[i + 2];
          d[i + 3] = s[i + 3];
        } else {
          const k = a / 255;
          d[i] = s[i] + (d[i] - s[i]) * k;
          d[i + 1] = s[i + 1] + (d[i + 1] - s[i + 1]) * k;
          d[i + 2] = s[i + 2] + (d[i + 2] - s[i + 2]) * k;
          d[i + 3] = s[i + 3] + (d[i + 3] - s[i + 3]) * k;
        }
      }
    }
    this.result = out;
    return out;
  }

  show() {
    if (!this.result) return;
    const { layer, region } = this;
    if (!this.canvas) this.canvas = cloneCanvas(layer.canvas);
    this.canvas.getContext('2d').putImageData(this.result, region.x - layer.x, region.y - layer.y);
    this.app.preview = { layer, canvas: this.canvas, x: layer.x, y: layer.y };
    this.app.renderer.request(true, region);
  }

  hide() {
    if (this.app.preview?.layer !== this.layer) return;
    this.app.preview = null;
    this.app.renderer.request(true, this.region);
  }

  commit(label) {
    this.hide();
    if (!this.result) return;
    const { layer, region, result } = this;
    this.app.transact(label, { layers: [{ layer, rect: region }] }, () => {
      layer.ctx.putImageData(result, region.x - layer.x, region.y - layer.y);
    });
  }
}
