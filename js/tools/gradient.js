import { Tool, strokeOutline } from './tool.js';
import { createCanvas, rectIntersect, rgbaString } from '../core/utils.js';
import { luma } from '../core/pixels.js';

const TYPES = [
  { value: 'linear', icon: 'grad-linear', title: 'Linear gradient' },
  { value: 'radial', icon: 'grad-radial', title: 'Radial gradient' },
  { value: 'angle', icon: 'grad-angle', title: 'Angle gradient' },
  { value: 'reflected', icon: 'grad-reflected', title: 'Reflected gradient' },
];

const PRESETS = [
  { value: 'fg-bg', label: 'Foreground to Background' },
  { value: 'fg-transparent', label: 'Foreground to Transparent' },
  { value: 'black-white', label: 'Black, White' },
];

/** Gradient Tool: drag to set the direction and length of the gradient. */
export class GradientTool extends Tool {
  constructor(app) {
    super(app, { id: 'gradient', name: 'Gradient Tool', key: 'G', cursor: 'crosshair' });
    this.options = { type: 'linear', preset: 'fg-bg', reverse: false, opacity: 1 };
    this.altEyedropper = true;
    this.rebuildOnColors = true; // the options bar shows a preview of the colours
    this.drag = null;
  }

  onPointerDown(e) {
    const layer = this.app.editableLayer('gradient tool', { allowMask: true });
    if (!layer) return;
    this.drag = { layer, x0: e.x, y0: e.y, x1: e.x, y1: e.y };
  }

  onPointerMove(e) {
    const d = this.drag;
    if (!d) return;
    let dx = e.x - d.x0;
    let dy = e.y - d.y0;
    if (e.shift) {
      const step = Math.PI / 4;
      const angle = Math.round(Math.atan2(dy, dx) / step) * step;
      const len = Math.hypot(dx, dy);
      dx = Math.cos(angle) * len;
      dy = Math.sin(angle) * len;
    }
    d.x1 = d.x0 + dx;
    d.y1 = d.y0 + dy;
  }

  _stops() {
    const { fg, bg } = this.app.colors;
    let stops;
    if (this.options.preset === 'fg-transparent') stops = [rgbaString(fg, 1), rgbaString(fg, 0)];
    else if (this.options.preset === 'black-white') stops = ['#000000', '#ffffff'];
    else stops = [fg, bg];
    return this.options.reverse ? stops.reverse() : stops;
  }

  _gradient(ctx, x0, y0, x1, y1) {
    const [c0, c1] = this._stops();
    const len = Math.hypot(x1 - x0, y1 - y0);
    let g;
    switch (this.options.type) {
      case 'radial':
        g = ctx.createRadialGradient(x0, y0, 0, x0, y0, len);
        break;
      case 'angle':
        if (!ctx.createConicGradient) return null;
        g = ctx.createConicGradient(Math.atan2(y1 - y0, x1 - x0), x0, y0);
        break;
      case 'reflected':
        g = ctx.createLinearGradient(x0 - (x1 - x0), y0 - (y1 - y0), x1, y1);
        g.addColorStop(0, c1);
        g.addColorStop(0.5, c0);
        g.addColorStop(1, c1);
        return g;
      default:
        g = ctx.createLinearGradient(x0, y0, x1, y1);
    }
    g.addColorStop(0, c0);
    g.addColorStop(1, c1);
    return g;
  }

  onPointerUp() {
    const d = this.drag;
    this.drag = null;
    if (!d || Math.hypot(d.x1 - d.x0, d.y1 - d.y0) < 1) {
      this.app.renderer.request(false);
      return;
    }
    const doc = this.doc;
    const sel = doc.selection;
    const rect = sel.isEmpty() ? doc.bounds : sel.bounds;
    const g = createCanvas(rect.w, rect.h);
    const gctx = g.getContext('2d');
    gctx.translate(-rect.x, -rect.y);
    const fill = this._gradient(gctx, d.x0, d.y0, d.x1, d.y1);
    if (!fill) {
      this.app.toast('Angle gradients are not supported by this browser.');
      return;
    }
    gctx.fillStyle = fill;
    gctx.fillRect(rect.x, rect.y, rect.w, rect.h);
    if (!sel.isEmpty()) {
      gctx.globalCompositeOperation = 'destination-in';
      gctx.drawImage(sel.mask, 0, 0);
    }
    const { layer } = d;
    if (layer.mask && layer.maskSelected) {
      this._maskGradient(layer, g, rect);
      return;
    }
    layer.ensureCovers(rect);
    this.app.transact('Gradient', { layers: [{ layer, rect }] }, () => {
      const c = layer.ctx;
      c.save();
      c.globalAlpha = this.options.opacity;
      c.drawImage(g, rect.x - layer.x, rect.y - layer.y);
      c.restore();
    });
  }

  /** Gradient on a layer mask: grey levels of the gradient become mask values. */
  _maskGradient(layer, g, rect) {
    const r = rectIntersect(rect, this.doc.bounds);
    if (!r) return;
    const gd = g.getContext('2d').getImageData(0, 0, rect.w, rect.h).data;
    const k = this.options.opacity;
    this.app.transact('Gradient', { layers: [{ layer, rect: r }] }, () => {
      const vals = layer.mask.read(layer, r);
      for (let y = 0; y < r.h; y++) {
        for (let x = 0; x < r.w; x++) {
          const gi = ((r.y - rect.y + y) * rect.w + (r.x - rect.x + x)) * 4;
          const a = (gd[gi + 3] / 255) * k;
          if (!a) continue;
          const i = y * r.w + x;
          const v = luma(gd[gi], gd[gi + 1], gd[gi + 2]);
          vals[i] = Math.round(vals[i] + (v - vals[i]) * a);
        }
      }
      layer.mask.write(layer, r, vals);
    });
  }

  cancel() {
    this.drag = null;
    this.app.renderer.request(false);
  }

  drawOverlay(ctx, view) {
    const d = this.drag;
    if (!d) return;
    const a = view.docToScreen(d.x0, d.y0);
    const b = view.docToScreen(d.x1, d.y1);
    strokeOutline(ctx, (c) => {
      c.moveTo(a.x, a.y);
      c.lineTo(b.x, b.y);
    });
    for (const p of [a, b]) strokeOutline(ctx, (c) => c.arc(p.x, p.y, 3.5, 0, Math.PI * 2));
  }

  buildOptions(bar) {
    const o = this.options;
    bar.gradientPreview(this._stops());
    bar.select({ value: o.preset, options: PRESETS, onChange: (v) => this.setOption('preset', v, true) });
    bar.segmented({ value: o.type, options: TYPES, onChange: (v) => this.setOption('type', v) });
    bar.sep();
    bar.slider({ label: 'Opacity', min: 1, max: 100, value: Math.round(o.opacity * 100), unit: '%',
      onInput: (v) => this.setOption('opacity', v / 100) });
    bar.checkbox({ label: 'Reverse', checked: o.reverse, onChange: (v) => this.setOption('reverse', v, true) });
  }
}
