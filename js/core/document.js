import { Layer, PASS_THROUGH, copyJSON } from './layer.js';
import { Selection } from './selection.js';
import { applyAdjustmentLayer } from './adjustments.js';
import { hasStyles, drawStyledLayer } from './effects.js';
import { createCanvas, drawRegion, rectIntersect, rectRound } from './utils.js';

let untitledCounter = 1;
let docIdCounter = 1;

/** Whether `a` is a group that contains `b` (at any depth). */
export function isAncestor(a, b) {
  for (let p = b.parent; p; p = p.parent) if (p === a) return true;
  return false;
}

/** Number of groups a layer is nested in. */
export function depthOf(layer) {
  let n = 0;
  for (let p = layer.parent; p; p = p.parent) n++;
  return n;
}

/** Mask values (0–255) for a document rect from a mask placed at m.x, m.y; `outside` elsewhere. */
export function regionMaskValues(m, outside, r) {
  const out = new Uint8Array(r.w * r.h).fill(outside);
  const ir = rectIntersect(r, { x: m.x, y: m.y, w: m.canvas.width, h: m.canvas.height });
  if (!ir) return out;
  const d = m.canvas.getContext('2d', { willReadFrequently: true }).getImageData(ir.x - m.x, ir.y - m.y, ir.w, ir.h).data;
  for (let y = 0; y < ir.h; y++) {
    const row = (ir.y - r.y + y) * r.w + (ir.x - r.x);
    for (let x = 0; x < ir.w; x++) out[row + x] = d[(y * ir.w + x) * 4 + 3];
  }
  return out;
}

/** Copies of `layers` with new ids; parents inside the list point to the copies. */
export function cloneLayers(layers, rename = (l) => l.name) {
  const map = new Map(layers.map((l) => {
    const c = l.clone(rename(l));
    c.locked = l.locked;
    return [l, c];
  }));
  // Groups come after their contents in the list, so link parents once all copies exist.
  for (const c of map.values()) if (map.has(c.parent)) c.parent = map.get(c.parent);
  return [...map.values()];
}

/**
 * A document: an ordered list of layers (index 0 = bottom) plus a selection.
 * Groups are entries in the same list, placed directly above their contents.
 */
export class PSDocument {
  constructor({ width, height, name, background = '#ffffff' } = {}) {
    this.id = docIdCounter++;
    this.width = Math.round(width);
    this.height = Math.round(height);
    this.name = name || `Untitled-${untitledCounter++}`;
    this.layers = [];
    this.layerCounter = 0;
    this.groupCounter = 0;
    this.selection = new Selection(this.width, this.height);
    this.scratches = [];

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
  get pixelLayers() { return this.layers.filter((l) => l.isPixel); }

  nextLayerName() {
    this.layerCounter++;
    return `Layer ${this.layerCounter}`;
  }

  nextGroupName() {
    this.groupCounter++;
    return `Group ${this.groupCounter}`;
  }

  setActive(layer) {
    if (layer) this.activeId = layer.id;
  }

  /* ---------- Groups ---------- */

  /** [first, last] indices of a layer, including a group's contents. */
  span(layer) {
    const end = this.layers.indexOf(layer);
    let start = end;
    if (layer.isGroup) while (start > 0 && isAncestor(layer, this.layers[start - 1])) start--;
    return [start, end];
  }

  /** Everything inside a group, bottom first. */
  descendants(group) {
    const [s, e] = this.span(group);
    return this.layers.slice(s, e);
  }

  /** Direct contents of a group (null = the top level), bottom first. */
  childrenOf(parent) {
    return this.layers.filter((l) => l.parent === parent);
  }

  /** Visible, counting the groups it is in. */
  isVisible(layer) {
    for (let l = layer; l; l = l.parent) if (!l.visible) return false;
    return true;
  }

  /** Locked, counting the groups it is in. */
  isLocked(layer) {
    for (let l = layer; l; l = l.parent) if (l.locked) return true;
    return false;
  }

  /**
   * Inserts a layer and makes it active. By default it goes just above the
   * active layer (beside it), or at the top of the active group.
   */
  addLayer(layer, index = null, parent = null) {
    const active = this.activeLayer;
    if (index == null) {
      if (active?.isGroup) {
        index = this.layers.indexOf(active);
        parent = active;
      } else {
        index = active ? this.layers.indexOf(active) + 1 : this.layers.length;
        parent = active ? active.parent : null;
      }
    }
    layer.parent = parent;
    this.layers.splice(Math.max(0, Math.min(index, this.layers.length)), 0, layer);
    this.activeId = layer.id;
    return layer;
  }

  newLayer(name = this.nextLayerName()) {
    return this.addLayer(new Layer({ name, width: this.width, height: this.height }));
  }

  /** Removes a layer (a group goes with its contents). */
  removeLayer(layer) {
    if (this.layers.indexOf(layer) < 0) return;
    const [start, end] = this.span(layer);
    const removed = this.layers.splice(start, end - start + 1);
    if (removed.some((l) => l.id === this.activeId)) {
      const next = this.layers[Math.max(0, start - 1)] || this.layers[0];
      this.activeId = next ? next.id : null;
    }
  }

  /**
   * Move a layer (a group moves with its contents) next to `ref`:
   * 'above' or 'below' it, or 'into' it (top of a group). Returns false if impossible.
   */
  place(layer, ref, where) {
    if (!ref || ref === layer || isAncestor(layer, ref) || (where === 'into' && !ref.isGroup)) return false;
    const [s, e] = this.span(layer);
    const block = this.layers.splice(s, e - s + 1);
    let index;
    if (where === 'into') index = this.layers.indexOf(ref);
    else if (where === 'above') index = this.layers.indexOf(ref) + 1;
    else index = this.span(ref)[0];
    this.layers.splice(index, 0, ...block);
    layer.parent = where === 'into' ? ref : ref.parent;
    return true;
  }

  /** Bring forward (+1), send backward (-1), to front (+Infinity) or back (-Infinity) among its siblings. */
  arrange(layer, step) {
    const sibs = this.childrenOf(layer.parent);
    const i = sibs.indexOf(layer);
    const to = Math.max(0, Math.min(sibs.length - 1, i + step));
    if (to === i) return false;
    return this.place(layer, sibs[to], to > i ? 'above' : 'below');
  }

  /** Topmost visible pixel layer with a non-transparent pixel at (x, y). */
  layerAt(x, y) {
    for (let i = this.layers.length - 1; i >= 0; i--) {
      const l = this.layers[i];
      if (l.isPixel && l.opacity > 0 && this.isVisible(l) && l.alphaAt(x, y) > 0) return l;
    }
    return null;
  }

  /* ---------- Compositing ---------- */

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
    ctx.beginPath();
    ctx.rect(r.x, r.y, r.w, r.h);
    ctx.clip();
    ctx.clearRect(r.x, r.y, r.w, r.h);
    const job = { r, override, partial: !!rect, kids: this._childMap() };
    this._drawList(job, { ctx, ox: 0, oy: 0 }, job.kids.get(null) || [], 0);
    ctx.restore();
    return c;
  }

  /** A group's contents flattened on their own (group mask applied), document sized. */
  renderGroup(group) {
    const c = createCanvas(this.width, this.height);
    const ctx = c.getContext('2d');
    const r = this.bounds;
    const job = { r, override: null, partial: false, kids: this._childMap() };
    this._drawList(job, { ctx, ox: 0, oy: 0 }, job.kids.get(group) || [], 1);
    const mask = this._groupMask(group, null, r);
    if (mask) {
      ctx.globalCompositeOperation = 'destination-in';
      drawRegion(ctx, mask.canvas, mask.x, mask.y, r);
    }
    return c;
  }

  /** The image below a layer (what an adjustment layer at that position sees). */
  compositeBelow(layer) {
    const i = this.layers.indexOf(layer);
    const hidden = [];
    for (let j = i; j < this.layers.length; j++) {
      const l = this.layers[j];
      if (l.visible && !isAncestor(l, layer)) {
        l.visible = false;
        hidden.push(l);
      }
    }
    try {
      return this.composite();
    } finally {
      for (const l of hidden) l.visible = true;
    }
  }

  _childMap() {
    const map = new Map([[null, []]]);
    for (const l of this.layers) {
      const p = l.parent || null;
      if (!map.has(p)) map.set(p, []);
      map.get(p).push(l);
    }
    return map;
  }

  /** acc: { ctx (document coordinates), ox, oy (where the ctx canvas sits in the document) } */
  _drawList(job, acc, items, depth) {
    for (const layer of items) {
      if (!layer.visible || layer.opacity <= 0) continue;
      if (layer.isGroup) this._drawGroup(job, acc, layer, depth);
      else if (layer.isAdjustment) this._drawAdjustment(job, acc, layer);
      else this._drawLayer(job, acc, layer);
    }
  }

  _overrideFor(job, layer) {
    return (job.override && job.override(layer, job.partial ? job.r : null)) || layer;
  }

  _drawLayer(job, acc, layer) {
    const { r } = job;
    const ctx = acc.ctx;
    const src = this._overrideFor(job, layer);
    // A preview override may bring its own mask (live mask painting).
    const mask = src !== layer && src.mask !== undefined ? src.mask : layer.activeMask;
    if (hasStyles(layer)) {
      drawStyledLayer(this, ctx, layer, src, mask, r);
      return;
    }
    ctx.globalAlpha = layer.opacity;
    ctx.globalCompositeOperation = layer.blendMode;
    if (!mask) {
      drawRegion(ctx, src.canvas, src.x, src.y, r);
      return;
    }
    const s = this._scratch(r.w, r.h);
    const sc = s.getContext('2d');
    sc.save();
    sc.setTransform(1, 0, 0, 1, -r.x, -r.y);
    sc.globalCompositeOperation = 'copy';
    sc.clearRect(r.x, r.y, r.w, r.h);
    sc.globalCompositeOperation = 'source-over';
    drawRegion(sc, src.canvas, src.x, src.y, r);
    sc.globalCompositeOperation = 'destination-in';
    sc.beginPath();
    sc.rect(r.x, r.y, r.w, r.h);
    sc.clip();
    drawRegion(sc, mask.canvas, mask.x, mask.y, r);
    sc.restore();
    ctx.drawImage(s, 0, 0, r.w, r.h, r.x, r.y, r.w, r.h);
  }

  /** Mask placement for a group or adjustment layer, covering the region (null = none). */
  _groupMask(layer, src, r) {
    if (src && src !== layer && src.mask !== undefined) return src.mask;
    const m = layer.mask;
    if (!m || !m.enabled) return null;
    m.ensureCovers(layer, r);
    return { canvas: m.canvas, x: layer.x + m.ox, y: layer.y + m.oy };
  }

  _drawAdjustment(job, acc, layer) {
    const { r } = job;
    const src = this._overrideFor(job, layer);
    const mask = this._groupMask(layer, src, r);
    const weights = mask ? regionMaskValues(mask, layer.mask?.outside ?? 255, r) : null;
    const px = r.x - acc.ox;
    const py = r.y - acc.oy;
    const img = acc.ctx.getImageData(px, py, r.w, r.h);
    applyAdjustmentLayer(img, layer.adjustment, weights, layer.opacity, layer.blendMode);
    acc.ctx.putImageData(img, px, py);
  }

  _drawGroup(job, acc, group, depth) {
    const { r } = job;
    const kids = job.kids.get(group) || [];
    const src = this._overrideFor(job, group);
    const mask = this._groupMask(group, src, r);
    if (group.blendMode === PASS_THROUGH) {
      if (group.opacity >= 1 && !mask) {
        this._drawList(job, acc, kids, depth);
        return;
      }
      // Draw the contents straight onto what is below, then fade back by opacity × mask.
      const px = r.x - acc.ox;
      const py = r.y - acc.oy;
      const before = acc.ctx.getImageData(px, py, r.w, r.h);
      this._drawList(job, acc, kids, depth);
      const after = acc.ctx.getImageData(px, py, r.w, r.h);
      const k = mask ? regionMaskValues(mask, group.mask?.outside ?? 255, r) : null;
      const a = after.data;
      const b = before.data;
      const op = group.opacity;
      for (let p = 0, i = 0; i < a.length; p++, i += 4) {
        const w = k ? (op * k[p]) / 255 : op;
        if (w >= 1) continue;
        a[i] = b[i] + (a[i] - b[i]) * w;
        a[i + 1] = b[i + 1] + (a[i + 1] - b[i + 1]) * w;
        a[i + 2] = b[i + 2] + (a[i + 2] - b[i + 2]) * w;
        a[i + 3] = b[i + 3] + (a[i + 3] - b[i + 3]) * w;
      }
      acc.ctx.putImageData(after, px, py);
      return;
    }
    // Any other mode: flatten the contents on their own, then blend that like a layer.
    const s = this._groupScratch(depth, r.w, r.h);
    const sc = s.getContext('2d');
    sc.save();
    sc.setTransform(1, 0, 0, 1, 0, 0);
    sc.globalAlpha = 1;
    sc.globalCompositeOperation = 'source-over';
    sc.clearRect(0, 0, r.w, r.h);
    sc.setTransform(1, 0, 0, 1, -r.x, -r.y);
    sc.beginPath();
    sc.rect(r.x, r.y, r.w, r.h);
    sc.clip();
    this._drawList(job, { ctx: sc, ox: r.x, oy: r.y }, kids, depth + 1);
    if (mask) {
      sc.globalAlpha = 1;
      sc.globalCompositeOperation = 'destination-in';
      drawRegion(sc, mask.canvas, mask.x, mask.y, r);
    }
    sc.restore();
    acc.ctx.globalAlpha = group.opacity;
    acc.ctx.globalCompositeOperation = group.blendMode;
    acc.ctx.drawImage(s, 0, 0, r.w, r.h, r.x, r.y, r.w, r.h);
  }

  /** Reusable work canvas at least w × h. */
  _scratch(w, h) {
    if (!this.scratch || this.scratch.width < w || this.scratch.height < h) {
      this.scratch = createCanvas(Math.max(w, this.scratch?.width || 0), Math.max(h, this.scratch?.height || 0));
    }
    return this.scratch;
  }

  /** One work canvas per group nesting level. */
  _groupScratch(depth, w, h) {
    const cur = this.scratches[depth];
    if (!cur || cur.width < w || cur.height < h) {
      this.scratches[depth] = createCanvas(Math.max(w, cur?.width || 0), Math.max(h, cur?.height || 0));
    }
    return this.scratches[depth];
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
          blendMode: l.blendMode, locked: l.locked, parent: l.parent,
          adjustment: copyJSON(l.adjustment), styles: copyJSON(l.styles),
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
          blendMode: p.blendMode, locked: p.locked, parent: p.parent,
          adjustment: copyJSON(p.adjustment), styles: copyJSON(p.styles),
        });
      }
    }
    if (state.pixels) for (const { layer, snap } of state.pixels) layer.restore(snap);
    if (state.selection) this.selection.restore(state.selection);
  }
}
