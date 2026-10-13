import { BLEND_MODES } from './layer.js';
import { blendFn } from './blend.js';
import { createCanvas, drawRegion, hexToRgb, rectInflate, rectIntersect } from './utils.js';

/*
 * Layer styles (Layer ▸ Layer Style): effects drawn from the shape of a layer's
 * pixels at composite time, so they follow every edit. Drop shadows, outer
 * glows and outside strokes go under the layer, blended with what is below;
 * overlays, inner shadows and glows, inside strokes and bevels are blended
 * into the layer's own pixels.
 */

const MODE_OPTIONS = BLEND_MODES.filter(Boolean);
const slider = (key, label, min, max, value, unit = '') => ({ key, label, min, max, value, step: 1, unit });
const mode = (key, value, label = 'Blend Mode') => ({ key, label, type: 'select', options: MODE_OPTIONS, value });
const color = (key, value, label = 'Color') => ({ key, label, type: 'color', value });
const choice = (key, label, value, options) => ({ key, label, type: 'select', value, options: options.map(([v, l]) => ({ value: v, label: l })) });

// In the order of Photoshop's Layer Style dialog.
export const EFFECTS = {
  bevel: {
    title: 'Bevel & Emboss',
    params: [
      choice('style', 'Style', 'inner', [['inner', 'Inner Bevel'], ['outer', 'Outer Bevel'], ['emboss', 'Emboss']]),
      slider('depth', 'Depth', 1, 1000, 100, '%'),
      choice('direction', 'Direction', 'up', [['up', 'Up'], ['down', 'Down']]),
      slider('size', 'Size', 1, 250, 5, 'px'),
      slider('soften', 'Soften', 0, 16, 0, 'px'),
      { type: 'heading', label: 'Shading' },
      slider('angle', 'Angle', -180, 180, 120, '°'),
      slider('altitude', 'Altitude', 0, 90, 30, '°'),
      mode('highlightMode', 'screen', 'Highlight Mode'),
      color('highlightColor', '#ffffff', 'Highlight Color'),
      slider('highlightOpacity', 'Highlight Opacity', 0, 100, 75, '%'),
      mode('shadowMode', 'multiply', 'Shadow Mode'),
      color('shadowColor', '#000000', 'Shadow Color'),
      slider('shadowOpacity', 'Shadow Opacity', 0, 100, 75, '%'),
    ],
  },
  stroke: {
    title: 'Stroke',
    params: [
      slider('size', 'Size', 1, 250, 3, 'px'),
      choice('position', 'Position', 'outside', [['outside', 'Outside'], ['inside', 'Inside'], ['center', 'Center']]),
      mode('blendMode', 'source-over'),
      slider('opacity', 'Opacity', 0, 100, 100, '%'),
      color('color', '#000000'),
    ],
  },
  innerShadow: {
    title: 'Inner Shadow',
    params: [
      mode('blendMode', 'multiply'), color('color', '#000000'), slider('opacity', 'Opacity', 0, 100, 75, '%'),
      slider('angle', 'Angle', -180, 180, 120, '°'), slider('distance', 'Distance', 0, 250, 5, 'px'),
      slider('choke', 'Choke', 0, 100, 0, '%'), slider('size', 'Size', 0, 250, 5, 'px'),
    ],
  },
  innerGlow: {
    title: 'Inner Glow',
    params: [
      mode('blendMode', 'screen'), color('color', '#ffffbe'), slider('opacity', 'Opacity', 0, 100, 75, '%'),
      choice('source', 'Source', 'edge', [['edge', 'Edge'], ['center', 'Center']]),
      slider('choke', 'Choke', 0, 100, 0, '%'), slider('size', 'Size', 0, 250, 5, 'px'),
    ],
  },
  colorOverlay: {
    title: 'Color Overlay',
    params: [mode('blendMode', 'source-over'), color('color', '#ff0000'), slider('opacity', 'Opacity', 0, 100, 100, '%')],
  },
  outerGlow: {
    title: 'Outer Glow',
    params: [
      mode('blendMode', 'screen'), color('color', '#ffffbe'), slider('opacity', 'Opacity', 0, 100, 75, '%'),
      slider('spread', 'Spread', 0, 100, 0, '%'), slider('size', 'Size', 0, 250, 5, 'px'),
    ],
  },
  dropShadow: {
    title: 'Drop Shadow',
    params: [
      mode('blendMode', 'multiply'), color('color', '#000000'), slider('opacity', 'Opacity', 0, 100, 75, '%'),
      slider('angle', 'Angle', -180, 180, 120, '°'), slider('distance', 'Distance', 0, 250, 5, 'px'),
      slider('spread', 'Spread', 0, 100, 0, '%'), slider('size', 'Size', 0, 250, 5, 'px'),
    ],
  },
};

/** Settings for a newly switched-on effect. */
export function effectDefaults(key) {
  const p = { enabled: true };
  for (const c of EFFECTS[key].params) if (c.key) p[c.key] = c.value;
  return p;
}

export function hasStyles(layer) {
  const s = layer.styles;
  if (!s || !layer.isPixel) return false;
  for (const k in s) if (s[k]?.enabled) return true;
  return false;
}

/** How far effects can reach beyond the layer's pixels. */
export function styleMargin(styles) {
  let m = 0;
  const on = (k) => (styles[k]?.enabled ? styles[k] : null);
  let e;
  if ((e = on('dropShadow'))) m = Math.max(m, e.distance + e.size * 2);
  if ((e = on('innerShadow'))) m = Math.max(m, e.distance + e.size * 2);
  if ((e = on('outerGlow'))) m = Math.max(m, e.size * 2);
  if ((e = on('innerGlow'))) m = Math.max(m, e.size * 2);
  if ((e = on('stroke'))) m = Math.max(m, e.size);
  if ((e = on('bevel'))) m = Math.max(m, e.size * 2 + e.soften * 2);
  return Math.ceil(m) + 2;
}

/* ---------- Alpha-map operations (Float32Array, 0–1, w × h) ---------- */

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

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

const distOutside = (A, w, h) => distanceTo((i) => A[i] >= 0.5, w, h);
const distInside = (A, w, h) => distanceTo((i) => A[i] < 0.5, w, h);

/** The shape grown outwards by s pixels (anti-aliased). */
function grow(A, w, h, s) {
  if (s <= 0) return A;
  const d = distOutside(A, w, h);
  const out = new Float32Array(A.length);
  for (let i = 0; i < A.length; i++) out[i] = Math.max(A[i], clamp01(s + 0.5 - d[i]));
  return out;
}

/** The shape shrunk inwards by s pixels. */
function shrink(A, w, h, s) {
  if (s <= 0) return A;
  const d = distInside(A, w, h);
  const out = new Float32Array(A.length);
  for (let i = 0; i < A.length; i++) out[i] = Math.min(A[i], clamp01(d[i] - s + 0.5));
  return out;
}

function shift(A, w, h, dx, dy, fill) {
  if (!dx && !dy) return A;
  const out = new Float32Array(A.length).fill(fill);
  for (let y = Math.max(0, dy); y < Math.min(h, h + dy); y++) {
    const sy = y - dy;
    for (let x = Math.max(0, dx); x < Math.min(w, w + dx); x++) out[y * w + x] = A[sy * w + x - dx];
  }
  return out;
}

const inverted = (A) => A.map((v) => 1 - v);

/** Offset of a shadow cast away from a light at `angle` (Photoshop convention: 120° = from the upper left). */
function castOffset(angle, distance) {
  const t = (angle * Math.PI) / 180;
  return [Math.round(-Math.cos(t) * distance), Math.round(Math.sin(t) * distance)];
}

/** Highlight and shadow strengths of a bevel, lit from angle/altitude. */
function bevelMaps(e, A, w, h) {
  const size = Math.max(1, e.size);
  const base = e.style === 'inner' ? shrink(A, w, h, size / 2) : e.style === 'outer' ? grow(A, w, h, size / 2) : A;
  const H = blurMap(base, w, h, size / 2);
  const k = (e.depth / 100) * size * (e.direction === 'down' ? -1 : 1);
  const t = (e.angle * Math.PI) / 180;
  const alt = (e.altitude * Math.PI) / 180;
  const lx = Math.cos(alt) * Math.cos(t);
  const ly = -Math.cos(alt) * Math.sin(t);
  const lz = Math.sin(alt);
  let hi = new Float32Array(A.length);
  let lo = new Float32Array(A.length);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const gx = (H[x < w - 1 ? i + 1 : i] - H[x > 0 ? i - 1 : i]) / 2;
      const gy = (H[y < h - 1 ? i + w : i] - H[y > 0 ? i - w : i]) / 2;
      const nx = -gx * k;
      const ny = -gy * k;
      const s = (nx * lx + ny * ly + lz) / Math.sqrt(nx * nx + ny * ny + 1);
      if (s > lz) hi[i] = lz < 1 ? (s - lz) / (1 - lz) : 0;
      else if (lz > 0) lo[i] = (lz - s) / lz;
    }
  }
  if (e.soften > 0) {
    hi = blurMap(hi, w, h, e.soften / 2);
    lo = blurMap(lo, w, h, e.soften / 2);
  }
  return { hi, lo };
}

/* ---------- Rendering ---------- */

/**
 * Effects for a work area: `content` (ImageData of the layer's masked pixels)
 * gets the interior effects; returns the effects drawn under and over it.
 */
function renderEffects(styles, content, A, w, h) {
  const under = [];
  const over = [];
  const interior = [];
  const on = (k) => (styles[k]?.enabled ? styles[k] : null);
  const knockout = (m) => {
    for (let i = 0; i < m.length; i++) m[i] *= 1 - A[i];
    return m;
  };
  let e;

  if ((e = on('dropShadow'))) {
    const spread = (e.size * e.spread) / 100;
    let m = blurMap(grow(A, w, h, spread), w, h, (e.size - spread) / 2);
    const [dx, dy] = castOffset(e.angle, e.distance);
    m = knockout(Float32Array.from(shift(m, w, h, dx, dy, 0)));
    under.push({ map: m, color: e.color, opacity: e.opacity / 100, mode: e.blendMode });
  }
  if ((e = on('outerGlow'))) {
    const spread = (e.size * e.spread) / 100;
    const m = knockout(Float32Array.from(blurMap(grow(A, w, h, spread), w, h, (e.size - spread) / 2)));
    under.push({ map: m, color: e.color, opacity: e.opacity / 100, mode: e.blendMode });
  }
  const st = on('stroke');
  if (st && st.position !== 'inside') {
    const s = st.position === 'center' ? st.size / 2 : st.size;
    const d = distOutside(A, w, h);
    const m = new Float32Array(A.length);
    for (let i = 0; i < m.length; i++) m[i] = clamp01(s + 0.5 - d[i]);
    under.push({ map: m, color: st.color, opacity: st.opacity / 100, mode: st.blendMode });
  }

  if ((e = on('colorOverlay'))) interior.push({ map: null, color: e.color, opacity: e.opacity / 100, mode: e.blendMode });
  if ((e = on('innerGlow'))) {
    const choke = (e.size * e.choke) / 100;
    const m = Float32Array.from(blurMap(grow(inverted(A), w, h, choke), w, h, (e.size - choke) / 2));
    if (e.source === 'center') for (let i = 0; i < m.length; i++) m[i] = 1 - m[i];
    interior.push({ map: m, color: e.color, opacity: e.opacity / 100, mode: e.blendMode });
  }
  if ((e = on('innerShadow'))) {
    const choke = (e.size * e.choke) / 100;
    const m = blurMap(grow(inverted(A), w, h, choke), w, h, (e.size - choke) / 2);
    const [dx, dy] = castOffset(e.angle, e.distance);
    interior.push({ map: shift(m, w, h, dx, dy, 1), color: e.color, opacity: e.opacity / 100, mode: e.blendMode });
  }
  if (st && st.position !== 'outside') {
    const s = st.position === 'center' ? st.size / 2 : st.size;
    const d = distInside(A, w, h);
    const m = new Float32Array(A.length);
    for (let i = 0; i < m.length; i++) m[i] = clamp01(s + 0.5 - d[i]);
    interior.push({ map: m, color: st.color, opacity: st.opacity / 100, mode: st.blendMode });
  }
  if ((e = on('bevel'))) {
    const { hi, lo } = bevelMaps(e, A, w, h);
    const light = { color: e.highlightColor, opacity: e.highlightOpacity / 100, mode: e.highlightMode };
    const shade = { color: e.shadowColor, opacity: e.shadowOpacity / 100, mode: e.shadowMode };
    if (e.style !== 'inner') {
      over.push({ ...light, map: knockout(Float32Array.from(hi)) }, { ...shade, map: knockout(Float32Array.from(lo)) });
    }
    if (e.style !== 'outer') interior.push({ ...light, map: hi }, { ...shade, map: lo });
  }

  applyInterior(content, interior);
  return { under, over };
}

/** Blend each interior effect into the layer's pixels; transparency is unchanged. */
function applyInterior(img, list) {
  const d = img.data;
  const c = [0, 0, 0];
  for (const fx of list) {
    const { r, g, b } = hexToRgb(fx.color);
    const blend = fx.mode && fx.mode !== 'source-over' ? blendFn(fx.mode) : null;
    const { map, opacity } = fx;
    for (let p = 0, i = 0; i < d.length; p++, i += 4) {
      if (!d[i + 3]) continue;
      const k = map ? map[p] * opacity : opacity;
      if (k <= 0) continue;
      let nr = r, ng = g, nb = b;
      if (blend) {
        blend(d[i], d[i + 1], d[i + 2], r, g, b, c);
        nr = c[0];
        ng = c[1];
        nb = c[2];
      }
      d[i] += (nr - d[i]) * k;
      d[i + 1] += (ng - d[i + 1]) * k;
      d[i + 2] += (nb - d[i + 2]) * k;
    }
  }
}

function mapToCanvas({ map, color: hex, opacity }, w, h) {
  const img = new ImageData(w, h);
  const { r, g, b } = hexToRgb(hex);
  const d = img.data;
  for (let p = 0, i = 0; p < map.length; p++, i += 4) {
    const a = map[p] * opacity;
    if (a <= 0) continue;
    d[i] = r;
    d[i + 1] = g;
    d[i + 2] = b;
    d[i + 3] = a * 255;
  }
  const c = createCanvas(w, h);
  c.getContext('2d').putImageData(img, 0, 0);
  return c;
}

/** Bounding box of non-transparent pixels in ImageData (local coordinates), or null. */
function alphaBounds(img) {
  const { width: w, height: h, data } = img;
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!data[(y * w + x) * 4 + 3]) continue;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
  }
  return x1 < 0 ? null : { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}

/**
 * The styled layer as pieces to draw: { x, y, w, h, under: [{ canvas, mode }], body, over }.
 * `limit` (document rect) restricts the work to what that area needs.
 */
function computeStyled(styles, src, mask, limit) {
  const M = styleMargin(styles);
  let area = { x: src.x, y: src.y, w: src.canvas.width, h: src.canvas.height };
  if (limit) area = rectIntersect(area, rectInflate(limit, M));
  if (!area) return null;
  const c = createCanvas(area.w, area.h);
  const cctx = c.getContext('2d', { willReadFrequently: true });
  cctx.drawImage(src.canvas, src.x - area.x, src.y - area.y);
  if (mask) {
    cctx.globalCompositeOperation = 'destination-in';
    cctx.drawImage(mask.canvas, mask.x - area.x, mask.y - area.y);
  }
  const img = cctx.getImageData(0, 0, area.w, area.h);
  const bb = alphaBounds(img);
  if (!bb) return null;
  const w = bb.w + 2 * M;
  const h = bb.h + 2 * M;
  const content = new ImageData(w, h);
  const A = new Float32Array(w * h);
  for (let y = 0; y < bb.h; y++) {
    const from = ((bb.y + y) * area.w + bb.x) * 4;
    content.data.set(img.data.subarray(from, from + bb.w * 4), ((y + M) * w + M) * 4);
  }
  for (let p = 0; p < A.length; p++) A[p] = content.data[p * 4 + 3] / 255;
  const { under, over } = renderEffects(styles, content, A, w, h);
  const body = createCanvas(w, h);
  body.getContext('2d').putImageData(content, 0, 0);
  const toCanvas = (fx) => ({ canvas: mapToCanvas(fx, w, h), mode: fx.mode });
  return { x: area.x + bb.x - M, y: area.y + bb.y - M, w, h, under: under.map(toCanvas), body, over: over.map(toCanvas) };
}

/** Cached full-layer result while the layer's pixels, mask and style stay the same. */
function cachedStyled(layer, mask) {
  const m = layer.mask;
  const key = `${layer.contentVersion}|${m && m.enabled ? `${m.ox},${m.oy}` : '-'}|${JSON.stringify(layer.styles)}`;
  const c = layer._styleCache;
  if (c && c.key === key && c.canvas === layer.canvas && c.maskCanvas === (mask?.canvas || null)) return c;
  const res = computeStyled(layer.styles, layer, mask, null);
  layer._styleCache = {
    key, canvas: layer.canvas, maskCanvas: mask?.canvas || null, res,
    dx: res ? res.x - layer.x : 0, dy: res ? res.y - layer.y : 0,
  };
  return layer._styleCache;
}

/** Draw a layer with its effects into ctx (document coordinates), limited to rect r. */
export function drawStyledLayer(doc, ctx, layer, src, mask, r) {
  let res;
  let x;
  let y;
  if (src === layer) {
    const c = cachedStyled(layer, mask);
    res = c.res;
    x = layer.x + c.dx;
    y = layer.y + c.dy;
  } else {
    // Live previews (strokes, mask painting) change every frame: work on the visible area only.
    res = computeStyled(layer.styles, src, mask, r);
    x = res?.x;
    y = res?.y;
  }
  if (!res) return;
  const draw = (canvas, op) => {
    ctx.globalAlpha = layer.opacity;
    ctx.globalCompositeOperation = op;
    drawRegion(ctx, canvas, x, y, r);
  };
  for (const fx of res.under) draw(fx.canvas, fx.mode);
  draw(res.body, layer.blendMode);
  for (const fx of res.over) draw(fx.canvas, fx.mode);
}

/** The layer with its mask and effects flattened (for merging and export): { canvas, x, y }. */
export function rasterizeStyled(layer) {
  const res = computeStyled(layer.styles, layer, layer.activeMask, null);
  if (!res) return { canvas: createCanvas(1, 1), x: layer.x, y: layer.y };
  const c = createCanvas(res.w, res.h);
  const ctx = c.getContext('2d');
  for (const fx of res.under) {
    ctx.globalCompositeOperation = fx.mode;
    ctx.drawImage(fx.canvas, 0, 0);
  }
  ctx.globalCompositeOperation = 'source-over';
  ctx.drawImage(res.body, 0, 0);
  for (const fx of res.over) {
    ctx.globalCompositeOperation = fx.mode;
    ctx.drawImage(fx.canvas, 0, 0);
  }
  return { canvas: c, x: res.x, y: res.y };
}
