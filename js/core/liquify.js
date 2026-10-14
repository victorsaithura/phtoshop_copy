/*
 * Liquify (Filter ▸ Liquify): a displacement field edited with brushes.
 * Each output point q shows the source colour at q + D(q). D lives on a
 * grid of nodes `step` pixels apart, read with bilinear interpolation; a
 * freeze mask on the same grid protects areas from change.
 */

/** Brush dab strengths per call, scaled by the Rate setting (0…1). */
const TWIRL_SPEED = 0.08; // radians
const PUCKER_SPEED = 0.04; // fraction of the distance to the centre
const RECONSTRUCT_SPEED = 0.15;
const SMOOTH_SPEED = 0.5;

export class LiquifyField {
  constructor(w, h, maxNodes = 400_000) {
    this.w = w;
    this.h = h;
    this.step = Math.max(1, Math.ceil(Math.sqrt((w * h) / maxNodes)));
    this.gw = Math.ceil(w / this.step) + 1;
    this.gh = Math.ceil(h / this.step) + 1;
    this.d = new Float32Array(this.gw * this.gh * 2);
    this.freeze = new Uint8Array(this.gw * this.gh);
  }

  isEmpty() {
    for (let i = 0; i < this.d.length; i++) if (this.d[i]) return false;
    return true;
  }

  snapshot() {
    return { d: this.d.slice(), freeze: this.freeze.slice() };
  }

  restore(s) {
    this.d.set(s.d);
    this.freeze.set(s.freeze);
  }

  /** Displacement at (x, y) in pixels, written to out. */
  sample(x, y, out) {
    const { step, gw, gh, d } = this;
    let gx = x / step;
    let gy = y / step;
    if (gx < 0) gx = 0;
    else if (gx > gw - 1) gx = gw - 1;
    if (gy < 0) gy = 0;
    else if (gy > gh - 1) gy = gh - 1;
    const i0 = Math.floor(gx);
    const j0 = Math.floor(gy);
    const tx = gx - i0;
    const ty = gy - j0;
    const a = (j0 * gw + i0) * 2;
    const b = i0 < gw - 1 ? a + 2 : a;
    const c = j0 < gh - 1 ? a + gw * 2 : a;
    const e = i0 < gw - 1 ? c + 2 : c;
    const w00 = (1 - tx) * (1 - ty), w10 = tx * (1 - ty), w01 = (1 - tx) * ty, w11 = tx * ty;
    out[0] = d[a] * w00 + d[b] * w10 + d[c] * w01 + d[e] * w11;
    out[1] = d[a + 1] * w00 + d[b + 1] * w10 + d[c + 1] * w01 + d[e + 1] * w11;
    return out;
  }

  /** Freeze amount (0…1) at (x, y). */
  frozenAt(x, y) {
    const { step, gw, gh } = this;
    const i = Math.min(gw - 1, Math.max(0, Math.round(x / step)));
    const j = Math.min(gh - 1, Math.max(0, Math.round(y / step)));
    return this.freeze[j * gw + i] / 255;
  }

  /**
   * Where source point (sx, sy) ends up after the warp (approximately: the
   * field is stored backwards, so iterate q = s − D(q)). Used to draw the mesh.
   */
  forward(sx, sy, out) {
    let qx = sx;
    let qy = sy;
    for (let k = 0; k < 4; k++) {
      this.sample(qx, qy, out);
      qx = sx - out[0];
      qy = sy - out[1];
    }
    out[0] = qx;
    out[1] = qy;
    return out;
  }

  /**
   * One brush dab centred at (cx, cy) with radius r (pixels).
   * o: { tool, density, pressure, rate (0…1), dx, dy (stroke step, for warp
   * and push), reverse (Alt: twirl the other way, swap pucker and bloat) }.
   * Returns the area whose pixels may have changed, or null.
   */
  dab(cx, cy, r, o) {
    const { step, gw, gh, d, freeze } = this;
    const i0 = Math.max(0, Math.floor((cx - r) / step));
    const i1 = Math.min(gw - 1, Math.ceil((cx + r) / step));
    const j0 = Math.max(0, Math.floor((cy - r) / step));
    const j1 = Math.min(gh - 1, Math.ceil((cy + r) / step));
    if (i0 > i1 || j0 > j1 || r <= 0) return null;
    const tool = o.tool;
    // Every node reads the field as it was before this dab: keep the old block.
    const bw = i1 - i0 + 1;
    const bh = j1 - j0 + 1;
    const old = new Float32Array(bw * bh * 2);
    for (let j = 0; j < bh; j++) old.set(d.subarray(((j0 + j) * gw + i0) * 2, ((j0 + j) * gw + i1 + 1) * 2), j * bw * 2);
    const node = (i, j, k) => (i >= i0 && i <= i1 && j >= j0 && j <= j1
      ? old[((j - j0) * bw + (i - i0)) * 2 + k]
      : d[(j * gw + i) * 2 + k]);
    const prev = [0, 0];
    const readOld = (x, y) => {
      let gx = x / step;
      let gy = y / step;
      if (gx < 0) gx = 0;
      else if (gx > gw - 1) gx = gw - 1;
      if (gy < 0) gy = 0;
      else if (gy > gh - 1) gy = gh - 1;
      const ia = Math.floor(gx);
      const ja = Math.floor(gy);
      const ib = Math.min(gw - 1, ia + 1);
      const jb = Math.min(gh - 1, ja + 1);
      const tx = gx - ia;
      const ty = gy - ja;
      for (let k = 0; k < 2; k++) {
        prev[k] = node(ia, ja, k) * (1 - tx) * (1 - ty) + node(ib, ja, k) * tx * (1 - ty)
          + node(ia, jb, k) * (1 - tx) * ty + node(ib, jb, k) * tx * ty;
      }
      return prev;
    };

    const power = 0.5 + 2 * (o.density ?? 0.5);
    const pressure = o.pressure ?? 1;
    const rate = o.rate ?? 0.8;
    let mode = tool;
    if (o.reverse && tool === 'pucker') mode = 'bloat';
    else if (o.reverse && tool === 'bloat') mode = 'pucker';
    let sdx = o.dx || 0;
    let sdy = o.dy || 0;
    if (tool === 'push') [sdx, sdy] = [sdy, -sdx]; // dragging up pushes left
    const r2 = r * r;
    let changed = false;
    for (let j = j0; j <= j1; j++) {
      const y = j * step;
      for (let i = i0; i <= i1; i++) {
        const x = i * step;
        const dist2 = (x - cx) ** 2 + (y - cy) ** 2;
        if (dist2 >= r2) continue;
        const fall = (1 - dist2 / r2) ** power;
        const n = j * gw + i;
        if (mode === 'freeze') {
          freeze[n] = Math.max(freeze[n], Math.round(255 * fall * pressure));
          changed = true;
          continue;
        }
        if (mode === 'thaw') {
          freeze[n] = Math.round(freeze[n] * (1 - fall * pressure));
          changed = true;
          continue;
        }
        const w = fall * (1 - freeze[n] / 255);
        if (w <= 0) continue;
        const p = n * 2;
        if (mode === 'warp' || mode === 'push') {
          // Content under the brush moves with the stroke.
          const sx = w * pressure * sdx;
          const sy = w * pressure * sdy;
          readOld(x - sx, y - sy);
          d[p] = prev[0] - sx;
          d[p + 1] = prev[1] - sy;
        } else if (mode === 'twirl' || mode === 'pucker' || mode === 'bloat') {
          // Where this point's colour now comes from, relative to the brush centre.
          let fx = x - cx;
          let fy = y - cy;
          if (mode === 'twirl') {
            const th = -(o.reverse ? -1 : 1) * TWIRL_SPEED * rate * w;
            const c = Math.cos(th);
            const s = Math.sin(th);
            [fx, fy] = [fx * c - fy * s, fx * s + fy * c];
          } else {
            const k = 1 + (mode === 'pucker' ? 1 : -1) * PUCKER_SPEED * rate * w;
            fx *= k;
            fy *= k;
          }
          readOld(cx + fx, cy + fy);
          d[p] = prev[0] + cx + fx - x;
          d[p + 1] = prev[1] + cy + fy - y;
        } else if (mode === 'reconstruct') {
          const k = 1 - Math.min(1, RECONSTRUCT_SPEED * rate * w);
          d[p] = node(i, j, 0) * k;
          d[p + 1] = node(i, j, 1) * k;
        } else if (mode === 'smooth') {
          const k = Math.min(1, SMOOTH_SPEED * rate * w);
          for (let c = 0; c < 2; c++) {
            let sum = 0;
            let cnt = 0;
            for (let jj = Math.max(0, j - 1); jj <= Math.min(gh - 1, j + 1); jj++) {
              for (let ii = Math.max(0, i - 1); ii <= Math.min(gw - 1, i + 1); ii++) {
                sum += node(ii, jj, c);
                cnt++;
              }
            }
            const v = node(i, j, c);
            d[p + c] = v + (sum / cnt - v) * k;
          }
        } else continue;
        changed = true;
      }
    }
    if (!changed) return null;
    return { x: (i0 - 1) * step, y: (j0 - 1) * step, w: (bw + 2) * step, h: (bh + 2) * step };
  }
}

/**
 * Draw the liquified image. For each pixel of `rect` in `dst` (ImageData),
 * the image point is q = ((x + 0.5 − ox) / z, (y + 0.5 − oy) / z); its colour
 * is sampled (bilinear, edges repeated) from `src` at (q + D(q)) × (sx, sy),
 * so a reduced copy of the image can stand in for previews. Options:
 * backdrop draws a checkerboard behind transparency and grey outside the
 * image; tint shows the freeze mask in red.
 */
export function renderLiquify(field, src, dst, rect, { z = 1, ox = 0, oy = 0, sx = 1, sy = 1, backdrop = false, tint = false } = {}) {
  const { width: sw, height: sh, data: s } = src;
  const { width: dw, data: o } = dst;
  const disp = [0, 0];
  const x0 = Math.max(0, rect.x);
  const y0 = Math.max(0, rect.y);
  const x1 = Math.min(dw, rect.x + rect.w);
  const y1 = Math.min(dst.height, rect.y + rect.h);
  for (let y = y0; y < y1; y++) {
    const qy = (y + 0.5 - oy) / z;
    for (let x = x0; x < x1; x++) {
      const qx = (x + 0.5 - ox) / z;
      const p = (y * dw + x) * 4;
      if (qx < 0 || qy < 0 || qx >= field.w || qy >= field.h) {
        if (backdrop) {
          o[p] = o[p + 1] = o[p + 2] = 38;
          o[p + 3] = 255;
        } else o[p] = o[p + 1] = o[p + 2] = o[p + 3] = 0;
        continue;
      }
      field.sample(qx, qy, disp);
      let fx = (qx + disp[0]) * sx - 0.5;
      let fy = (qy + disp[1]) * sy - 0.5;
      if (fx < 0) fx = 0;
      else if (fx > sw - 1) fx = sw - 1;
      if (fy < 0) fy = 0;
      else if (fy > sh - 1) fy = sh - 1;
      const xa = Math.floor(fx);
      const ya = Math.floor(fy);
      const tx = fx - xa;
      const ty = fy - ya;
      const i = (ya * sw + xa) * 4;
      const i10 = xa < sw - 1 ? i + 4 : i;
      const i01 = ya < sh - 1 ? i + sw * 4 : i;
      const i11 = xa < sw - 1 ? i01 + 4 : i01;
      const a00 = s[i + 3] * (1 - tx) * (1 - ty), a10 = s[i10 + 3] * tx * (1 - ty);
      const a01 = s[i01 + 3] * (1 - tx) * ty, a11 = s[i11 + 3] * tx * ty;
      const A = a00 + a10 + a01 + a11;
      let r = 0, g = 0, b = 0;
      if (A > 0) {
        r = (s[i] * a00 + s[i10] * a10 + s[i01] * a01 + s[i11] * a11) / A;
        g = (s[i + 1] * a00 + s[i10 + 1] * a10 + s[i01 + 1] * a01 + s[i11 + 1] * a11) / A;
        b = (s[i + 2] * a00 + s[i10 + 2] * a10 + s[i01 + 2] * a01 + s[i11 + 2] * a11) / A;
      }
      let a = A;
      if (backdrop) {
        // Over a checkerboard, as the main view shows transparency.
        const bg = ((x >> 3) + (y >> 3)) & 1 ? 204 : 255;
        const k = a / 255;
        r = r * k + bg * (1 - k);
        g = g * k + bg * (1 - k);
        b = b * k + bg * (1 - k);
        a = 255;
      }
      if (tint) {
        const f = field.frozenAt(qx, qy) * 0.5;
        if (f > 0) {
          r += (255 - r) * f;
          g *= 1 - f;
          b *= 1 - f;
        }
      }
      o[p] = r;
      o[p + 1] = g;
      o[p + 2] = b;
      o[p + 3] = a;
    }
  }
  return dst;
}
