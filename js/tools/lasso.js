import { Tool, strokeOutline } from './tool.js';
import { SELECTION_MODES, selectionMode } from './marquee.js';
import { createCanvas } from '../core/utils.js';
import { floodMask } from './bucket.js';

/** Bounding box of a list of [x, y] points, padded by one pixel. */
function pointsBounds(points) {
  const xs = points.map((p) => p[0]);
  const ys = points.map((p) => p[1]);
  const x = Math.floor(Math.min(...xs)) - 1;
  const y = Math.floor(Math.min(...ys)) - 1;
  return { x, y, w: Math.ceil(Math.max(...xs)) + 2 - x, h: Math.ceil(Math.max(...ys)) + 2 - y };
}

/** Apply a closed polygon to the selection as one undoable step. */
function selectPolygon(app, points, mode, feather, label) {
  const sel = app.doc.selection;
  app.transact(label, { selection: true }, () => {
    sel.combine((ctx) => {
      ctx.beginPath();
      points.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
      ctx.closePath();
      ctx.fill();
    }, mode, feather, pointsBounds(points));
  });
}

function deselectOnClick(app, mode) {
  const sel = app.doc.selection;
  if (mode === 'new' && !sel.isEmpty()) app.transact('Deselect', { selection: true }, () => sel.clear());
}

function selectionOptions(tool, bar) {
  bar.segmented({ value: tool.options.mode, options: SELECTION_MODES, onChange: (v) => tool.setOption('mode', v) });
  bar.sep();
  bar.number({ label: 'Feather', min: 0, max: 250, value: tool.options.feather, unit: 'px',
    onInput: (v) => tool.setOption('feather', v) });
}

function drawPolyline(ctx, view, points, closing) {
  if (!points.length) return;
  strokeOutline(ctx, (c) => {
    points.forEach(([x, y], i) => {
      const p = view.docToScreen(x, y);
      if (i) c.lineTo(p.x, p.y);
      else c.moveTo(p.x, p.y);
    });
    if (closing) {
      const p = view.docToScreen(...closing);
      c.lineTo(p.x, p.y);
    }
  }, true);
}

/** Lasso: drag a freehand outline; releasing closes it. */
export class LassoTool extends Tool {
  constructor(app) {
    super(app, { id: 'lasso', name: 'Lasso Tool', key: 'L', cursor: 'crosshair' });
    this.options = { mode: 'new', feather: 0 };
    this.wantsCoalesced = true;
    this.points = null;
  }

  onPointerDown(e) {
    this.mode = selectionMode(this.options, e);
    this.points = [[e.x, e.y]];
  }

  onPointerMove(e) {
    if (!this.points) return;
    const [lx, ly] = this.points[this.points.length - 1];
    if (Math.hypot(e.x - lx, e.y - ly) * this.app.view.zoom >= 1.5) this.points.push([e.x, e.y]);
  }

  onPointerUp() {
    const points = this.points;
    this.points = null;
    if (!points) return;
    const b = pointsBounds(points);
    if (points.length < 3 || b.w < 3 || b.h < 3) deselectOnClick(this.app, this.mode);
    else selectPolygon(this.app, points, this.mode, this.options.feather, 'Lasso');
    this.app.renderer.request(false);
  }

  cancel() {
    this.points = null;
    this.app.renderer.request(false);
  }

  drawOverlay(ctx, view) {
    if (this.points) drawPolyline(ctx, view, this.points, this.points[0]);
  }

  buildOptions(bar) {
    selectionOptions(this, bar);
  }
}

/**
 * Polygonal Lasso: click to add corners. Close by clicking the first point,
 * double-clicking or pressing Enter; Backspace removes the last corner; Esc cancels.
 * Shift keeps the next edge at 45° steps.
 */
export class PolygonLassoTool extends Tool {
  constructor(app) {
    super(app, { id: 'polygon-lasso', name: 'Polygonal Lasso Tool', key: 'L', icon: 'polygon-lasso', cursor: 'crosshair' });
    this.options = { mode: 'new', feather: 0 };
    this.points = null;
    this.cursorPt = null;
    this.lastClick = 0;
  }

  _snap(e) {
    if (!e.shift || !this.points?.length) return [e.x, e.y];
    const [lx, ly] = this.points[this.points.length - 1];
    const step = Math.PI / 4;
    const angle = Math.round(Math.atan2(e.y - ly, e.x - lx) / step) * step;
    const len = Math.hypot(e.x - lx, e.y - ly);
    return [lx + Math.cos(angle) * len, ly + Math.sin(angle) * len];
  }

  onPointerDown(e) {
    const now = performance.now();
    const pt = this._snap(e);
    if (!this.points) {
      this.mode = selectionMode(this.options, e);
      this.points = [pt];
      this.lastClick = now;
      return;
    }
    const [fx, fy] = this.points[0];
    const [lx, ly] = this.points[this.points.length - 1];
    const zoom = this.app.view.zoom;
    const nearStart = Math.hypot(e.x - fx, e.y - fy) * zoom <= 7;
    // A double-click (second click on the same spot) also closes the shape.
    const doubleClick = now - this.lastClick < 300 && Math.hypot(e.x - lx, e.y - ly) * zoom <= 4;
    if (nearStart || doubleClick) {
      this.finish();
      return;
    }
    this.points.push(pt);
    this.lastClick = now;
  }

  onHover(e) {
    if (this.points) this.cursorPt = this._snap(e);
  }

  onPointerMove(e) {
    this.onHover(e);
  }

  finish() {
    const points = this.points;
    this.points = null;
    this.cursorPt = null;
    if (!points) return;
    const b = pointsBounds(points);
    if (points.length < 3 || b.w < 3 || b.h < 3) deselectOnClick(this.app, this.mode);
    else selectPolygon(this.app, points, this.mode, this.options.feather, 'Polygonal Lasso');
    this.app.renderer.request(false);
  }

  cancel() {
    this.points = null;
    this.cursorPt = null;
    this.app.renderer.request(false);
  }

  onDeactivate() {
    this.cancel();
  }

  onKeyDown(e) {
    if (!this.points) return false;
    if (e.key === 'Enter') {
      this.finish();
      return true;
    }
    if (e.key === 'Backspace' || e.key === 'Delete') {
      this.points.pop();
      if (!this.points.length) this.points = null;
      this.app.renderer.request(false);
      return true;
    }
    return false;
  }

  drawOverlay(ctx, view) {
    if (!this.points) return;
    drawPolyline(ctx, view, this.points, this.cursorPt);
    const p = view.docToScreen(...this.points[0]);
    strokeOutline(ctx, (c) => c.arc(p.x, p.y, 4, 0, Math.PI * 2));
  }

  buildOptions(bar) {
    selectionOptions(this, bar);
    bar.hint('Click to add corners · click the first corner, double-click or press Enter to close');
  }
}

/** Magic Wand: selects pixels similar in colour to the one clicked. */
export class MagicWandTool extends Tool {
  constructor(app) {
    super(app, { id: 'wand', name: 'Magic Wand Tool', key: 'W', cursor: 'crosshair' });
    this.options = { mode: 'new', tolerance: 32, contiguous: true, allLayers: false };
  }

  onPointerDown(e) {
    const doc = this.doc;
    const x = Math.floor(e.x);
    const y = Math.floor(e.y);
    const mode = selectionMode(this.options, e);
    if (x < 0 || y < 0 || x >= doc.width || y >= doc.height) {
      deselectOnClick(this.app, mode);
      return;
    }
    const W = doc.width;
    const H = doc.height;
    const src = createCanvas(W, H, { readFrequently: true });
    const sctx = src.getContext('2d', { willReadFrequently: true });
    const layer = doc.activeLayer;
    if (this.options.allLayers || !layer) doc.composite(src);
    else sctx.drawImage(layer.canvas, layer.x, layer.y);
    const { mask, bounds } = floodMask(sctx.getImageData(0, 0, W, H).data, W, H, x, y,
      this.options.tolerance, this.options.contiguous);
    if (!bounds) return;
    const img = new ImageData(bounds.w, bounds.h);
    for (let yy = 0; yy < bounds.h; yy++) {
      for (let xx = 0; xx < bounds.w; xx++) {
        const a = mask[(yy + bounds.y) * W + xx + bounds.x];
        if (!a) continue;
        const o = (yy * bounds.w + xx) * 4;
        img.data[o] = img.data[o + 1] = img.data[o + 2] = 255;
        img.data[o + 3] = a;
      }
    }
    this.app.transact('Magic Wand', { selection: true }, () => {
      doc.selection.combine((ctx) => ctx.putImageData(img, bounds.x, bounds.y), mode, 0, bounds);
    });
  }

  buildOptions(bar) {
    const o = this.options;
    bar.segmented({ value: o.mode, options: SELECTION_MODES, onChange: (v) => this.setOption('mode', v) });
    bar.sep();
    bar.number({ label: 'Tolerance', min: 0, max: 255, value: o.tolerance, onInput: (v) => this.setOption('tolerance', v) });
    bar.checkbox({ label: 'Contiguous', checked: o.contiguous, onChange: (v) => this.setOption('contiguous', v) });
    bar.checkbox({ label: 'Sample All Layers', checked: o.allLayers, onChange: (v) => this.setOption('allLayers', v) });
  }
}
