import { Tool } from './tool.js';
import { createCanvas, rectUnion } from '../core/utils.js';
import { contentBounds } from '../core/transform.js';

/**
 * Move Tool. Drags the active layer (a group moves with its contents), or the
 * selected pixels when there is a selection (Alt-drag moves a copy). Arrow
 * keys nudge by 1px (Shift: 10px).
 */
export class MoveTool extends Tool {
  constructor(app) {
    super(app, { id: 'move', name: 'Move Tool', key: 'V', cursor: 'move' });
    this.options = { autoSelect: false };
    this.drag = null;
    this.scratch = null;
  }

  onPointerDown(e) {
    const doc = this.doc;
    if (this.options.autoSelect || e.ctrl) {
      const hit = doc.layerAt(e.x, e.y);
      if (hit && hit !== doc.activeLayer) {
        doc.setActive(hit);
        this.app.emit('layers');
      }
    }
    const layer = this._target();
    if (!layer) return;
    this.drag = this._begin(layer, e.alt);
    this.drag.startX = e.x;
    this.drag.startY = e.y;
  }

  _target() {
    const whole = this.doc.selection.isEmpty();
    return this.app.editableLayer('move tool', { allowText: whole, allowMask: whole, allowGroup: whole });
  }

  _begin(layer, duplicate) {
    const sel = this.doc.selection;
    const items = layer.isGroup ? [layer, ...this.doc.descendants(layer)] : [layer];
    const d = { layer, items, orig: items.map((l) => [l.x, l.y]), dx: 0, dy: 0, float: null, duplicate, box: null };
    if (sel.isEmpty()) {
      // What snaps: the visible content of the moving layers.
      if (this.app.viewOptions.snap) {
        for (const l of items) if (l.isPixel) d.box = rectUnion(d.box, contentBounds(l));
      }
      return d;
    }
    d.box = { ...sel.bounds };

    // Lift the selected pixels into a floating canvas.
    const b = sel.bounds;
    const fl = createCanvas(b.w, b.h);
    const fctx = fl.getContext('2d');
    fctx.drawImage(layer.canvas, layer.x - b.x, layer.y - b.y);
    fctx.globalCompositeOperation = 'destination-in';
    fctx.drawImage(sel.mask, -b.x, -b.y);
    d.float = { canvas: fl, x: b.x, y: b.y, w: b.w, h: b.h };
    d.mask = sel.mask;

    // The layer with a hole where the pixels were lifted from.
    const hole = createCanvas(layer.width, layer.height);
    const hctx = hole.getContext('2d');
    hctx.drawImage(layer.canvas, 0, 0);
    if (!duplicate) {
      hctx.globalCompositeOperation = 'destination-out';
      hctx.drawImage(sel.mask, -layer.x, -layer.y);
    }
    d.hole = hole;
    return d;
  }

  onPointerMove(e) {
    const d = this.drag;
    if (!d) return;
    let dx = e.x - d.startX;
    let dy = e.y - d.startY;
    if (e.shift) {
      // Constrain to multiples of 45°.
      const step = Math.PI / 4;
      const angle = Math.round(Math.atan2(dy, dx) / step) * step;
      const len = Math.hypot(dx, dy);
      dx = Math.cos(angle) * len;
      dy = Math.sin(angle) * len;
    }
    this._setOffset(Math.round(dx), Math.round(dy), true);
  }

  _setOffset(dx, dy, snap = false) {
    const d = this.drag;
    if (snap && d.box) {
      const s = this.app.snapRect({ x: d.box.x + dx, y: d.box.y + dy, w: d.box.w, h: d.box.h });
      dx += Math.round(s.dx);
      dy += Math.round(s.dy);
    }
    d.dx = dx;
    d.dy = dy;
    if (d.float) this.app.selectionOffset = { x: dx, y: dy };
    else {
      d.items.forEach((l, i) => {
        l.x = d.orig[i][0] + dx;
        l.y = d.orig[i][1] + dy;
      });
    }
    this.app.renderer.request(true);
  }

  layerOverride(layer) {
    const d = this.drag;
    if (!d || !d.float || layer !== d.layer) return null;
    const f = d.float;
    const fr = { x: f.x + d.dx, y: f.y + d.dy, w: f.w, h: f.h };
    const u = rectUnion(layer.bounds, fr);
    if (!this.scratch || this.scratch.width !== u.w || this.scratch.height !== u.h) {
      this.scratch = createCanvas(u.w, u.h);
    }
    const s = this.scratch.getContext('2d');
    s.clearRect(0, 0, u.w, u.h);
    s.drawImage(d.hole, layer.x - u.x, layer.y - u.y);
    s.drawImage(f.canvas, fr.x - u.x, fr.y - u.y);
    return { canvas: this.scratch, x: u.x, y: u.y };
  }

  onPointerUp() {
    this._commit('Move');
  }

  _commit(label) {
    const d = this.drag;
    this.drag = null;
    this.app.selectionOffset = null;
    if (!d) return;
    const { layer, items, dx, dy } = d;
    if (!dx && !dy) {
      this.app.renderer.request(true);
      return;
    }
    if (!d.float) {
      // Recorded as a delta: layers can grow later without their content moving.
      const by = (k) => () => {
        for (const l of items) {
          l.x += k * dx;
          l.y += k * dy;
        }
      };
      this.app.record(label, by(-1), by(1), { layers: items });
      return;
    }
    const f = d.float;
    const dest = { x: f.x + dx, y: f.y + dy, w: f.w, h: f.h };
    const rect = rectUnion({ x: f.x, y: f.y, w: f.w, h: f.h }, dest);
    layer.ensureCovers(dest);
    this.app.transact(label, { layers: [{ layer, rect }], selection: true }, () => {
      const c = layer.ctx;
      if (!d.duplicate) {
        c.save();
        c.globalCompositeOperation = 'destination-out';
        c.drawImage(d.mask, -layer.x, -layer.y);
        c.restore();
      }
      c.drawImage(f.canvas, dest.x - layer.x, dest.y - layer.y);
      this.doc.selection.translate(dx, dy);
    });
  }

  cancel() {
    const d = this.drag;
    if (!d) return;
    if (!d.float) {
      d.items.forEach((l, i) => {
        l.x = d.orig[i][0];
        l.y = d.orig[i][1];
      });
    }
    this.drag = null;
    this.app.selectionOffset = null;
    this.app.renderer.request(true);
  }

  onKeyDown(e) {
    if (e.ctrlKey || e.metaKey || e.altKey) return false;
    const dirs = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
    const v = dirs[e.key];
    if (v) {
      if (this.drag) return true;
      const layer = this._target();
      if (!layer) return true;
      const step = e.shiftKey ? 10 : 1;
      this.drag = this._begin(layer, false);
      this._setOffset(v[0] * step, v[1] * step);
      this._commit('Nudge');
      return true;
    }
    // With the Move tool, number keys set the layer's opacity (as in Photoshop).
    if (/^Digit\d$/.test(e.code) && !e.shiftKey) {
      const layer = this.doc?.activeLayer;
      if (!layer) return true;
      const n = Number(e.code.slice(5));
      const value = n === 0 ? 1 : n / 10;
      const old = layer.opacity;
      if (old !== value) {
        layer.opacity = value;
        this.app.record('Layer Opacity', () => { layer.opacity = old; }, () => { layer.opacity = value; });
      }
      return true;
    }
    return false;
  }

  buildOptions(bar) {
    bar.checkbox({
      label: 'Auto-Select Layer',
      title: 'Click selects the topmost layer under the pointer (or hold Ctrl)',
      checked: this.options.autoSelect,
      onChange: (v) => this.setOption('autoSelect', v),
    });
    bar.hint('Alt-drag a selection to move a copy · Arrow keys nudge');
  }
}
