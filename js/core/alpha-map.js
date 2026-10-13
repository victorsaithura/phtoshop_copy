/*
 * Operations on alpha maps: Float32Array values 0–1, w × h, row by row.
 * Used by layer styles and by Select ▸ Modify.
 */

export const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

function boxesForGauss(sigma) {
  const wIdeal = Math.sqrt((12 * sigma * sigma) / 3 + 1);
  let wl = Math.floor(wIdeal);
  if (wl % 2 === 0) wl--;
  const m = Math.round((12 * sigma * sigma - 3 * wl * wl - 12 * wl - 9) / (-4 * wl - 4));
  return [0, 1, 2].map((i) => (i < m ? wl : wl + 2));
}

function blurLine(src, dst, n, stride, offset, r) {
  const inv = 1 / (2 * r + 1);
  const at = (k) => src[offset + (k < 0 ? 0 : k >= n ? n - 1 : k) * stride];
  let acc = 0;
  for (let k = -r; k <= r; k++) acc += at(k);
  for (let i = 0; i < n; i++) {
    dst[offset + i * stride] = acc * inv;
    acc += at(i + r + 1) - at(i - r);
  }
}

/** Gaussian blur (three box passes); edges repeat the border value. */
export function blurMap(a, w, h, sigma) {
  if (!(sigma >= 0.5)) return a;
  const cur = Float32Array.from(a);
  const tmp = new Float32Array(a.length);
  for (const bw of boxesForGauss(sigma)) {
    const r = (bw - 1) / 2;
    if (r < 1) continue;
    for (let y = 0; y < h; y++) blurLine(cur, tmp, w, 1, y * w, r);
    for (let x = 0; x < w; x++) blurLine(tmp, cur, h, w, x, r);
  }
  return cur;
}

const INF = 1e20;

function edt1d(f, n, d, v, z) {
  let k = 0;
  v[0] = 0;
  z[0] = -INF;
  z[1] = INF;
  const meet = (q, p) => (f[q] + q * q - (f[p] + p * p)) / (2 * q - 2 * p);
  for (let q = 1; q < n; q++) {
    let s = meet(q, v[k]);
    while (s <= z[k]) {
      k--;
      s = meet(q, v[k]);
    }
    k++;
    v[k] = q;
    z[k] = s;
    z[k + 1] = INF;
  }
  k = 0;
  for (let q = 0; q < n; q++) {
    while (z[k + 1] < q) k++;
    const p = v[k];
    d[q] = (q - p) * (q - p) + f[p];
  }
}

/** Euclidean distance from every pixel to the nearest pixel where test(i) is true (Felzenszwalb–Huttenlocher). */
function distanceTo(test, w, h) {
  const grid = new Float64Array(w * h);
  for (let i = 0; i < grid.length; i++) grid[i] = test(i) ? 0 : INF;
  const n = Math.max(w, h);
  const f = new Float64Array(n);
  const d = new Float64Array(n);
  const z = new Float64Array(n + 1);
  const v = new Int32Array(n);
  for (let x = 0; x < w; x++) {
    for (let y = 0; y < h; y++) f[y] = grid[y * w + x];
    edt1d(f, h, d, v, z);
    for (let y = 0; y < h; y++) grid[y * w + x] = d[y];
  }
  for (let y = 0; y < h; y++) {
    const row = y * w;
    for (let x = 0; x < w; x++) f[x] = grid[row + x];
    edt1d(f, w, d, v, z);
    for (let x = 0; x < w; x++) grid[row + x] = Math.sqrt(d[x]);
  }
  return grid;
}

export const distOutside = (A, w, h) => distanceTo((i) => A[i] >= 0.5, w, h);
export const distInside = (A, w, h) => distanceTo((i) => A[i] < 0.5, w, h);

/** The shape grown outwards by s pixels (anti-aliased). */
export function grow(A, w, h, s) {
  if (s <= 0) return A;
  const d = distOutside(A, w, h);
  const out = new Float32Array(A.length);
  for (let i = 0; i < A.length; i++) out[i] = Math.max(A[i], clamp01(s + 0.5 - d[i]));
  return out;
}

/** The shape shrunk inwards by s pixels. */
export function shrink(A, w, h, s) {
  if (s <= 0) return A;
  const d = distInside(A, w, h);
  const out = new Float32Array(A.length);
  for (let i = 0; i < A.length; i++) out[i] = Math.min(A[i], clamp01(d[i] - s + 0.5));
  return out;
}

export function shift(A, w, h, dx, dy, fill) {
  if (!dx && !dy) return A;
  const out = new Float32Array(A.length).fill(fill);
  for (let y = Math.max(0, dy); y < Math.min(h, h + dy); y++) {
    const sy = y - dy;
    for (let x = Math.max(0, dx); x < Math.min(w, w + dx); x++) out[y * w + x] = A[sy * w + x - dx];
  }
  return out;
}
