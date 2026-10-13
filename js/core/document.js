import { Layer } from './layer.js';
import { Selection } from './selection.js';
import { createCanvas, drawRegion, rectIntersect, rectRound } from './utils.js';

let untitledCounter = 1;
let docIdCounter = 1;

/** A document: an ordered stack of layers (index 0 = bottom) plus a selection. */
export class PSDocument {
  constructor({ width, height, name, background = '#ffffff' } = {}) {
    this.id = docIdCounter++;
    this.width = Math.round(width);
    this.height = Math.round(height);
    this.name = name || `Untitled-${untitledCounter++}`;
    this.layers = [];
    this.layerCounter = 0;
    this.selection = new Selection(this.width, this.height);

    if (background === 'transparent') {
      this.layers.push(new Layer({ name: this.nextLayerName(), width: this.width, height: this.height }));
    } else {
      const bg = new Layer({ name: 'Background', width: this.width, height: this.height });
      const ctx = bg.ctx;
      ctx.fillStyle = background;
      ctx.fillRect(0, 0, this.width, this.height);
      this.layers.push(bg);
    }
    this.activeId = this.layers[0].id;
  }

  /** New document whose background layer is the given image/canvas. */
  static fromImage(source, name) {
    const w = source.width;
    const h = source.height;
    const doc = new PSDocument({ width: w, height: h, name, background: 'transparent' });
    const layer = doc.layers[0];
    layer.name = 'Background';
    doc.layerCounter = 0;
    layer.ctx.drawImage(source, 0, 0);
    return doc;
  }

  get bounds() { return { x: 0, y: 0, w: this.width, h: this.height }; }
  get activeLayer() { return this.layers.find((l) => l.id === this.activeId) || null; }
  get activeIndex() { return this.layers.findIndex((l) => l.id === this.activeId); }

  nextLayerName() {
    this.layerCounter++;
    return `Layer ${this.layerCounter}`;
  }

  setActive(layer) {
    if (layer) this.activeId = layer.id;
  }

  /** Inserts above the active layer by default and makes it active. */
  addLayer(layer, index = this.activeIndex + 1) {
    this.layers.splice(Math.max(0, Math.min(index, this.layers.length)), 0, layer);
    this.activeId = layer.id;
    return layer;
  }

  newLayer(name = this.nextLayerName()) {
    return this.addLayer(new Layer({ name, width: this.width, height: this.height }));
  }

  removeLayer(layer) {
    const i = this.layers.indexOf(layer);
    if (i < 0) return;
    this.layers.splice(i, 1);
    if (this.activeId === layer.id) {
      const next = this.layers[Math.max(0, i - 1)] || this.layers[0];
      this.activeId = next ? next.id : null;
    }
  }

  moveLayer(layer, toIndex) {
    const from = this.layers.indexOf(layer);
    if (from < 0) return;
    this.layers.splice(from, 1);
    this.layers.splice(Math.max(0, Math.min(toIndex, this.layers.length)), 0, layer);
  }

  /** Topmost visible layer with a non-transparent pixel at (x, y). */
  layerAt(x, y) {
    for (let i = this.layers.length - 1; i >= 0; i--) {
      const l = this.layers[i];
      if (l.visible && l.opacity > 0 && l.alphaAt(x, y) > 0) return l;
    }
    return null;
  }

  /**
   * Flatten visible layers into `target` (document sized). With `rect`, only
   * that region is redrawn. override(layer, rect) may return { canvas, x, y }
   * to draw instead of the layer (live previews such as brush strokes).
   */
  composite(target = null, override = null, rect = null) {
    const c = target || createCanvas(this.width, this.height);
    if (c.width !== this.width || c.height !== this.height) {
      c.width = this.width;
      c.height = this.height;
      rect = null;
    }
    const r = rect ? rectIntersect(rectRound(rect), this.bounds) : this.bounds;
    if (!r) return c;
    const ctx = c.getContext('2d');
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    if (rect) {
      ctx.beginPath();
      ctx.rect(r.x, r.y, r.w, r.h);
      ctx.clip();
    }
    ctx.clearRect(r.x, r.y, r.w, r.h);
    for (const layer of this.layers) {
      if (!layer.visible || layer.opacity <= 0) continue;
      const src = (override && override(layer, rect ? r : null)) || layer;
      ctx.globalAlpha = layer.opacity;
      ctx.globalCompositeOperation = layer.blendMode;
      drawRegion(ctx, src.canvas, src.x, src.y, r);
    }
    ctx.restore();
    return c;
  }

  /* ---------- History support ---------- */

  /**
   * spec: { structure?: bool, selection?: bool, layers?: [Layer | { layer, rect }] }
   * Captures exactly what an operation may change so it can be undone.
   */
  capture(spec = {}) {
    const s = {};
    if (spec.structure) {
      s.structure = {
        layers: this.layers.slice(),
        activeId: this.activeId,
        width: this.width,
        height: this.height,
        props: this.layers.map((l) => ({
          layer: l, name: l.name, visible: l.visible, opacity: l.opacity,
          blendMode: l.blendMode, locked: l.locked,
        })),
      };
    }
    if (spec.layers) {
      s.pixels = spec.layers.map((item) => {
        const layer = item instanceof Layer ? item : item.layer;
        return { layer, snap: layer.snapshot(item instanceof Layer ? undefined : item.rect) };
      });
    }
    if (spec.selection) s.selection = this.selection.snapshot();
    return s;
  }

  restore(state) {
    if (state.structure) {
      const st = state.structure;
      this.layers = st.layers.slice();
      this.activeId = st.activeId;
      this.width = st.width;
      this.height = st.height;
      for (const p of st.props) {
        // Positions are deliberately not restored here: layers may have grown
        // since (which shifts x/y but not content). Moves record deltas instead.
        Object.assign(p.layer, {
          name: p.name, visible: p.visible, opacity: p.opacity,
          blendMode: p.blendMode, locked: p.locked,
        });
      }
    }
    if (state.pixels) for (const { layer, snap } of state.pixels) layer.restore(snap);
    if (state.selection) this.selection.restore(state.selection);
  }
}
