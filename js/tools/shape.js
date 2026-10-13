import { Tool, strokeOutline } from './tool.js';
import { Layer } from '../core/layer.js';
import { createCanvas, rectRound, rectInflate } from '../core/utils.js';

const KINDS = {
  rect: { name: 'Rectangle Tool', label: 'Rectangle', icon: 'shape-rect' },
  ellipse: { name: 'Ellipse Tool', label: 'Ellipse', icon: 'shape-ellipse' },
  polygon: { name: 'Polygon Tool', label: 'Polygon', icon: 'shape-polygon' },
  line: { name: 'Line Tool', label: 'Line', icon: 'shape-line' },
};

const PAINT = [
  { value: 'fg', label: 'Foreground' },
  { value: 'bg', label: 'Background' },
  { value: '#000000', label: 'Black' },
  { value: '#ffffff', label: 'White' },
  { value: 'none', label: 'None' },
];

/** Adds the outline of a rounded rectangle (works where ctx.roundRect is missing). */
function roundRectPath(ctx, x, y, w, h, r) {
  r = Math.max(0, Math.min(r, Math.abs(w) / 2, Math.abs(h) / 2));
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/**
 * Rectangle, Ellipse, Polygon and Line tools. Drag to draw; Shift keeps
 * proportions (or 45° lines), Alt draws from the centre. Each shape becomes
 * a new layer.
 */
export class ShapeTool extends Tool {
  constructor(app, kind) {
    const meta = KINDS[kind];
    super(app, { id: `shape-${kind}`, name: meta.name, key: 'U', icon: meta.icon, cursor: 'crosshair' });
    this.kind = kind;
    this.label = meta.label;
    this.options = { fill: 'fg', stroke: 'none', strokeWidth: 4, radius: 0, sides: 5, weight: 4 };
    this.drag = null;
  }

  paint(value) {
    if (value === 'none') return null;
    if (value === 'fg') return this.app.colors.fg;
    if (value === 'bg') return this.app.colors.bg;
    return value;
  }

  onPointerDown(e) {
    this.drag = { x0: e.x, y0: e.y, x1: e.x, y1: e.y, constrain: false, center: false };
  }

  onPointerMove(e) {
    const d = this.drag;
    if (!d) return;
    d.x1 = e.x;
    d.y1 = e.y;
    d.constrain = e.shift;
    d.center = e.alt;
  }

  /** Shape geometry in document coordinates. */
  _geom(d) {
    if (this.kind === 'line') {
      let dx = d.x1 - d.x0;
      let dy = d.y1 - d.y0;
      if (d.constrain) {
        const step = Math.PI / 4;
        const a = Math.round(Math.atan2(dy, dx) / step) * step;
        const len = Math.hypot(dx, dy);
        dx = Math.cos(a) * len;
        dy = Math.sin(a) * len;
      }
      return { x0: d.x0, y0: d.y0, x1: d.x0 + dx, y1: d.y0 + dy };
    }
    let w = d.x1 - d.x0;
    let h = d.y1 - d.y0;
    if (d.constrain) {
      const s = Math.max(Math.abs(w), Math.abs(h));
      w = Math.sign(w || 1) * s;
      h = Math.sign(h || 1) * s;
    }
    let x = d.x0;
    let y = d.y0;
    if (d.center) {
      x -= w;
      y -= h;
      w *= 2;
      h *= 2;
    }
    return { x: Math.min(x, x + w), y: Math.min(y, y + h), w: Math.abs(w), h: Math.abs(h) };
  }

  _path(ctx, g) {
    ctx.beginPath();
    if (this.kind === 'rect') {
      if (this.options.radius > 0) roundRectPath(ctx, g.x, g.y, g.w, g.h, this.options.radius);
      else ctx.rect(g.x, g.y, g.w, g.h);
    } else if (this.kind === 'ellipse') {
      ctx.ellipse(g.x + g.w / 2, g.y + g.h / 2, g.w / 2, g.h / 2, 0, 0, Math.PI * 2);
    } else if (this.kind === 'polygon') {
      const n = Math.max(3, Math.round(this.options.sides));
      for (let i = 0; i < n; i++) {
        const a = -Math.PI / 2 + (i * 2 * Math.PI) / n;
        const px = g.x + g.w / 2 + (Math.cos(a) * g.w) / 2;
        const py = g.y + g.h / 2 + (Math.sin(a) * g.h) / 2;
        if (i) ctx.lineTo(px, py);
        else ctx.moveTo(px, py);
      }
      ctx.closePath();
    } else {
      ctx.moveTo(g.x0, g.y0);
      ctx.lineTo(g.x1, g.y1);
    }
  }

  /** Draw the shape with its fill and stroke. Returns false if nothing would be visible. */
  _draw(ctx, g) {
    const o = this.options;
    if (this.kind === 'line') {
      const color = this.paint(o.fill) || this.paint(o.stroke);
      if (!color) return false;
      this._path(ctx, g);
      ctx.strokeStyle = color;
      ctx.lineWidth = Math.max(1, o.weight);
      ctx.lineCap = 'butt';
      ctx.stroke();
      return true;
    }
    const fill = this.paint(o.fill);
    const stroke = o.strokeWidth > 0 ? this.paint(o.stroke) : null;
    if (!fill && !stroke) return false;
    this._path(ctx, g);
    if (fill) {
      ctx.fillStyle = fill;
      ctx.fill();
    }
    if (stroke) {
      ctx.strokeStyle = stroke;
      ctx.lineWidth = o.strokeWidth;
      ctx.lineJoin = this.kind === 'rect' && !o.radius ? 'miter' : 'round';
      ctx.stroke();
    }
    return true;
  }

  _bounds(g) {
    const o = this.options;
    if (this.kind === 'line') {
      const pad = Math.max(1, o.weight) / 2 + 2;
      return rectRound({
        x: Math.min(g.x0, g.x1) - pad, y: Math.min(g.y0, g.y1) - pad,
        w: Math.abs(g.x1 - g.x0) + pad * 2, h: Math.abs(g.y1 - g.y0) + pad * 2,
      });
    }
    return rectRound(rectInflate(g, (this.paint(o.stroke) ? o.strokeWidth : 0) + 2));
  }

  onPointerUp() {
    const d = this.drag;
    this.drag = null;
    if (!d) return;
    const g = this._geom(d);
    const tiny = this.kind === 'line' ? Math.hypot(g.x1 - g.x0, g.y1 - g.y0) < 2 : g.w < 2 || g.h < 2;
    if (tiny) {
      this.app.renderer.request(false);
      return;
    }
    const b = this._bounds(g);
    const canvas = createCanvas(b.w, b.h);
    const ctx = canvas.getContext('2d');
    ctx.translate(-b.x, -b.y);
    if (!this._draw(ctx, g)) {
      this.app.toast('Choose a fill or stroke colour in the options bar.');
      return;
    }
    const doc = this.doc;
    const n = doc.layers.filter((l) => l.name.startsWith(`${this.label} `)).length + 1;
    const layer = new Layer({ name: `${this.label} ${n}`, canvas, x: b.x, y: b.y });
    this.app.transact(this.label, { structure: true }, () => doc.addLayer(layer));
  }

  cancel() {
    this.drag = null;
    this.app.renderer.request(false);
  }

  drawOverlay(ctx, view) {
    const d = this.drag;
    if (!d) return;
    const g = this._geom(d);
    ctx.save();
    ctx.translate(view.panX, view.panY);
    ctx.scale(view.zoom, view.zoom);
    ctx.globalAlpha = 0.85;
    this._draw(ctx, g);
    ctx.restore();
    if (this.kind !== 'line') {
      const p = view.docToScreen(g.x, g.y);
      strokeOutline(ctx, (c) => c.rect(Math.round(p.x) + 0.5, Math.round(p.y) + 0.5, Math.round(g.w * view.zoom), Math.round(g.h * view.zoom)), true);
    }
  }

  buildOptions(bar) {
    const o = this.options;
    if (this.kind === 'line') {
      bar.select({ label: 'Color', value: o.fill, options: PAINT.filter((p) => p.value !== 'none'), onChange: (v) => this.setOption('fill', v) });
      bar.number({ label: 'Weight', min: 1, max: 500, value: o.weight, unit: 'px', onInput: (v) => this.setOption('weight', v) });
      return;
    }
    bar.select({ label: 'Fill', value: o.fill, options: PAINT, onChange: (v) => this.setOption('fill', v) });
    bar.select({ label: 'Stroke', value: o.stroke, options: PAINT, onChange: (v) => this.setOption('stroke', v) });
    bar.number({ label: 'Width', min: 0, max: 200, value: o.strokeWidth, unit: 'px', onInput: (v) => this.setOption('strokeWidth', v) });
    if (this.kind === 'rect') {
      bar.number({ label: 'Corner radius', min: 0, max: 1000, value: o.radius, unit: 'px', onInput: (v) => this.setOption('radius', v) });
    }
    if (this.kind === 'polygon') {
      bar.number({ label: 'Sides', min: 3, max: 100, value: o.sides, onInput: (v) => this.setOption('sides', v) });
    }
  }
}
