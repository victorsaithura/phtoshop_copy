// Low-level helpers for per-pixel work on ImageData (RGBA, 0–255).

export const clamp255 = (v) => (v < 0 ? 0 : v > 255 ? 255 : v);
export const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

/** Rec. 601 luma, as used by Photoshop for most grey conversions. */
export const luma = (r, g, b) => 0.299 * r + 0.587 * g + 0.114 * b;

export function copyImageData(img) {
  return new ImageData(new Uint8ClampedArray(img.data), img.width, img.height);
}

/** 256-entry lookup table from fn(0..255). Values are clamped and rounded. */
export function makeLUT(fn) {
  const lut = new Uint8ClampedArray(256);
  for (let i = 0; i < 256; i++) lut[i] = Math.round(fn(i));
  return lut;
}

/** LUT that applies `a` then `b`. */
export function composeLUT(a, b) {
  return makeLUT((i) => b[a[i]]);
}

export function applyLUT(img, r, g = r, b = r) {
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    d[i] = r[d[i]];
    d[i + 1] = g[d[i + 1]];
    d[i + 2] = b[d[i + 2]];
  }
  return img;
}

/**
 * Per-channel histograms of visible pixels. `mask` (alpha per pixel, same
 * size) limits counting to selected pixels.
 */
export function histogram(img, mask = null) {
  const r = new Uint32Array(256);
  const g = new Uint32Array(256);
  const b = new Uint32Array(256);
  const l = new Uint32Array(256);
  const d = img.data;
  for (let i = 0, p = 0; i < d.length; i += 4, p++) {
    if (d[i + 3] === 0 || (mask && mask[p] < 128)) continue;
    r[d[i]]++;
    g[d[i + 1]]++;
    b[d[i + 2]]++;
    l[Math.round(luma(d[i], d[i + 1], d[i + 2]))]++;
  }
  return { r, g, b, rgb: l };
}

/** Values below/above which `clip` (fraction) of the histogram lies. */
export function histogramRange(hist, clip = 0.001) {
  let total = 0;
  for (let i = 0; i < 256; i++) total += hist[i];
  if (!total) return [0, 255];
  const limit = total * clip;
  let lo = 0;
  let hi = 255;
  for (let acc = 0; lo < 255; lo++) {
    acc += hist[lo];
    if (acc > limit) break;
  }
  for (let acc = 0; hi > 0; hi--) {
    acc += hist[hi];
    if (acc > limit) break;
  }
  return hi > lo ? [lo, hi] : [0, 255];
}

/** RGB (0–255) → HSL (0–1 each), written into `out`. */
export function rgbToHsl(r, g, b, out) {
  r /= 255;
  g /= 255;
  b /= 255;
  const max = r > g ? (r > b ? r : b) : g > b ? g : b;
  const min = r < g ? (r < b ? r : b) : g < b ? g : b;
  const l = (max + min) / 2;
  let h = 0;
  let s = 0;
  const d = max - min;
  if (d) {
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h /= 6;
  }
  out[0] = h;
  out[1] = s;
  out[2] = l;
  return out;
}

function hue2rgb(p, q, t) {
  if (t < 0) t += 1;
  if (t > 1) t -= 1;
  if (t < 1 / 6) return p + (q - p) * 6 * t;
  if (t < 1 / 2) return q;
  if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
  return p;
}

/** HSL (0–1 each) → RGB (0–255), written into `out`. */
export function hslToRgb(h, s, l, out) {
  if (!s) {
    out[0] = out[1] = out[2] = l * 255;
    return out;
  }
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  out[0] = hue2rgb(p, q, h + 1 / 3) * 255;
  out[1] = hue2rgb(p, q, h) * 255;
  out[2] = hue2rgb(p, q, h - 1 / 3) * 255;
  return out;
}

/** Small deterministic PRNG so previews and the final result match. */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Monotone cubic (Fritsch–Carlson) curve through points → 256-entry LUT. */
export function curveLUT(points) {
  const pts = [...points].sort((a, b) => a[0] - b[0]);
  const n = pts.length;
  if (n === 0) return makeLUT((i) => i);
  if (n === 1) return makeLUT(() => pts[0][1]);
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  const dx = [];
  const m = [];
  for (let i = 0; i < n - 1; i++) {
    dx[i] = Math.max(1e-6, xs[i + 1] - xs[i]);
    m[i] = (ys[i + 1] - ys[i]) / dx[i];
  }
  const t = [m[0]];
  for (let i = 1; i < n - 1; i++) {
    if (m[i - 1] * m[i] <= 0) t[i] = 0;
    else {
      const w1 = 2 * dx[i] + dx[i - 1];
      const w2 = dx[i] + 2 * dx[i - 1];
      t[i] = (w1 + w2) / (w1 / m[i - 1] + w2 / m[i]);
    }
  }
  t[n - 1] = m[n - 2];
  return makeLUT((x) => {
    if (x <= xs[0]) return ys[0];
    if (x >= xs[n - 1]) return ys[n - 1];
    let k = 0;
    while (k < n - 2 && x > xs[k + 1]) k++;
    const h = dx[k];
    const s = (x - xs[k]) / h;
    const s2 = s * s;
    const s3 = s2 * s;
    return (2 * s3 - 3 * s2 + 1) * ys[k] + (s3 - 2 * s2 + s) * h * t[k] +
      (-2 * s3 + 3 * s2) * ys[k + 1] + (s3 - s2) * h * t[k + 1];
  });
}
