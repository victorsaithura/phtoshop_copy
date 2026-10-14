/*
 * Geometry for perspective and warp transforms: a mapping from the unit
 * square onto a quadrilateral, a 4×4 Bézier warp patch, and a renderer that
 * draws an image through any such mapping as a fine triangle mesh.
 */

/** Corner order used throughout: top-left, top-right, bottom-right, bottom-left. */
export const CORNERS = [[0, 0], [1, 0], [1, 1], [0, 1]];

/**
 * Projective map from the unit square onto quad `q` ([[x, y] × 4]), or null
 * if the quad isn't convex (it would have to pass through infinity).
 */
export function squareToQuad(q) {
  const [p0, p1, p2, p3] = q;
  const sx = p0[0] - p1[0] + p2[0] - p3[0];
  const sy = p0[1] - p1[1] + p2[1] - p3[1];
  let g = 0;
  let h = 0;
  if (Math.abs(sx) > 1e-9 || Math.abs(sy) > 1e-9) {
    const dx1 = p1[0] - p2[0], dx2 = p3[0] - p2[0];
    const dy1 = p1[1] - p2[1], dy2 = p3[1] - p2[1];
    const det = dx1 * dy2 - dx2 * dy1;
    if (Math.abs(det) < 1e-12) return null;
    g = (sx * dy2 - dx2 * sy) / det;
    h = (dx1 * sy - sx * dy1) / det;
  }
  // The denominator must stay positive over the whole square.
  if (Math.min(1, 1 + g, 1 + h, 1 + g + h) < 1e-3) return null;
  const m = [
    p1[0] - p0[0] + g * p1[0], p3[0] - p0[0] + h * p3[0], p0[0],
    p1[1] - p0[1] + g * p1[1], p3[1] - p0[1] + h * p3[1], p0[1],
    g, h, 1,
  ];
  // Reject quads that fold over: every corner must turn the same way.
  let sign = 0;
  for (let i = 0; i < 4; i++) {
    const a = q[i], b = q[(i + 1) % 4], c = q[(i + 2) % 4];
    const cross = (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]);
    if (Math.abs(cross) < 1e-9) return null;
    if (sign && Math.sign(cross) !== sign) return null;
    sign = Math.sign(cross);
  }
  return m;
}

export function applyProjective(m, u, v, out) {
  const w = m[6] * u + m[7] * v + m[8];
  out[0] = (m[0] * u + m[1] * v + m[2]) / w;
  out[1] = (m[3] * u + m[4] * v + m[5]) / w;
  return out;
}

/** Inverse of a 3×3 projective matrix (row-major, 9 numbers). */
export function invertProjective(m) {
  const [a, b, c, d, e, f, g, h, i] = m;
  const A = e * i - f * h, B = -(d * i - f * g), C = d * h - e * g;
  const det = a * A + b * B + c * C;
  if (Math.abs(det) < 1e-15) return null;
  return [
    A, -(b * i - c * h), b * f - c * e,
    B, a * i - c * g, -(a * f - c * d),
    C, -(a * h - b * g), a * e - b * d,
  ].map((v) => v / det);
}

/** Bilinear blend of the four corners (used when no projective map exists). */
export function bilinearQuad(q, u, v, out) {
  const a = (1 - u) * (1 - v), b = u * (1 - v), c = u * v, d = (1 - u) * v;
  out[0] = a * q[0][0] + b * q[1][0] + c * q[2][0] + d * q[3][0];
  out[1] = a * q[0][1] + b * q[1][1] + c * q[2][1] + d * q[3][1];
  return out;
}

/** True when the quad is a parallelogram, so a plain affine draw is exact. */
export function isParallelogram(q, eps = 1e-6) {
  return Math.abs(q[0][0] + q[2][0] - q[1][0] - q[3][0]) < eps
    && Math.abs(q[0][1] + q[2][1] - q[1][1] - q[3][1]) < eps;
}

/* ---------- Bézier warp patch ---------- */

/** Control points of an unwarped patch: a 4×4 grid over the unit square, row by row. */
export function identityGrid() {
  const g = [];
  for (let j = 0; j < 4; j++) for (let i = 0; i < 4; i++) g.push([i / 3, j / 3]);
  return g;
}

export function isIdentityGrid(g) {
  return !g || g.every(([x, y], k) => Math.abs(x - (k % 4) / 3) < 1e-9 && Math.abs(y - Math.floor(k / 4) / 3) < 1e-9);
}

/** Cubic Bernstein weights at t. */
export function bernstein(t, out = [0, 0, 0, 0]) {
  const s = 1 - t;
  out[0] = s * s * s;
  out[1] = 3 * t * s * s;
  out[2] = 3 * t * t * s;
  out[3] = t * t * t;
  return out;
}

const bu = [0, 0, 0, 0];
const bv = [0, 0, 0, 0];
export function evalPatch(g, u, v, out) {
  bernstein(u, bu);
  bernstein(v, bv);
  let x = 0;
  let y = 0;
  for (let j = 0; j < 4; j++) {
    for (let i = 0; i < 4; i++) {
      const w = bu[i] * bv[j];
      const p = g[j * 4 + i];
      x += w * p[0];
      y += w * p[1];
    }
  }
  out[0] = x;
  out[1] = y;
  return out;
}

/**
 * Warp presets as functions of (u, v) in the unit square and bend b (−1…1),
 * sampled at the control points.
 */
export const WARP_STYLES = {
  arc: (u, v, b) => [u, v - 0.5 * b * (1 - (2 * u - 1) ** 2)],
  arch: (u, v, b) => [u + 0.25 * b * (2 * u - 1) * (1 - v), v - 0.5 * b * (1 - (2 * u - 1) ** 2)],
  bulge: (u, v, b) => [u, v + 0.45 * b * (2 * v - 1) * (1 - (2 * u - 1) ** 2)],
  flag: (u, v, b) => [u, v - 0.3 * b * Math.sin(2 * Math.PI * u) / 2],
  wave: (u, v, b) => [u, v - 0.3 * b * Math.sin(2 * Math.PI * u + Math.PI * v) / 2],
  rise: (u, v, b) => [u, v - 0.4 * b * (u - 0.5) * (1 - Math.abs(2 * v - 1) * 0.3)],
  squeeze: (u, v, b) => [u - 0.4 * b * (2 * u - 1) * (1 - (2 * v - 1) ** 2) / 2, v],
  inflate: (u, v, b) => [
    u + 0.35 * b * (2 * u - 1) * (1 - (2 * v - 1) ** 2) / 2,
    v + 0.35 * b * (2 * v - 1) * (1 - (2 * u - 1) ** 2) / 2,
  ],
};

export function styleGrid(style, bend) {
  const f = WARP_STYLES[style];
  return identityGrid().map(([u, v]) => (f ? f(u, v, bend) : [u, v]));
}

/* ---------- Mesh renderer ---------- */

/**
 * Fill one triangle of the output. (X0…Y2) are its corners in output pixels,
 * (u0…v2) the matching source positions; `o` holds the shared buffers.
 */
function fillTriangle(o, X0, Y0, X1, Y1, X2, Y2, u0, v0, u1, v1, u2, v2) {
  const det = (X1 - X0) * (Y2 - Y0) - (X2 - X0) * (Y1 - Y0);
  if (Math.abs(det) < 1e-12) return;
  // Affine map from output to source across the triangle.
  const dux = ((u1 - u0) * (Y2 - Y0) - (u2 - u0) * (Y1 - Y0)) / det;
  const duy = ((u2 - u0) * (X1 - X0) - (u1 - u0) * (X2 - X0)) / det;
  const dvx = ((v1 - v0) * (Y2 - Y0) - (v2 - v0) * (Y1 - Y0)) / det;
  const dvy = ((v2 - v0) * (X1 - X0) - (v1 - v0) * (X2 - X0)) / det;
  const { s, w, h, d, bw, bh, smooth, maxSamples } = o;
  // Extra samples where the triangle squeezes the source, so detail doesn't alias.
  const count = (len) => (len <= 1.5 ? 1 : Math.min(maxSamples, Math.ceil(len)));
  const nu = smooth ? count(Math.hypot(dux, dvx)) : 1;
  const nv = smooth ? count(Math.hypot(duy, dvy)) : 1;
  const ns = nu * nv;
  const offU = o.offU;
  const offV = o.offV;
  for (let jj = 0, k = 0; jj < nv; jj++) {
    const fy = (jj + 0.5) / nv - 0.5;
    for (let ii = 0; ii < nu; ii++, k++) {
      const fx = (ii + 0.5) / nu - 0.5;
      offU[k] = dux * fx + duy * fy;
      offV[k] = dvx * fx + dvy * fy;
    }
  }
  // Edges sorted top to bottom. Spans are half-open and computed the same
  // way from either side, so neighbouring triangles share edge pixels once.
  const E = o.edges;
  E[0] = X0; E[1] = Y0; E[2] = X1; E[3] = Y1;
  E[4] = X1; E[5] = Y1; E[6] = X2; E[7] = Y2;
  E[8] = X2; E[9] = Y2; E[10] = X0; E[11] = Y0;
  for (let e = 0; e < 12; e += 4) {
    if (E[e + 1] > E[e + 3]) {
      const tx = E[e], ty = E[e + 1];
      E[e] = E[e + 2]; E[e + 1] = E[e + 3];
      E[e + 2] = tx; E[e + 3] = ty;
    }
  }
  const w4 = w * 4;
  const py0 = Math.max(0, Math.ceil(Math.min(Y0, Y1, Y2) - 0.5));
  const py1 = Math.min(bh - 1, Math.ceil(Math.max(Y0, Y1, Y2) - 0.5) - 1);
  for (let py = py0; py <= py1; py++) {
    const yc = py + 0.5;
    let xa = 0, xb = 0, m = 0;
    for (let e = 0; e < 12; e += 4) {
      const ya = E[e + 1], yb = E[e + 3];
      if (ya === yb || yc < ya || yc >= yb) continue;
      const x = E[e] + ((yc - ya) * (E[e + 2] - E[e])) / (yb - ya);
      if (m === 0) xa = x;
      else xb = x;
      m++;
    }
    if (m < 2) continue;
    const xl = xa < xb ? xa : xb;
    const xr = xa < xb ? xb : xa;
    const px0 = Math.max(0, Math.ceil(xl - 0.5));
    const px1 = Math.min(bw - 1, Math.ceil(xr - 0.5) - 1);
    const Y = yc - Y0;
    const ru = u0 + duy * Y;
    const rv = v0 + dvy * Y;
    for (let px = px0; px <= px1; px++) {
      const X = px + 0.5 - X0;
      const u = ru + dux * X;
      const v = rv + dvx * X;
      let R = 0, G = 0, B = 0, A = 0;
      for (let k = 0; k < ns; k++) {
        const su = u + offU[k];
        const sv = v + offV[k];
        if (!smooth) {
          const x = Math.floor(su);
          const y = Math.floor(sv);
          if (x < 0 || y < 0 || x >= w || y >= h) continue;
          const i = (y * w + x) * 4;
          const a = s[i + 3];
          R += s[i] * a; G += s[i + 1] * a; B += s[i + 2] * a; A += a;
          continue;
        }
        const fx = su - 0.5;
        const fy = sv - 0.5;
        const x0 = Math.floor(fx);
        const y0 = Math.floor(fy);
        const tx = fx - x0;
        const ty = fy - y0;
        const w00 = (1 - tx) * (1 - ty), w10 = tx * (1 - ty), w01 = (1 - tx) * ty, w11 = tx * ty;
        if (x0 >= 0 && y0 >= 0 && x0 < w - 1 && y0 < h - 1) {
          const i = (y0 * w + x0) * 4;
          const j = i + w4;
          const a00 = s[i + 3] * w00, a10 = s[i + 7] * w10, a01 = s[j + 3] * w01, a11 = s[j + 7] * w11;
          R += s[i] * a00 + s[i + 4] * a10 + s[j] * a01 + s[j + 4] * a11;
          G += s[i + 1] * a00 + s[i + 5] * a10 + s[j + 1] * a01 + s[j + 5] * a11;
          B += s[i + 2] * a00 + s[i + 6] * a10 + s[j + 2] * a01 + s[j + 6] * a11;
          A += a00 + a10 + a01 + a11;
        } else {
          // Near the border: pixels beyond it are transparent, which softens the edges.
          for (let t = 0; t < 4; t++) {
            const x = x0 + (t & 1);
            const y = y0 + (t >> 1);
            if (x < 0 || y < 0 || x >= w || y >= h) continue;
            const i = (y * w + x) * 4;
            const a = s[i + 3] * (t === 0 ? w00 : t === 1 ? w10 : t === 2 ? w01 : w11);
            R += s[i] * a; G += s[i + 1] * a; B += s[i + 2] * a; A += a;
          }
        }
      }
      // Nothing to draw keeps what an earlier (folded-over) triangle left.
      if (A > 0) {
        const p = (py * bw + px) * 4;
        d[p] = R / A;
        d[p + 1] = G / A;
        d[p + 2] = B / A;
        d[p + 3] = A / ns;
      }
    }
  }
}

/**
 * Draw `src` (ImageData) through map(sx, sy, out), which writes the document
 * position of source point (sx, sy) (pixels; pixel i spans i…i+1). The source
 * is cut into a triangle mesh and each triangle filled pixel by pixel with
 * bilinear (or nearest) sampling; a transparent 1 px border softens the
 * edges. `scale` renders at reduced resolution for previews (with one sample
 * per pixel, `maxSamples`), and `limit` (a document rect) bounds the output.
 * Returns { image, x, y } in scaled units, or null.
 */
export function meshWarp(src, map, { smooth = true, scale = 1, limit = null, maxCells = 64, maxSamples = 4 } = {}) {
  const { width: w, height: h } = src;
  const cols = Math.max(1, Math.min(maxCells, Math.ceil((w + 2) / 6)));
  const rows = Math.max(1, Math.min(maxCells, Math.ceil((h + 2) / 6)));
  const n = (cols + 1) * (rows + 1);
  const vx = new Float64Array(n), vy = new Float64Array(n);
  const vu = new Float64Array(n), vv = new Float64Array(n);
  const out = [0, 0];
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (let j = 0, k = 0; j <= rows; j++) {
    const sy = -1 + ((h + 2) * j) / rows;
    for (let i = 0; i <= cols; i++, k++) {
      const sx = -1 + ((w + 2) * i) / cols;
      map(sx, sy, out);
      const X = out[0] * scale;
      const Y = out[1] * scale;
      if (!Number.isFinite(X) || !Number.isFinite(Y)) return null;
      vx[k] = X;
      vy[k] = Y;
      vu[k] = sx;
      vv[k] = sy;
      if (X < minX) minX = X;
      if (X > maxX) maxX = X;
      if (Y < minY) minY = Y;
      if (Y > maxY) maxY = Y;
    }
  }
  let bx = Math.floor(minX), by = Math.floor(minY);
  let bx2 = Math.ceil(maxX), by2 = Math.ceil(maxY);
  if (limit) {
    bx = Math.max(bx, Math.floor(limit.x * scale));
    by = Math.max(by, Math.floor(limit.y * scale));
    bx2 = Math.min(bx2, Math.ceil((limit.x + limit.w) * scale));
    by2 = Math.min(by2, Math.ceil((limit.y + limit.h) * scale));
  }
  const bw = bx2 - bx;
  const bh = by2 - by;
  if (bw <= 0 || bh <= 0) return null;
  const image = new ImageData(bw, bh);
  const o = {
    s: src.data, w, h, d: image.data, bw, bh, smooth, maxSamples,
    offU: new Float64Array(16), offV: new Float64Array(16), edges: new Float64Array(12),
  };
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      const a = j * (cols + 1) + i;
      const b = a + 1;
      const c = a + cols + 2;
      const e = a + cols + 1;
      fillTriangle(o, vx[a] - bx, vy[a] - by, vx[b] - bx, vy[b] - by, vx[c] - bx, vy[c] - by,
        vu[a], vv[a], vu[b], vv[b], vu[c], vv[c]);
      fillTriangle(o, vx[a] - bx, vy[a] - by, vx[c] - bx, vy[c] - by, vx[e] - bx, vy[e] - by,
        vu[a], vv[a], vu[c], vv[c], vu[e], vv[e]);
    }
  }
  return { image, x: bx, y: by };
}
