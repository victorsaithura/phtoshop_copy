import { createCanvas, rectUnion } from './utils.js';

/**
 * Draws the active document into the workspace canvas: checkerboard,
 * flattened layers, pixel grid, selection outline and tool overlays.
 */
export class Renderer {
  constructor(app, canvas) {
    this.app = app;
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.composite = createCanvas(1, 1);
    this.compositeDirty = true;
    this.fullDirty = true;
    this.dirtyRect = null;
    this.frame = 0;
    this.ants = 0;
    this.dpr = 1;
    this.pattern = null;
    this.workspaceColor =
      getComputedStyle(document.documentElement).getPropertyValue('--bg-workspace').trim() || '#1f1f1f';

    this.resize();
    new ResizeObserver(() => this.resize()).observe(canvas.parentElement);

    // Marching ants.
    setInterval(() => {
      const doc = app.doc;
      if (doc && !doc.selection.isEmpty()) {
        this.ants = (this.ants + 1) % 8;
        this.request(false);
      }
    }, 110);
  }

  resize() {
    const parent = this.canvas.parentElement;
    const w = parent.clientWidth;
    const h = parent.clientHeight;
    this.dpr = window.devicePixelRatio || 1;
    this.canvas.width = Math.max(1, Math.round(w * this.dpr));
    this.canvas.height = Math.max(1, Math.round(h * this.dpr));
    this.pattern = null;
    this.app.view.resize(w, h);
    this.render();
    this.app.emit('view');
  }

  /**
   * Schedule a redraw. composite=false redraws overlays only; `rect`
   * (document coordinates) limits recompositing to the area that changed.
   */
  request(composite = true, rect = null) {
    if (composite) {
      if (rect) this.dirtyRect = rectUnion(this.dirtyRect, rect);
      else this.fullDirty = true;
      this.compositeDirty = true;
    }
    if (this.frame) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = 0;
      this.render();
    });
  }

  /** The flattened document as currently displayed (includes live previews). */
  getComposite() {
    if (this.compositeDirty) this._recomposite();
    return this.composite;
  }

  _recomposite() {
    const doc = this.app.doc;
    if (!doc) return;
    const { tool, preview } = this.app;
    // Live previews: an adjustment dialog's result, or the active tool's work in progress.
    const override = (layer, rect) =>
      (preview && preview.layer === layer ? preview : null) || (tool?.layerOverride ? tool.layerOverride(layer, rect) : null);
    doc.composite(this.composite, override, this.fullDirty ? null : this.dirtyRect);
    this.compositeDirty = false;
    this.fullDirty = false;
    this.dirtyRect = null;
  }

  _checker(x, y) {
    if (!this.pattern) {
      const s = Math.round(8 * this.dpr);
      const c = createCanvas(s * 2, s * 2);
      const g = c.getContext('2d');
      g.fillStyle = '#ffffff';
      g.fillRect(0, 0, s * 2, s * 2);
      g.fillStyle = '#cccccc';
      g.fillRect(s, 0, s, s);
      g.fillRect(0, s, s, s);
      this.pattern = this.ctx.createPattern(c, 'repeat');
    }
    if (this.pattern.setTransform) {
      this.pattern.setTransform(new DOMMatrix().translate(x, y).scale(1 / this.dpr));
    }
    return this.pattern;
  }

  render() {
    const { ctx, canvas, app } = this;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = this.workspaceColor;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    const doc = app.doc;
    if (!doc) return;
    if (this.compositeDirty) this._recomposite();

    const v = app.view;
    const z = v.zoom;
    const x = v.panX;
    const y = v.panY;
    const w = doc.width * z;
    const h = doc.height * z;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);

    // Drop shadow under the canvas.
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.55)';
    ctx.shadowBlur = 14;
    ctx.shadowOffsetY = 2;
    ctx.fillStyle = '#808080';
    ctx.fillRect(x, y, w, h);
    ctx.restore();

    ctx.save();
    ctx.beginPath();
    ctx.rect(x, y, w, h);
    ctx.clip();
    ctx.fillStyle = this._checker(x, y);
    ctx.fillRect(x, y, w, h);

    // Only draw the part of the document that is on screen.
    const vx0 = Math.max(0, Math.floor(-x / z));
    const vy0 = Math.max(0, Math.floor(-y / z));
    const vx1 = Math.min(doc.width, Math.ceil((v.width - x) / z));
    const vy1 = Math.min(doc.height, Math.ceil((v.height - y) / z));
    if (vx1 > vx0 && vy1 > vy0) {
      ctx.imageSmoothingEnabled = z < 1;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(
        this.composite,
        vx0, vy0, vx1 - vx0, vy1 - vy0,
        x + vx0 * z, y + vy0 * z, (vx1 - vx0) * z, (vy1 - vy0) * z,
      );
      if (z >= 8) this._pixelGrid(x, y, z, vx0, vy0, vx1, vy1);
    }
    ctx.restore();

    this._drawSelection(doc, v);
    if (app.tool && app.tool.drawOverlay) {
      ctx.save();
      app.tool.drawOverlay(ctx, v);
      ctx.restore();
    }
  }

  _pixelGrid(x, y, z, vx0, vy0, vx1, vy1) {
    const ctx = this.ctx;
    const px = 1 / this.dpr;
    ctx.beginPath();
    for (let i = vx0; i <= vx1; i++) {
      const sx = Math.round((x + i * z) * this.dpr) / this.dpr + px / 2;
      ctx.moveTo(sx, y + vy0 * z);
      ctx.lineTo(sx, y + vy1 * z);
    }
    for (let j = vy0; j <= vy1; j++) {
      const sy = Math.round((y + j * z) * this.dpr) / this.dpr + px / 2;
      ctx.moveTo(x + vx0 * z, sy);
      ctx.lineTo(x + vx1 * z, sy);
    }
    ctx.lineWidth = px;
    ctx.strokeStyle = 'rgba(128,128,128,0.35)';
    ctx.stroke();
  }

  _drawSelection(doc, v) {
    const sel = doc.selection;
    if (sel.isEmpty() || !sel.path) return;
    const off = this.app.selectionOffset || { x: 0, y: 0 };
    const ctx = this.ctx;
    ctx.save();
    ctx.translate(v.panX + off.x * v.zoom, v.panY + off.y * v.zoom);
    ctx.scale(v.zoom, v.zoom);
    ctx.lineWidth = 1 / v.zoom;
    ctx.strokeStyle = '#ffffff';
    ctx.stroke(sel.path);
    ctx.setLineDash([4 / v.zoom, 4 / v.zoom]);
    ctx.lineDashOffset = -this.ants / v.zoom;
    ctx.strokeStyle = '#000000';
    ctx.stroke(sel.path);
    ctx.restore();
  }
}
