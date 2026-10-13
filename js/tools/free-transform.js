import { Tool, DoubleClick, strokeOutline } from './tool.js';
import { contentBounds, transformCanvasAt } from '../core/transform.js';
import { createCanvas } from '../core/utils.js';

// Handles as [hx, hy]: −1/0/1 = left/centre/right, top/middle/bottom.
const HANDLES = {
  nw: [-1, -1], n: [0, -1], ne: [1, -1], e: [1, 0], se: [1, 1], s: [0, 1], sw: [-1, 1], w: [-1, 0],
};
const CURSORS = { nw: 'nwse-resize', se: 'nwse-resize', ne: 'nesw-resize', sw: 'nesw-resize', n: 'ns-resize', s: 'ns-resize', e: 'ew-resize', w: 'ew-resize', move: 'move', rotate: 'crosshair' };

function insidePolygon(pts, x, y) {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i];
    const [xj, yj] = pts[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/**
 * Free Transform (Edit ▸ Free Transform): scale with the handles
 * (proportional; Shift for free), drag inside to move, drag outside to rotate
 * (Shift snaps to 15°). Enter or double-click applies, Esc cancels.
 */
export class FreeTransformTool extends Tool {
  constructor(app) {
    super(app, { id: 'transform', name: 'Free Transform', icon: 'transform', cursor: 'default' });
    this.options = { smooth: true };
    this.t = null;
    this.drag = null;
    this.clicks = new DoubleClick();
    // A transform belongs to its document; drop it if that document goes away.
    app.on('document', () => {
      if (this.t && !app.doc?.layers.includes(this.t.layer)) this.discard();
    });
  }

  /** Begin transforming the active layer; returns false if there is nothing to transform. */
  start(returnTo) {
    if (this.app.doc?.activeLayer && !this.app.doc.activeLayer.isPixel) {
      this.app.toast('Free Transform works on pixel and type layers. Use Edit ▸ Transform to flip or rotate a group.');
      return false;
    }
    const layer = this.app.editableLayer('free transform command', { allowMask: true });
    if (!layer) return false;
    const b = contentBounds(layer);
    if (!b) {
      this.app.toast('Could not transform because the layer is empty.');
      return false;
    }
    const src = createCanvas(b.w, b.h);
    src.getContext('2d').drawImage(layer.canvas, layer.x - b.x, layer.y - b.y);
    let maskSrc = null;
    if (layer.mask) {
      const mb = layer.mask.bounds(layer);
      maskSrc = createCanvas(b.w, b.h);
      maskSrc.getContext('2d').drawImage(layer.mask.canvas, mb.x - b.x, mb.y - b.y);
    }
    const cx = b.x + b.w / 2;
    const cy = b.y + b.h / 2;
    this.t = { layer, w: b.w, h: b.h, src, maskSrc, sx: 1, sy: 1, angle: 0, cx, cy, cx0: cx, cy0: cy, returnTo };
    this.cache = null;
    return true;
  }

  matrix(t = this.t) {
    return new DOMMatrix().translate(t.cx, t.cy).rotate(t.angle).scale(t.sx, t.sy).translate(-t.w / 2, -t.h / 2);
  }

  /** Document point of a handle (hx, hy in −1…1). */
  point(hx, hy, t = this.t) {
    const p = this.matrix(t).transformPoint(new DOMPoint(((hx + 1) / 2) * t.w, ((hy + 1) / 2) * t.h));
    return [p.x, p.y];
  }

  _render() {
    if (this.cache) return this.cache;
    const t = this.t;
    const m = this.matrix();
    const out = transformCanvasAt(t.src, 0, 0, m, this.options.smooth);
    if (t.maskSrc) {
      const mk = transformCanvasAt(t.maskSrc, 0, 0, m, this.options.smooth);
      out.mask = t.layer.mask.enabled ? mk : null;
      out.maskFull = mk;
    }
    this.cache = out;
    return out;
  }

  _changed() {
    this.cache = null;
    this.app.renderer.request(true);
  }

  layerOverride(layer) {
    if (!this.t || layer !== this.t.layer) return null;
    const r = this._render();
    return { canvas: r.canvas, x: r.x, y: r.y, mask: r.mask ?? undefined };
  }

  _hit(e) {
    const v = this.app.view;
    for (const [name, [hx, hy]] of Object.entries(HANDLES)) {
      const p = v.docToScreen(...this.point(hx, hy));
      if (Math.abs(e.sx - p.x) <= 8 && Math.abs(e.sy - p.y) <= 8) return name;
    }
    const quad = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([hx, hy]) => this.point(hx, hy));
    return insidePolygon(quad, e.x, e.y) ? 'move' : 'rotate';
  }

  onHover(e) {
    if (!this.t) return;
    const c = CURSORS[this._hit(e)];
    if (c !== this.cursor) {
      this.cursor = c;
      this.app.updateCursor();
    }
  }

  onPointerDown(e) {
    if (!this.t) return;
    const hit = this._hit(e);
    if (this.clicks.down(e) && hit === 'move') {
      this.commit();
      return;
    }
    const t = this.t;
    const d = { hit, x: e.x, y: e.y, t0: { ...t } };
    if (HANDLES[hit]) {
      const [hx, hy] = HANDLES[hit];
      d.fixed = this.point(-hx, -hy);
    }
    this.drag = d;
  }

  onPointerMove(e) {
    const d = this.drag;
    if (!d) return;
    this.clicks.move(e);
    const t = this.t;
    const t0 = d.t0;
    if (d.hit === 'move') {
      t.cx = t0.cx + e.x - d.x;
      t.cy = t0.cy + e.y - d.y;
    } else if (d.hit === 'rotate') {
      const a0 = Math.atan2(d.y - t0.cy, d.x - t0.cx);
      const a1 = Math.atan2(e.y - t0.cy, e.x - t0.cx);
      let angle = t0.angle + ((a1 - a0) * 180) / Math.PI;
      if (e.shift) angle = Math.round(angle / 15) * 15;
      t.angle = ((angle % 360) + 540) % 360 - 180;
    } else {
      const [hx, hy] = HANDLES[d.hit];
      const [fx, fy] = d.fixed;
      // Pointer offset from the fixed (opposite) point, in the box's own unrotated axes.
      const rad = (-t0.angle * Math.PI) / 180;
      const vx = (e.x - fx) * Math.cos(rad) - (e.y - fy) * Math.sin(rad);
      const vy = (e.x - fx) * Math.sin(rad) + (e.y - fy) * Math.cos(rad);
      let sx = hx ? vx / (hx * t.w) : t0.sx;
      let sy = hy ? vy / (hy * t.h) : t0.sy;
      if (hx && hy && !e.shift) {
        // Corner handles keep the proportions unless Shift is held.
        const f = Math.max(Math.abs(sx / t0.sx), Math.abs(sy / t0.sy));
        sx = t0.sx * Math.sign(sx / t0.sx || 1) * f;
        sy = t0.sy * Math.sign(sy / t0.sy || 1) * f;
      }
      if (Math.abs(sx * t.w) < 1) sx = Math.sign(sx || 1) / t.w;
      if (Math.abs(sy * t.h) < 1) sy = Math.sign(sy || 1) / t.h;
      t.sx = sx;
      t.sy = sy;
      // Re-centre so the fixed point stays put.
      const r = (t0.angle * Math.PI) / 180;
      const ox = (hx * t.w * sx) / 2;
      const oy = (hy * t.h * sy) / 2;
      t.cx = fx + ox * Math.cos(r) - oy * Math.sin(r);
      t.cy = fy + ox * Math.sin(r) + oy * Math.cos(r);
    }
    this._changed();
  }

  onPointerUp() {
    if (!this.drag) return;
    this.drag = null;
    this.app.emit('tool-options', this);
  }

  /** Apply the transform as one undoable step. */
  apply() {
    const t = this.t;
    if (!t) return;
    const r = this._render();
    this.t = null;
    this.drag = null;
    this.cache = null;
    const unchanged = t.sx === 1 && t.sy === 1 && !t.angle && t.cx === t.cx0 && t.cy === t.cy0;
    if (unchanged || !this.doc?.layers.includes(t.layer)) {
      this.app.renderer.request(true);
      return;
    }
    const layer = t.layer;
    this.app.transact('Free Transform', { layers: [layer] }, () => {
      layer.canvas = r.canvas;
      layer.x = r.x;
      layer.y = r.y;
      if (layer.mask && r.maskFull) {
        layer.mask.canvas = r.maskFull.canvas;
        layer.mask.ox = r.maskFull.x - layer.x;
        layer.mask.oy = r.maskFull.y - layer.y;
        layer.mask.ensureCovers(layer, layer.bounds);
      }
    });
  }

  commit() {
    const back = this.t?.returnTo;
    this.apply();
    this._finish(back);
  }

  /** Throw the transform away and go back to the previous tool. */
  discard() {
    if (!this.t) return;
    const back = this.t.returnTo;
    this.t = null;
    this.drag = null;
    this.cache = null;
    this.app.renderer.request(true);
    this._finish(back);
  }

  /** Abort a drag in progress (pointer cancelled, document switched…). */
  cancel() {
    if (!this.drag) return;
    Object.assign(this.t, this.drag.t0);
    this.drag = null;
    this._changed();
  }

  _finish(returnTo) {
    if (this.app.tool === this) this.app.setTool(returnTo && returnTo !== 'transform' ? returnTo : 'move');
  }

  onDeactivate() {
    // Switching tools applies the transform, as in Photoshop.
    this.apply();
  }

  onKeyDown(e) {
    if (e.key === 'Enter') {
      this.commit();
      return true;
    }
    if (e.key === 'Escape') {
      this.discard();
      return true;
    }
    return false;
  }

  drawOverlay(ctx, view) {
    if (!this.t) return;
    const pts = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([hx, hy]) => view.docToScreen(...this.point(hx, hy)));
    strokeOutline(ctx, (c) => {
      pts.forEach((p, i) => (i ? c.lineTo(p.x, p.y) : c.moveTo(p.x, p.y)));
      c.closePath();
    });
    ctx.fillStyle = '#ffffff';
    ctx.strokeStyle = '#000000';
    for (const [hx, hy] of Object.values(HANDLES)) {
      const p = view.docToScreen(...this.point(hx, hy));
      ctx.fillRect(p.x - 4, p.y - 4, 8, 8);
      ctx.strokeRect(p.x - 4, p.y - 4, 8, 8);
    }
    const c = view.docToScreen(this.t.cx, this.t.cy);
    strokeOutline(ctx, (g) => g.arc(c.x, c.y, 4, 0, Math.PI * 2));
  }

  buildOptions(bar) {
    const t = this.t;
    if (!t) return;
    bar.number({ label: 'W', min: 1, max: 10000, value: Math.round(Math.abs(t.sx) * 1000) / 10, unit: '%',
      onInput: (v) => { t.sx = Math.sign(t.sx) * v / 100; this._changed(); } });
    bar.number({ label: 'H', min: 1, max: 10000, value: Math.round(Math.abs(t.sy) * 1000) / 10, unit: '%',
      onInput: (v) => { t.sy = Math.sign(t.sy) * v / 100; this._changed(); } });
    bar.number({ label: 'Angle', min: -180, max: 180, value: Math.round(t.angle * 10) / 10, unit: '°',
      onInput: (v) => { t.angle = v; this._changed(); } });
    bar.select({ label: 'Interpolation', value: this.options.smooth ? 'smooth' : 'nearest',
      options: [{ value: 'smooth', label: 'Bicubic' }, { value: 'nearest', label: 'Nearest Neighbor' }],
      onChange: (v) => { this.setOption('smooth', v === 'smooth'); this._changed(); } });
    bar.sep();
    bar.button({ label: 'Cancel', title: 'Cancel the transform (Esc)', onClick: () => this.discard() });
    bar.button({ label: '✓ Apply', title: 'Apply the transform (Enter)', className: 'btn btn-small btn-primary', onClick: () => this.commit() });
  }
}
