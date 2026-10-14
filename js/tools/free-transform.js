import { Tool, DoubleClick, strokeOutline } from './tool.js';
import { contentBounds, transformCanvasAt } from '../core/transform.js';
import { createCanvas } from '../core/utils.js';
import {
  squareToQuad, applyProjective, invertProjective, bilinearQuad, isParallelogram,
  identityGrid, isIdentityGrid, evalPatch, bernstein, styleGrid, meshWarp,
} from '../core/mesh-warp.js';

// Handles as [hx, hy]: −1/0/1 = left/centre/right, top/middle/bottom.
const HANDLES = {
  nw: [-1, -1], n: [0, -1], ne: [1, -1], e: [1, 0], se: [1, 1], s: [0, 1], sw: [-1, 1], w: [-1, 0],
};
const CURSORS = { nw: 'nwse-resize', se: 'nwse-resize', ne: 'nesw-resize', sw: 'nesw-resize', n: 'ns-resize', s: 'ns-resize', e: 'ew-resize', w: 'ew-resize' };
// The box is a quad of corners: top-left, top-right, bottom-right, bottom-left.
// Corner handles move one corner; side handles the two at the ends of their edge.
const CORNER = { nw: 0, ne: 1, se: 2, sw: 3 };
const SIDE = { n: [0, 1], s: [3, 2], w: [0, 3], e: [1, 2] };
// Warp grid corners and the tangent handles that travel with them.
const ANCHOR_HANDLES = { 0: [1, 4], 3: [2, 7], 12: [8, 13], 15: [11, 14] };

export const TRANSFORM_MODES = {
  free: 'Free Transform', skew: 'Skew', distort: 'Distort', perspective: 'Perspective', warp: 'Warp',
};
const WARP_STYLES = [
  ['custom', 'Custom'], ['arc', 'Arc'], ['arch', 'Arch'], ['bulge', 'Bulge'], ['flag', 'Flag'],
  ['wave', 'Wave'], ['rise', 'Rise'], ['squeeze', 'Squeeze'], ['inflate', 'Inflate'],
];
const PREVIEW_PIXELS = 500_000; // while dragging, mesh previews drop resolution beyond this size

const copyPts = (q) => q.map((p) => [p[0], p[1]]);
const add = (a, b) => [a[0] + b[0], a[1] + b[1]];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1]];
const mul = (a, k) => [a[0] * k, a[1] * k];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1];
const unit = (a) => mul(a, 1 / (Math.hypot(a[0], a[1]) || 1));
const centre = (q) => [(q[0][0] + q[1][0] + q[2][0] + q[3][0]) / 4, (q[0][1] + q[1][1] + q[2][1] + q[3][1]) / 4];
const normAngle = (a) => ((a % 360) + 540) % 360 - 180;
const samePts = (a, b) => a.every((p, i) => p[0] === b[i][0] && p[1] === b[i][1]);

function rotateAbout(p, c, rad) {
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const dx = p[0] - c[0];
  const dy = p[1] - c[1];
  return [c[0] + dx * cos - dy * sin, c[1] + dx * sin + dy * cos];
}

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
 * Free Transform (Edit ▸ Free Transform) and Edit ▸ Transform ▸ Skew,
 * Distort, Perspective and Warp. Free mode: drag a handle to scale
 * (proportional; Shift for free, Alt from the centre), inside to move,
 * outside to rotate (Shift snaps to 15°); Ctrl-drag a corner to distort,
 * Ctrl+Shift-drag a side to skew, Ctrl+Alt+Shift-drag a corner for
 * perspective. Warp bends the layer with a 4×4 Bézier grid: drag its points,
 * handles or anywhere on the mesh. Enter or double-click applies, Esc cancels.
 */
export class FreeTransformTool extends Tool {
  constructor(app) {
    super(app, { id: 'transform', name: 'Free Transform', icon: 'transform', cursor: 'default' });
    this.options = { smooth: true };
    this.t = null;
    this.drag = null;
    this.cache = null;
    this.clicks = new DoubleClick();
    // A transform belongs to its document; drop it if that document goes away.
    app.on('document', () => {
      if (this.t && !app.doc?.layers.includes(this.t.layer)) this.discard();
    });
  }

  /** Begin transforming the active layer; returns false if there is nothing to transform. */
  start(returnTo, mode = 'free') {
    if (this.app.doc?.activeLayer && !this.app.doc.activeLayer.isPixel) {
      this.app.toast('Free Transform works on pixel and type layers. Use Edit ▸ Transform to flip or rotate a group.');
      return false;
    }
    const layer = this.app.editableLayer(`${TRANSFORM_MODES[mode].toLowerCase()} command`, { allowMask: true });
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
    const quad = [[b.x, b.y], [b.x + b.w, b.y], [b.x + b.w, b.y + b.h], [b.x, b.y + b.h]];
    this.t = {
      layer, w: b.w, h: b.h, src, maskSrc, srcData: null, maskData: null, returnTo,
      quad, quad0: copyPts(quad), angle: 0, grid: null, style: 'custom', bend: 50, mode: 'free', startMode: mode,
    };
    this.cache = null;
    this.setMode(mode, false);
    return true;
  }

  /** Switch between Free Transform, Skew, Distort, Perspective and Warp. */
  setMode(mode, notify = true) {
    const t = this.t;
    if (!t || !TRANSFORM_MODES[mode]) return;
    if (mode === 'warp') {
      t.grid ||= identityGrid();
      if (!squareToQuad(t.quad)) this._rebase();
    }
    t.mode = mode;
    this._changed();
    if (notify) this.app.emit('tool-options', this);
  }

  /**
   * A warp needs a frame it can map back from. When the quad has folded or
   * gone concave, re-express the warp over its bounding rectangle instead.
   */
  _rebase() {
    const t = this.t;
    const pts = t.grid.map(([u, v]) => bilinearQuad(t.quad, u, v, [0, 0]));
    const xs = pts.map((p) => p[0]);
    const ys = pts.map((p) => p[1]);
    const x0 = Math.min(...xs);
    const y0 = Math.min(...ys);
    const w = Math.max(1, Math.max(...xs) - x0);
    const h = Math.max(1, Math.max(...ys) - y0);
    t.quad = [[x0, y0], [x0 + w, y0], [x0 + w, y0 + h], [x0, y0 + h]];
    t.grid = pts.map(([x, y]) => [(x - x0) / w, (y - y0) / h]);
    t.angle = 0;
  }

  /** Document position of a point of the unit square under the current quad. */
  _toDoc(u, v, out, H = squareToQuad(this.t.quad)) {
    return H ? applyProjective(H, u, v, out) : bilinearQuad(this.t.quad, u, v, out);
  }

  /** Document position of the warped surface at (s, t) in the unit square. */
  _surfacePoint(s, tt, out, H = squareToQuad(this.t.quad)) {
    const g = this.t.grid;
    if (g) {
      evalPatch(g, s, tt, out);
      return this._toDoc(out[0], out[1], out, H);
    }
    return this._toDoc(s, tt, out, H);
  }

  /** The warp grid's 16 points in document space. */
  _gridDoc() {
    const H = squareToQuad(this.t.quad);
    return this.t.grid.map(([u, v]) => this._toDoc(u, v, [0, 0], H));
  }

  /** Document point of a handle (hx, hy in −1…1; 0, 0 = centre). */
  point(hx, hy, q = this.t.quad) {
    if (hx && hy) return [...q[CORNER[(hy < 0 ? 'n' : 's') + (hx < 0 ? 'w' : 'e')]]];
    if (!hx && !hy) return centre(q);
    const [a, b] = SIDE[hx ? (hx < 0 ? 'w' : 'e') : hy < 0 ? 'n' : 's'];
    return [(q[a][0] + q[b][0]) / 2, (q[a][1] + q[b][1]) / 2];
  }

  /** Width and height as fractions of the original, along the box's edges. */
  _size() {
    const q = this.t.quad;
    return [Math.hypot(...sub(q[1], q[0])) / this.t.w, Math.hypot(...sub(q[3], q[0])) / this.t.h];
  }

  _affine() {
    const t = this.t;
    const [p0, p1, , p3] = t.quad;
    return new DOMMatrix([(p1[0] - p0[0]) / t.w, (p1[1] - p0[1]) / t.w, (p3[0] - p0[0]) / t.h, (p3[1] - p0[1]) / t.h, p0[0], p0[1]]);
  }

  _render() {
    const full = !this.drag;
    if (this.cache && (this.cache.full || !full)) return this.cache;
    const t = this.t;
    let out;
    if (isParallelogram(t.quad) && isIdentityGrid(t.grid)) {
      // Scale, rotate and skew are affine: let the canvas draw them.
      const m = this._affine();
      out = transformCanvasAt(t.src, 0, 0, m, this.options.smooth);
      if (t.maskSrc) {
        const mk = transformCanvasAt(t.maskSrc, 0, 0, m, this.options.smooth);
        out.mask = t.layer.mask.enabled ? mk : null;
        out.maskFull = mk;
      }
      out.full = true;
    } else {
      out = this._meshRender(full);
      out.full = full;
    }
    this.cache = out;
    return out;
  }

  /** Perspective and warp: draw through a triangle mesh (reduced resolution while dragging). */
  _meshRender(full) {
    const t = this.t;
    const doc = this.app.doc;
    t.srcData ||= t.src.getContext('2d').getImageData(0, 0, t.w, t.h);
    if (t.maskSrc) t.maskData ||= t.maskSrc.getContext('2d').getImageData(0, 0, t.w, t.h);
    const H = squareToQuad(t.quad);
    const grid = isIdentityGrid(t.grid) ? null : t.grid;
    const uv = [0, 0];
    const map = (sx, sy, out) => {
      let u = sx / t.w;
      let v = sy / t.h;
      if (grid) {
        evalPatch(grid, u, v, uv);
        [u, v] = uv;
      }
      return H ? applyProjective(H, u, v, out) : bilinearQuad(t.quad, u, v, out);
    };
    // Keep pixels off the canvas, within reason.
    const pad = Math.max(doc.width, doc.height);
    const limit = { x: -pad, y: -pad, w: doc.width + 2 * pad, h: doc.height + 2 * pad };
    let scale = 1;
    if (!full) {
      const xs = t.quad.map((p) => p[0]);
      const ys = t.quad.map((p) => p[1]);
      const area = (Math.max(...xs) - Math.min(...xs)) * (Math.max(...ys) - Math.min(...ys));
      scale = Math.min(1, Math.sqrt(PREVIEW_PIXELS / Math.max(1, area)));
    }
    const opts = { smooth: this.options.smooth, scale, limit, maxSamples: full ? 4 : 1 };
    const place = (res) => {
      if (!res) return { canvas: createCanvas(1, 1), x: 0, y: 0 };
      const c = createCanvas(res.image.width, res.image.height);
      c.getContext('2d').putImageData(res.image, 0, 0);
      if (scale === 1) return { canvas: c, x: res.x, y: res.y };
      const x = Math.floor(res.x / scale);
      const y = Math.floor(res.y / scale);
      const big = createCanvas(Math.ceil((res.x + c.width) / scale) - x, Math.ceil((res.y + c.height) / scale) - y);
      const g = big.getContext('2d');
      g.imageSmoothingQuality = 'high';
      g.drawImage(c, res.x / scale - x, res.y / scale - y, c.width / scale, c.height / scale);
      return { canvas: big, x, y };
    };
    const out = place(meshWarp(t.srcData, map, opts));
    if (t.maskData) {
      const mk = place(meshWarp(t.maskData, map, opts));
      out.mask = t.layer.mask.enabled ? mk : null;
      out.maskFull = mk;
    }
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

  /** Where on the warped surface (s, t in the unit square) a document point lies, or null. */
  _locate(x, y) {
    const N = 24;
    const H = squareToQuad(this.t.quad);
    const pts = [];
    for (let j = 0; j <= N; j++) for (let i = 0; i <= N; i++) pts.push(this._surfacePoint(i / N, j / N, [0, 0], H));
    const inTri = (a, b, c, sa, sb, sc) => {
      const d = (b[1] - c[1]) * (a[0] - c[0]) + (c[0] - b[0]) * (a[1] - c[1]);
      if (Math.abs(d) < 1e-12) return null;
      const l1 = ((b[1] - c[1]) * (x - c[0]) + (c[0] - b[0]) * (y - c[1])) / d;
      const l2 = ((c[1] - a[1]) * (x - c[0]) + (a[0] - c[0]) * (y - c[1])) / d;
      const l3 = 1 - l1 - l2;
      if (l1 < -1e-9 || l2 < -1e-9 || l3 < -1e-9) return null;
      return { s: l1 * sa[0] + l2 * sb[0] + l3 * sc[0], t: l1 * sa[1] + l2 * sb[1] + l3 * sc[1] };
    };
    for (let j = 0; j < N; j++) {
      for (let i = 0; i < N; i++) {
        const k = j * (N + 1) + i;
        const s00 = [i / N, j / N], s10 = [(i + 1) / N, j / N], s01 = [i / N, (j + 1) / N], s11 = [(i + 1) / N, (j + 1) / N];
        const hit = inTri(pts[k], pts[k + 1], pts[k + N + 2], s00, s10, s11)
          || inTri(pts[k], pts[k + N + 2], pts[k + N + 1], s00, s11, s01);
        if (hit) return hit;
      }
    }
    return null;
  }

  _hit(e) {
    const t = this.t;
    const v = this.app.view;
    const near = (p) => {
      const s = v.docToScreen(p[0], p[1]);
      return Math.max(Math.abs(e.sx - s.x), Math.abs(e.sy - s.y));
    };
    if (t.mode === 'warp') {
      let best = null;
      let bestD = 8;
      this._gridDoc().forEach((p, index) => {
        const d = near(p);
        if (d <= bestD) {
          bestD = d;
          best = { kind: 'point', index };
        }
      });
      if (best) return best;
      const st = this._locate(e.x, e.y);
      return st ? { kind: 'surface', ...st } : null;
    }
    for (const [name, [hx, hy]] of Object.entries(HANDLES)) {
      if (near(this.point(hx, hy)) <= 8) return { kind: 'handle', name };
    }
    return insidePolygon(t.quad, e.x, e.y) ? { kind: 'move' } : { kind: 'rotate' };
  }

  /** What dragging a hit does, given the mode and Photoshop's modifier shortcuts. */
  _op(hit, e) {
    if (hit.kind !== 'handle') return hit.kind;
    const corner = hit.name.length === 2;
    let mode = this.t.mode;
    if (mode === 'free' && e.ctrl) {
      if (corner) mode = e.alt && e.shift ? 'perspective' : 'distort';
      else mode = e.shift ? 'skew' : 'distort';
    }
    if (mode === 'free') return 'scale';
    if (mode === 'perspective' && !corner) return 'skew';
    return mode;
  }

  onHover(e) {
    if (!this.t) return;
    const hit = this._hit(e);
    let c = 'default';
    if (hit?.kind === 'move' || hit?.kind === 'point') c = 'move';
    else if (hit?.kind === 'rotate') c = 'crosshair';
    else if (hit?.kind === 'surface') c = 'grab';
    else if (hit?.kind === 'handle') c = this._op(hit, e) === 'scale' ? CURSORS[hit.name] : 'default';
    if (c !== this.cursor) {
      this.cursor = c;
      this.app.updateCursor();
    }
  }

  onPointerDown(e) {
    const t = this.t;
    if (!t) return;
    const hit = this._hit(e);
    if (this.clicks.down(e) && (hit?.kind === 'move' || hit?.kind === 'surface')) {
      this.commit();
      return;
    }
    if (!hit) return;
    const d = {
      hit, op: this._op(hit, e), x: e.x, y: e.y,
      quad0: copyPts(t.quad), angle0: t.angle, grid0: t.grid ? copyPts(t.grid) : null,
    };
    if (d.op === 'scale') {
      const [hx, hy] = HANDLES[hit.name];
      d.fixed = e.alt ? centre(t.quad) : this.point(-hx, -hy);
    } else if (d.op === 'point' || d.op === 'surface') {
      const H = squareToQuad(t.quad);
      d.inv = H && invertProjective(H);
      if (!d.inv) return;
      d.docPts = this._gridDoc();
      if (d.op === 'surface') {
        const bu = bernstein(hit.s, [0, 0, 0, 0]);
        const bv = bernstein(hit.t, [0, 0, 0, 0]);
        // The corners stay pinned; everything else bends to follow the pointer.
        d.weights = t.grid.map((_, k) => (ANCHOR_HANDLES[k] ? 0 : bu[k % 4] * bv[Math.floor(k / 4)]));
        d.sumW2 = d.weights.reduce((s, w) => s + w * w, 0);
        d.p0 = applyProjective(d.inv, e.x, e.y, [0, 0]);
      }
    }
    this.drag = d;
  }

  onPointerMove(e) {
    const d = this.drag;
    if (!d) return;
    this.clicks.move(e);
    const t = this.t;
    const q0 = d.quad0;
    const D = [e.x - d.x, e.y - d.y];
    const name = d.hit.name;
    switch (d.op) {
      case 'move': {
        const xs = q0.map((p) => p[0] + D[0]);
        const ys = q0.map((p) => p[1] + D[1]);
        const x = Math.min(...xs);
        const y = Math.min(...ys);
        const snap = this.app.snapRect({ x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y });
        t.quad = q0.map((p) => [p[0] + D[0] + snap.dx, p[1] + D[1] + snap.dy]);
        break;
      }
      case 'rotate': {
        const c = centre(q0);
        const a0 = Math.atan2(d.y - c[1], d.x - c[0]);
        const a1 = Math.atan2(e.y - c[1], e.x - c[0]);
        let angle = d.angle0 + ((a1 - a0) * 180) / Math.PI;
        if (e.shift) angle = Math.round(angle / 15) * 15;
        t.angle = normAngle(angle);
        t.quad = q0.map((p) => rotateAbout(p, c, ((angle - d.angle0) * Math.PI) / 180));
        break;
      }
      case 'scale':
        this._scale(d, e);
        break;
      case 'distort': {
        const moved = CORNER[name] !== undefined ? [CORNER[name]] : SIDE[name];
        t.quad = q0.map((p, i) => (moved.includes(i) ? add(p, D) : [...p]));
        break;
      }
      case 'skew': {
        if (SIDE[name]) {
          // The edge slides along itself.
          const [a, b] = SIDE[name];
          const dir = unit(sub(q0[b], q0[a]));
          const off = mul(dir, dot(D, dir));
          t.quad = q0.map((p, i) => (i === a || i === b ? add(p, off) : [...p]));
        } else {
          // A corner slides along whichever of its edges the drag follows more.
          const i = CORNER[name];
          const e1 = unit(sub(q0[(i + 1) % 4], q0[i]));
          const e2 = unit(sub(q0[(i + 3) % 4], q0[i]));
          const s1 = dot(D, e1);
          const s2 = dot(D, e2);
          const off = Math.abs(s1) >= Math.abs(s2) ? mul(e1, s1) : mul(e2, s2);
          t.quad = q0.map((p, k) => (k === i ? add(p, off) : [...p]));
        }
        break;
      }
      case 'perspective': {
        // The corner slides along an edge and the corner at the other end mirrors it.
        const i = CORNER[name];
        const across = [1, 0, 3, 2][i];
        const down = [3, 2, 1, 0][i];
        const eh = unit(sub(q0[across], q0[i]));
        const ev = unit(sub(q0[down], q0[i]));
        const sh = dot(D, eh);
        const sv = dot(D, ev);
        const [j, off] = Math.abs(sh) >= Math.abs(sv) ? [across, mul(eh, sh)] : [down, mul(ev, sv)];
        t.quad = q0.map((p, k) => (k === i ? add(p, off) : k === j ? sub(p, off) : [...p]));
        break;
      }
      case 'point': {
        const k = d.hit.index;
        const grid = copyPts(d.grid0);
        for (const n of [k, ...(ANCHOR_HANDLES[k] || [])]) {
          const p = d.docPts[n];
          grid[n] = applyProjective(d.inv, p[0] + D[0], p[1] + D[1], [0, 0]);
        }
        t.grid = grid;
        t.style = 'custom';
        break;
      }
      case 'surface': {
        // Move the grid as little as possible so the grabbed spot follows the pointer.
        const p1 = applyProjective(d.inv, e.x, e.y, [0, 0]);
        const dx = (p1[0] - d.p0[0]) / d.sumW2;
        const dy = (p1[1] - d.p0[1]) / d.sumW2;
        t.grid = d.grid0.map((p, k) => [p[0] + d.weights[k] * dx, p[1] + d.weights[k] * dy]);
        t.style = 'custom';
        break;
      }
      default:
        return;
    }
    this._changed();
  }

  /** Scale every corner about the fixed point along the box's own axes. */
  _scale(d, e) {
    const t = this.t;
    const [hx, hy] = HANDLES[d.hit.name];
    const F = d.fixed;
    const rad = (d.angle0 * Math.PI) / 180;
    const cos = Math.cos(rad);
    const sin = Math.sin(rad);
    const local = (p) => {
      const dx = p[0] - F[0];
      const dy = p[1] - F[1];
      return [dx * cos + dy * sin, -dx * sin + dy * cos];
    };
    const v = local([e.x, e.y]);
    const v0 = local(this.point(hx, hy, d.quad0));
    let kx = hx && Math.abs(v0[0]) > 1e-9 ? v[0] / v0[0] : 1;
    let ky = hy && Math.abs(v0[1]) > 1e-9 ? v[1] / v0[1] : 1;
    if (hx && hy && !e.shift) {
      // Corner handles keep the proportions unless Shift is held.
      const f = Math.max(Math.abs(kx), Math.abs(ky));
      kx = Math.sign(kx || 1) * f;
      ky = Math.sign(ky || 1) * f;
    }
    // Never collapse below a pixel.
    if (hx && Math.abs(kx * v0[0]) < 1) kx = Math.sign(kx || 1) / Math.abs(v0[0]);
    if (hy && Math.abs(ky * v0[1]) < 1) ky = Math.sign(ky || 1) / Math.abs(v0[1]);
    t.quad = d.quad0.map((p) => {
      const [lx, ly] = local(p);
      const x = lx * kx;
      const y = ly * ky;
      return [F[0] + x * cos - y * sin, F[1] + x * sin + y * cos];
    });
  }

  onPointerUp() {
    if (!this.drag) return;
    this.drag = null;
    this._changed(); // full-resolution render now the drag is over
    this.app.emit('tool-options', this);
  }

  /** Apply the transform as one undoable step. */
  apply() {
    const t = this.t;
    if (!t) return;
    this.drag = null;
    const r = this._render();
    this.t = null;
    this.cache = null;
    const warped = !isIdentityGrid(t.grid);
    if ((samePts(t.quad, t.quad0) && !warped) || !this.doc?.layers.includes(t.layer)) {
      this.app.renderer.request(true);
      return;
    }
    const layer = t.layer;
    this.app.transact(warped ? 'Warp' : TRANSFORM_MODES[t.startMode], { layers: [layer] }, () => {
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
    const d = this.drag;
    if (!d) return;
    Object.assign(this.t, { quad: d.quad0, angle: d.angle0, grid: d.grid0 });
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

  /** Scale about the centre along one of the box's axes so that axis is `pct` % of the original. */
  _resize(axis, pct) {
    const t = this.t;
    const cur = this._size()[axis];
    if (!cur || !(pct > 0)) return;
    const k = pct / 100 / cur;
    const c = centre(t.quad);
    const rad = (t.angle * Math.PI) / 180;
    const ax = axis === 0 ? [Math.cos(rad), Math.sin(rad)] : [-Math.sin(rad), Math.cos(rad)];
    t.quad = t.quad.map((p) => add(p, mul(ax, dot(sub(p, c), ax) * (k - 1))));
    this._changed();
  }

  _rotateTo(angle) {
    const t = this.t;
    const c = centre(t.quad);
    t.quad = t.quad.map((p) => rotateAbout(p, c, ((angle - t.angle) * Math.PI) / 180));
    t.angle = angle;
    this._changed();
  }

  _setWarpStyle(style, bend = this.t.bend) {
    const t = this.t;
    t.style = style;
    t.bend = bend;
    if (style !== 'custom') t.grid = styleGrid(style, bend / 100);
    this._changed();
  }

  drawOverlay(ctx, view) {
    const t = this.t;
    if (!t) return;
    const H = squareToQuad(t.quad);
    const curve = (fn, dashed = false) => strokeOutline(ctx, (c) => {
      const o = [0, 0];
      for (let k = 0; k <= 32; k++) {
        fn(k / 32, o);
        const p = view.docToScreen(o[0], o[1]);
        if (k) c.lineTo(p.x, p.y);
        else c.moveTo(p.x, p.y);
      }
    }, dashed);
    const box = (p) => {
      ctx.fillRect(p.x - 4, p.y - 4, 8, 8);
      ctx.strokeRect(p.x - 4, p.y - 4, 8, 8);
    };
    if (t.mode === 'warp') {
      for (const f of [0, 1 / 3, 2 / 3, 1]) {
        curve((s, o) => this._surfacePoint(s, f, o, H));
        curve((s, o) => this._surfacePoint(f, s, o, H));
      }
      const pts = this._gridDoc().map((p) => view.docToScreen(p[0], p[1]));
      ctx.save();
      ctx.strokeStyle = 'rgba(0, 0, 0, 0.75)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (const [a, hs] of Object.entries(ANCHOR_HANDLES)) {
        for (const k of hs) {
          ctx.moveTo(pts[a].x, pts[a].y);
          ctx.lineTo(pts[k].x, pts[k].y);
        }
      }
      ctx.stroke();
      ctx.fillStyle = '#ffffff';
      ctx.strokeStyle = '#000000';
      pts.forEach((p, k) => {
        if (ANCHOR_HANDLES[k]) box(p);
        else {
          ctx.beginPath();
          ctx.arc(p.x, p.y, 3.5, 0, Math.PI * 2);
          ctx.fill();
          ctx.stroke();
        }
      });
      ctx.restore();
      return;
    }
    // A warp made earlier shows as a dashed outline inside the box.
    if (!isIdentityGrid(t.grid)) {
      curve((s, o) => this._surfacePoint(s, 0, o, H), true);
      curve((s, o) => this._surfacePoint(1, s, o, H), true);
      curve((s, o) => this._surfacePoint(1 - s, 1, o, H), true);
      curve((s, o) => this._surfacePoint(0, 1 - s, o, H), true);
    }
    const pts = t.quad.map((p) => view.docToScreen(p[0], p[1]));
    strokeOutline(ctx, (c) => {
      pts.forEach((p, i) => (i ? c.lineTo(p.x, p.y) : c.moveTo(p.x, p.y)));
      c.closePath();
    });
    ctx.fillStyle = '#ffffff';
    ctx.strokeStyle = '#000000';
    for (const [hx, hy] of Object.values(HANDLES)) box(view.docToScreen(...this.point(hx, hy)));
    const c = view.docToScreen(...centre(t.quad));
    strokeOutline(ctx, (g) => g.arc(c.x, c.y, 4, 0, Math.PI * 2));
  }

  hint() {
    const mode = this.t?.mode;
    if (mode === 'warp') return 'Drag the grid points, their handles or anywhere on the mesh to bend the layer. Enter applies, Esc cancels.';
    if (mode === 'skew') return 'Drag a side handle to slant the layer, or a corner to slide it along an edge. Enter applies, Esc cancels.';
    if (mode === 'distort') return 'Drag a corner or side handle anywhere. Enter applies, Esc cancels.';
    if (mode === 'perspective') return 'Drag a corner to pinch or widen that edge symmetrically. Enter applies, Esc cancels.';
    return null;
  }

  buildOptions(bar) {
    const t = this.t;
    if (!t) return;
    bar.select({ label: 'Mode', value: t.mode, title: 'Transform mode',
      options: Object.entries(TRANSFORM_MODES).map(([value, label]) => ({ value, label })),
      onChange: (v) => this.setMode(v) });
    if (t.mode === 'warp') {
      bar.select({ label: 'Warp', value: t.style, options: WARP_STYLES.map(([value, label]) => ({ value, label })),
        onChange: (v) => {
          this._setWarpStyle(v);
          this.app.emit('tool-options', this);
        } });
      if (t.style !== 'custom') {
        bar.number({ label: 'Bend', min: -100, max: 100, value: t.bend, unit: '%',
          onInput: (v) => this._setWarpStyle(t.style, v) });
      }
      bar.button({ label: 'Reset', title: 'Remove the warp',
        onClick: () => {
          t.grid = identityGrid();
          t.style = 'custom';
          this._changed();
          this.app.emit('tool-options', this);
        } });
    } else {
      const [w, h] = this._size();
      bar.number({ label: 'W', min: 1, max: 10000, value: Math.round(w * 1000) / 10, unit: '%',
        onInput: (v) => this._resize(0, v) });
      bar.number({ label: 'H', min: 1, max: 10000, value: Math.round(h * 1000) / 10, unit: '%',
        onInput: (v) => this._resize(1, v) });
      bar.number({ label: 'Angle', min: -180, max: 180, value: Math.round(t.angle * 10) / 10, unit: '°',
        onInput: (v) => this._rotateTo(v) });
    }
    bar.select({ label: 'Interpolation', value: this.options.smooth ? 'smooth' : 'nearest',
      options: [{ value: 'smooth', label: 'Bicubic' }, { value: 'nearest', label: 'Nearest Neighbor' }],
      onChange: (v) => { this.setOption('smooth', v === 'smooth'); this._changed(); } });
    bar.sep();
    bar.button({ label: 'Cancel', title: 'Cancel the transform (Esc)', onClick: () => this.discard() });
    bar.button({ label: '✓ Apply', title: 'Apply the transform (Enter)', className: 'btn btn-small btn-primary', onClick: () => this.commit() });
  }
}
