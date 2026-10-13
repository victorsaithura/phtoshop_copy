import { Tool, strokeOutline } from './tool.js';
import { clamp, cloneCanvas, createCanvas, drawRegion, hexToRgb, rectIntersect, rectUnion } from '../core/utils.js';
import { maskValue } from '../core/mask.js';

/* ---------- Brush tips ---------- */

const tipCache = new Map();

/** A round tip bitmap; soft edges use a cosine falloff controlled by hardness. */
export function getTip(diameter, hardness, color, aliased) {
  const size = aliased ? Math.max(1, Math.round(diameter)) : Math.max(1, Math.ceil(diameter));
  const key = `${size}|${aliased ? 'a' : hardness.toFixed(3)}|${color}`;
  const cached = tipCache.get(key);
  if (cached) return cached;
  if (tipCache.size > 48) tipCache.clear();

  const c = createCanvas(size, size);
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(size, size);
  const { r, g, b } = hexToRgb(color);
  const R = size / 2;
  const inner = R * hardness;
  for (let y = 0, i = 0; y < size; y++) {
    for (let x = 0; x < size; x++, i += 4) {
      const dist = Math.hypot(x + 0.5 - R, y + 0.5 - R);
      let a;
      if (aliased) a = dist <= R ? 1 : 0;
      else if (hardness >= 0.99) a = clamp(R - dist + 0.5, 0, 1);
      else if (dist <= inner) a = 1;
      else if (dist >= R) a = 0;
      else a = 0.5 * (1 + Math.cos(Math.PI * ((dist - inner) / (R - inner))));
      img.data[i] = r;
      img.data[i + 1] = g;
      img.data[i + 2] = b;
      img.data[i + 3] = Math.round(a * 255);
    }
  }
  ctx.putImageData(img, 0, 0);
  tipCache.set(key, c);
  return c;
}

/* ---------- Stroke ---------- */

/**
 * One brush stroke. Dabs accumulate on a separate canvas (limited by flow);
 * the stroke is applied to the layer at the tool's opacity when committed,
 * which matches how Photoshop's opacity and flow interact.
 */
export class Stroke {
  constructor(app, layer, o) {
    this.app = app;
    this.doc = app.doc;
    this.layer = layer;
    this.o = o; // { size, hardness, flow, opacity, spacing, color, erase, aliased, pressureSize }
    this.canvas = createCanvas(this.doc.width, this.doc.height);
    this.ctx = this.canvas.getContext('2d');
    this.scratch = null; // layer + stroke, for display
    this.masked = null; // stroke limited to the selection
    this.maskedDirty = null; // region of `masked` that is out of date
    this.dirty = null; // region changed since the last screen update
    this.bounds = null;
    this.last = null;
    this.since = 0;
    this.tip = getTip(o.size, o.hardness, o.color, o.aliased);
  }

  _sizeAt(p) {
    return this.o.pressureSize ? Math.max(1, this.o.size * p) : this.o.size;
  }

  _dab(x, y, p) {
    const { o, ctx } = this;
    const size = this._sizeAt(p);
    let left, top, d;
    ctx.globalAlpha = o.flow;
    if (o.aliased) {
      d = Math.max(1, Math.round(size));
      const tip = d === Math.max(1, Math.round(o.size)) ? this.tip : getTip(d, 1, o.color, true);
      left = Math.round(x - d / 2);
      top = Math.round(y - d / 2);
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(tip, left, top);
    } else {
      d = size;
      left = x - d / 2;
      top = y - d / 2;
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(this.tip, left, top, d, d);
    }
    const r = { x: Math.floor(left) - 1, y: Math.floor(top) - 1, w: Math.ceil(d) + 3, h: Math.ceil(d) + 3 };
    this.bounds = rectUnion(this.bounds, r);
    this.dirty = rectUnion(this.dirty, r);
    this.maskedDirty = rectUnion(this.maskedDirty, r);
  }

  /** Region changed since the last call (for partial redraws). */
  takeDirty() {
    const d = this.dirty;
    this.dirty = null;
    return d;
  }

  start(x, y, p) {
    this.last = { x, y, p };
    this.since = 0;
    this._dab(x, y, p);
  }

  /** Place evenly spaced dabs from the last point to (x, y). */
  lineTo(x, y, p) {
    const { x: lx, y: ly, p: lp } = this.last;
    const dx = x - lx;
    const dy = y - ly;
    const dist = Math.hypot(dx, dy);
    if (dist < 1e-6) return;
    const spacing = (pp) => Math.max(this.o.aliased ? 1 : 0.5, this._sizeAt(pp) * this.o.spacing);
    let traveled = 0;
    let need = spacing(lp) - this.since;
    while (traveled + need <= dist) {
      traveled += need;
      const t = traveled / dist;
      const pp = lp + (p - lp) * t;
      this._dab(lx + dx * t, ly + dy * t, pp);
      need = spacing(pp);
    }
    // Distance covered since the most recent dab carries over to the next segment.
    this.since = traveled > 0 ? dist - traveled : this.since + dist;
    this.last = { x, y, p };
  }

  /** Stroke pixels limited to the selection. */
  _source() {
    const sel = this.doc.selection;
    if (sel.isEmpty()) return this.canvas;
    let r = this.maskedDirty;
    if (!this.masked) {
      this.masked = createCanvas(this.canvas.width, this.canvas.height);
      r = this.doc.bounds;
    }
    if (r) {
      const m = this.masked.getContext('2d');
      m.save();
      m.beginPath();
      m.rect(r.x, r.y, r.w, r.h);
      m.clip();
      m.clearRect(r.x, r.y, r.w, r.h);
      drawRegion(m, this.canvas, 0, 0, r);
      m.globalCompositeOperation = 'destination-in';
      drawRegion(m, sel.mask, 0, 0, r);
      m.restore();
      this.maskedDirty = null;
    }
    return this.masked;
  }

  /** The layer with the stroke applied, for live display (only `rect` is refreshed). */
  preview(rect) {
    const { layer, o } = this;
    if (!this.scratch) {
      this.scratch = createCanvas(this.doc.width, this.doc.height);
      rect = null;
    }
    const r = rect ? rectIntersect(rect, this.doc.bounds) : this.doc.bounds;
    if (r) {
      const s = this.scratch.getContext('2d');
      s.save();
      s.beginPath();
      s.rect(r.x, r.y, r.w, r.h);
      s.clip();
      s.clearRect(r.x, r.y, r.w, r.h);
      drawRegion(s, layer.canvas, layer.x, layer.y, r);
      s.globalAlpha = o.opacity;
      s.globalCompositeOperation = o.erase ? 'destination-out' : 'source-over';
      drawRegion(s, this._source(), 0, 0, r);
      s.restore();
    }
    return { canvas: this.scratch, x: 0, y: 0 };
  }

  commit(label) {
    const rect = rectIntersect(this.bounds, this.doc.bounds);
    if (!rect) return;
    const src = this._source();
    const { layer, o } = this;
    if (!o.erase) layer.ensureCovers(rect);
    this.app.transact(label, { layers: [{ layer, rect }] }, () => {
      const c = layer.ctx;
      c.save();
      c.globalAlpha = o.opacity;
      c.globalCompositeOperation = o.erase ? 'destination-out' : 'source-over';
      c.drawImage(src, -layer.x, -layer.y);
      c.restore();
    });
  }
}

/**
 * A stroke on a layer mask: moves mask values toward `value` (0 hide … 255
 * reveal) by the stroke's coverage, opacity and the selection.
 */
export class MaskStroke extends Stroke {
  constructor(app, layer, o, value) {
    super(app, layer, { ...o, color: '#ffffff', erase: false });
    this.value = value;
    layer.mask.ensureCovers(layer, this.doc.bounds);
    this.orig = layer.mask.read(layer, this.doc.bounds);
    this.work = cloneCanvas(layer.mask.canvas);
  }

  _apply(rect) {
    const doc = this.doc;
    const r = rectIntersect(rect, doc.bounds);
    if (!r) return;
    const cov = this.ctx.getImageData(r.x, r.y, r.w, r.h).data;
    const sel = doc.selection.alpha;
    const W = doc.width;
    const k = this.o.opacity;
    const vals = new Uint8Array(r.w * r.h);
    for (let y = 0; y < r.h; y++) {
      for (let x = 0; x < r.w; x++) {
        const i = y * r.w + x;
        const di = (r.y + y) * W + r.x + x;
        let a = (cov[i * 4 + 3] / 255) * k;
        if (sel) a *= sel[di] / 255;
        const old = this.orig[di];
        vals[i] = Math.round(old + (this.value - old) * a);
      }
    }
    this.layer.mask.write(this.layer, r, vals, this.work);
  }

  preview(rect) {
    this._apply(rect || this.doc.bounds);
    const { layer } = this;
    const m = layer.mask;
    return {
      canvas: layer.canvas, x: layer.x, y: layer.y,
      mask: m.enabled ? { canvas: this.work, x: layer.x + m.ox, y: layer.y + m.oy } : null,
    };
  }

  commit(label) {
    const rect = rectIntersect(this.bounds, this.doc.bounds);
    if (!rect) return;
    this._apply(rect);
    const { layer, work } = this;
    this.app.transact(label, { layers: [{ layer, rect }] }, () => {
      const b = layer.mask.bounds(layer);
      const lx = rect.x - b.x;
      const ly = rect.y - b.y;
      const c = layer.mask.canvas.getContext('2d');
      c.clearRect(lx, ly, rect.w, rect.h);
      c.drawImage(work, lx, ly, rect.w, rect.h, lx, ly, rect.w, rect.h);
    });
  }
}

/* ---------- Brush, Pencil and Eraser tools ---------- */

const KINDS = {
  brush: { name: 'Brush Tool', key: 'B', defaults: { size: 25, hardness: 0.8, opacity: 1, flow: 1, pressure: true } },
  pencil: { name: 'Pencil Tool', key: 'B', defaults: { size: 4, opacity: 1, pressure: false } },
  eraser: { name: 'Eraser Tool', key: 'E', defaults: { size: 40, hardness: 0.8, opacity: 1, flow: 1, pressure: true } },
};

/** Photoshop's [ and ] size increments. */
export function stepBrushSize(size, dir) {
  const steps = [[10, 1], [100, 10], [200, 25], [300, 50], [1000, 100], [Infinity, 250]];
  const ref = dir > 0 ? size : size - 0.001;
  const inc = steps.find(([limit]) => ref < limit)[1];
  const next = dir > 0 ? Math.floor(size / inc) * inc + inc : Math.ceil(size / inc) * inc - inc;
  return clamp(next, 1, 1000);
}

/** Round brush outline (and a crosshair when small) at the pointer. */
export function brushCursor(ctx, view, hover, size) {
  if (!hover) return;
  const d = size * view.zoom;
  const { sx, sy } = hover;
  if (d >= 6) strokeOutline(ctx, (c) => c.arc(sx, sy, d / 2, 0, Math.PI * 2));
  if (d < 14) {
    strokeOutline(ctx, (c) => {
      c.moveTo(sx - 5, sy);
      c.lineTo(sx + 5, sy);
      c.moveTo(sx, sy - 5);
      c.lineTo(sx, sy + 5);
    });
  }
}

/**
 * Photoshop brush keys: [ ] size, Shift+[ ] hardness, digits set `amountKey`
 * (opacity, exposure, strength…) in tenths. Returns true when handled.
 */
export function brushKeys(tool, e, { hardness = true, amountKey = 'opacity' } = {}) {
  if (e.ctrlKey || e.metaKey || e.altKey) return false;
  if (e.code === 'BracketLeft' || e.code === 'BracketRight') {
    const dir = e.code === 'BracketRight' ? 1 : -1;
    if (e.shiftKey) {
      if (hardness && 'hardness' in tool.options) {
        tool.setOption('hardness', clamp(Math.round(tool.options.hardness * 4 + dir) / 4, 0, 1), true);
      }
    } else {
      tool.setOption('size', stepBrushSize(tool.options.size, dir), true);
    }
    return true;
  }
  if (amountKey && amountKey in tool.options && /^Digit\d$/.test(e.code) && !e.shiftKey) {
    const n = Number(e.code.slice(5));
    tool.setOption(amountKey, n === 0 ? 1 : n / 10, true);
    return true;
  }
  return false;
}

export class BrushTool extends Tool {
  constructor(app, kind = 'brush') {
    const meta = KINDS[kind];
    super(app, { id: kind, name: meta.name, key: meta.key, cursor: 'none' });
    this.kind = kind;
    this.options = { ...meta.defaults };
    this.altEyedropper = kind !== 'eraser';
    this.wantsCoalesced = true;
    this.stroke = null;
    this.lastPoint = null;
  }

  get historyLabel() { return this.name.replace(' Tool', ''); }

  onPointerDown(e) {
    const layer = this.app.editableLayer(this.name.toLowerCase(), { allowMask: true });
    if (!layer) return;
    const o = this.options;
    const pencil = this.kind === 'pencil';
    const settings = {
      size: o.size,
      hardness: pencil ? 1 : o.hardness,
      flow: pencil ? 1 : o.flow,
      opacity: o.opacity,
      spacing: pencil ? 0.1 : 0.25,
      color: this.app.colors.fg,
      erase: this.kind === 'eraser',
      aliased: pencil,
      pressureSize: o.pressure && e.pen,
    };
    if (layer.mask && layer.maskSelected) {
      // On a mask, colours become grey levels; the eraser paints the background colour.
      const color = this.kind === 'eraser' ? this.app.colors.bg : this.app.colors.fg;
      this.stroke = new MaskStroke(this.app, layer, settings, maskValue(color));
    } else {
      this.stroke = new Stroke(this.app, layer, settings);
    }
    // Shift-click draws a straight line from the end of the previous stroke.
    if (e.shift && this.lastPoint && this.lastPoint.layerId === layer.id) {
      this.stroke.start(this.lastPoint.x, this.lastPoint.y, e.pressure);
      this.stroke.lineTo(e.x, e.y, e.pressure);
    } else {
      this.stroke.start(e.x, e.y, e.pressure);
    }
    this.app.renderer.request(true, this.stroke.takeDirty());
  }

  onPointerMove(e) {
    if (!this.stroke) return;
    this.stroke.lineTo(e.x, e.y, e.pressure);
    const dirty = this.stroke.takeDirty();
    if (dirty) this.app.renderer.request(true, dirty);
  }

  onPointerUp() {
    const s = this.stroke;
    if (!s) return;
    this.stroke = null;
    s.commit(this.historyLabel);
    this.lastPoint = { x: s.last.x, y: s.last.y, layerId: s.layer.id };
  }

  cancel() {
    if (!this.stroke) return;
    const bounds = this.stroke.bounds;
    this.stroke = null;
    this.app.renderer.request(true, bounds);
  }

  layerOverride(layer, rect) {
    return this.stroke && layer === this.stroke.layer ? this.stroke.preview(rect) : null;
  }

  drawOverlay(ctx, view) {
    brushCursor(ctx, view, this.app.hover, this.options.size);
  }

  onKeyDown(e) {
    return brushKeys(this, e, { hardness: this.kind !== 'pencil' });
  }

  buildOptions(bar) {
    const o = this.options;
    const pencil = this.kind === 'pencil';
    bar.slider({ label: 'Size', min: 1, max: 1000, value: o.size, unit: 'px', curve: 'log',
      onInput: (v) => this.setOption('size', v) });
    if (!pencil) {
      bar.slider({ label: 'Hardness', min: 0, max: 100, value: Math.round(o.hardness * 100), unit: '%',
        onInput: (v) => this.setOption('hardness', v / 100) });
    }
    bar.sep();
    bar.slider({ label: 'Opacity', min: 1, max: 100, value: Math.round(o.opacity * 100), unit: '%',
      onInput: (v) => this.setOption('opacity', v / 100) });
    if (!pencil) {
      bar.slider({ label: 'Flow', min: 1, max: 100, value: Math.round(o.flow * 100), unit: '%',
        onInput: (v) => this.setOption('flow', v / 100) });
    }
    bar.sep();
    bar.checkbox({ label: 'Pen pressure', title: 'Use stylus pressure to control size',
      checked: o.pressure, onChange: (v) => this.setOption('pressure', v) });
  }
}
