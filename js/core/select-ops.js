import { blurMap, clamp01, distInside, distOutside } from './alpha-map.js';
import { rectInflate, rectIntersect } from './utils.js';

/*
 * Select ▸ Modify (Expand, Contract, Smooth, Border, Feather) and
 * Select ▸ Color Range. Work happens on the selection's area plus a margin.
 */

/** Grow by s whole pixels: everything within s px of the selection becomes selected. */
function expandMap(A, w, h, s) {
  const d = distOutside(A, w, h);
  const out = new Float32Array(A.length);
  for (let i = 0; i < A.length; i++) out[i] = Math.max(A[i], clamp01(s + 1 - d[i]));
  return out;
}

/** Shrink by s whole pixels. */
function contractMap(A, w, h, s) {
  const d = distInside(A, w, h);
  const out = new Float32Array(A.length);
  for (let i = 0; i < A.length; i++) out[i] = Math.min(A[i], clamp01(d[i] - s));
  return out;
}

/** Change the selection in place. op: expand | contract | smooth | border | feather. */
export function modifySelection(sel, op, amount) {
  if (sel.isEmpty() || !(amount > 0)) return;
  const W = sel.width;
  const H = sel.height;
  const pad = Math.ceil(op === 'feather' ? amount * 1.5 : amount) + 2;
  const r = rectIntersect(rectInflate(sel.bounds, pad), { x: 0, y: 0, w: W, h: H });
  const { w, h } = r;
  let A = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) A[y * w + x] = sel.alpha[(r.y + y) * W + r.x + x] / 255;
  }
  if (op === 'expand') {
    A = expandMap(A, w, h, amount);
  } else if (op === 'contract') {
    // Areas touching the canvas edge stay put (they have no outside to shrink from).
    A = contractMap(A, w, h, amount);
  } else if (op === 'smooth') {
    // Majority vote over the radius: stray pixels go, ragged edges round off.
    A = blurMap(A, w, h, amount / 2);
    for (let i = 0; i < A.length; i++) A[i] = clamp01((A[i] - 0.5) * 3 + 0.5);
  } else if (op === 'border') {
    const outer = expandMap(A, w, h, amount / 2);
    const inner = contractMap(A, w, h, amount / 2);
    const band = new Float32Array(A.length);
    for (let i = 0; i < band.length; i++) band[i] = Math.max(0, outer[i] - inner[i]);
    A = blurMap(band, w, h, 1);
  } else if (op === 'feather') {
    A = blurMap(A, w, h, amount / 2);
  }
  const alpha = new Uint8Array(W * H);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) alpha[(r.y + y) * W + r.x + x] = Math.round(A[y * w + x] * 255);
  }
  sel.fromAlpha(alpha, r);
}

export const COLOR_RANGES = [
  { value: 'sampled', label: 'Sampled Colors' },
  { value: 'reds', label: 'Reds', hue: 0 },
  { value: 'yellows', label: 'Yellows', hue: 60 },
  { value: 'greens', label: 'Greens', hue: 120 },
  { value: 'cyans', label: 'Cyans', hue: 180 },
  { value: 'blues', label: 'Blues', hue: 240 },
  { value: 'magentas', label: 'Magentas', hue: 300 },
  { value: 'highlights', label: 'Highlights' },
  { value: 'midtones', label: 'Midtones' },
  { value: 'shadows', label: 'Shadows' },
];

const luma = (r, g, b) => 0.299 * r + 0.587 * g + 0.114 * b;

/**
 * How selected each pixel is (0–255) for Select ▸ Color Range.
 * data: RGBA pixels. settings: { range, samples: [[r, g, b]], fuzziness (0–200), invert }.
 */
export function colorRangeAlpha(data, settings) {
  const n = data.length / 4;
  const out = new Uint8Array(n);
  const { range, samples = [], fuzziness = 40, invert = false } = settings;
  const def = COLOR_RANGES.find((c) => c.value === range) || COLOR_RANGES[0];
  const f = Math.max(0.5, fuzziness);
  for (let p = 0, i = 0; p < n; p++, i += 4) {
    const r = data[i], g = data[i + 1], b = data[i + 2];
    let k = 0;
    if (def.value === 'sampled') {
      // Fully selected within half the fuzziness, fading out to the full fuzziness.
      for (const s of samples) {
        const d = Math.hypot(r - s[0], g - s[1], b - s[2]) / Math.sqrt(3);
        k = Math.max(k, d <= f / 2 ? 1 : clamp01((f - d) / (f / 2)));
        if (k === 1) break;
      }
    } else if (def.hue != null) {
      const max = Math.max(r, g, b);
      const min = Math.min(r, g, b);
      const c = max - min;
      if (c && max > 25) {
        let hue;
        if (max === r) hue = ((g - b) / c) % 6;
        else if (max === g) hue = (b - r) / c + 2;
        else hue = (r - g) / c + 4;
        hue = (hue * 60 + 360) % 360;
        let dh = Math.abs(hue - def.hue);
        if (dh > 180) dh = 360 - dh;
        const sat = c / max;
        k = clamp01((60 - dh) / 30) * clamp01((sat - 0.1) / 0.15);
      }
    } else {
      // Full below 64 / above 192, fading over 32 levels; midtones peak at 128.
      const L = luma(r, g, b);
      if (def.value === 'highlights') k = clamp01((L - 160) / 32);
      else if (def.value === 'shadows') k = clamp01((96 - L) / 32);
      else k = clamp01((64 - Math.abs(L - 128)) / 32);
    }
    out[p] = Math.round((invert ? 1 - k : k) * 255);
  }
  return out;
}
