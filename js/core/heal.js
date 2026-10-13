/*
 * Healing: copy texture from a source area, then shift its colours so it
 * blends seamlessly with the destination. The shift is the destination–source
 * difference on the edge of the painted area, smoothly interpolated inside it
 * (a Laplace / membrane solve). Spot healing uses the same maths with an
 * automatically chosen source.
 */

/**
 * dst, src: Uint8ClampedArray RGBA (w × h). unknown: Uint8Array, 1 where the
 * result is computed. Returns a new RGBA array: src + smooth(dst − src).
 */
export function healBlend(dst, src, unknown, w, h) {
  const n = w * h;
  const out = new Uint8ClampedArray(dst);
  const idx = [];
  for (let i = 0; i < n; i++) if (unknown[i]) idx.push(i);
  if (!idx.length) return out;

  // Per-channel difference, known on the edge, solved inside.
  const D = [0, 1, 2, 3].map(() => new Float32Array(n));
  for (let i = 0; i < n; i++) {
    if (unknown[i]) continue;
    for (let c = 0; c < 4; c++) D[c][i] = dst[i * 4 + c] - src[i * 4 + c];
  }

  // Initial guess: fill inwards ring by ring with the average of filled neighbours.
  const filled = new Uint8Array(n);
  for (let i = 0; i < n; i++) filled[i] = unknown[i] ? 0 : 1;
  let frontier = idx;
  for (let pass = 0; pass < w + h && frontier.length; pass++) {
    const next = [];
    const assign = [];
    for (const i of frontier) {
      const x = i % w;
      let cnt = 0;
      const sum = [0, 0, 0, 0];
      for (const j of [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, i - w, i + w]) {
        if (j < 0 || j >= n || !filled[j]) continue;
        cnt++;
        for (let c = 0; c < 4; c++) sum[c] += D[c][j];
      }
      if (cnt) assign.push([i, sum.map((s) => s / cnt)]);
      else next.push(i);
    }
    if (!assign.length) break;
    for (const [i, v] of assign) {
      filled[i] = 1;
      for (let c = 0; c < 4; c++) D[c][i] = v[c];
    }
    frontier = next;
  }

  // Successive over-relaxation towards the smooth (harmonic) solution.
  const iterations = Math.min(600, 60 + Math.round(Math.sqrt(idx.length) * 2));
  const omega = 1.85;
  for (let it = 0; it < iterations; it++) {
    for (const i of idx) {
      const x = i % w;
      const l = x > 0 ? i - 1 : -1;
      const r = x < w - 1 ? i + 1 : -1;
      const t = i - w;
      const b = i + w;
      for (let c = 0; c < 4; c++) {
        const Dc = D[c];
        let sum = 0;
        let cnt = 0;
        if (l >= 0) { sum += Dc[l]; cnt++; }
        if (r >= 0) { sum += Dc[r]; cnt++; }
        if (t >= 0) { sum += Dc[t]; cnt++; }
        if (b < n) { sum += Dc[b]; cnt++; }
        if (cnt) Dc[i] += omega * (sum / cnt - Dc[i]);
      }
    }
  }

  for (const i of idx) {
    for (let c = 0; c < 4; c++) out[i * 4 + c] = src[i * 4 + c] + D[c][i];
  }
  return out;
}

/**
 * Pick a source offset for spot healing: the nearby shift whose pixels best
 * match the destination around the edge of the painted area.
 * data: full layer RGBA (lw × lh); region { x, y, w, h } in layer coordinates;
 * unknown: mask for the region. Returns { dx, dy } or null.
 */
export function chooseSpotSource(data, lw, lh, region, unknown) {
  const { x: rx, y: ry, w, h } = region;
  // Edge ring: known pixels touching the painted area.
  const ring = [];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (unknown[i]) continue;
      if ((x > 0 && unknown[i - 1]) || (x < w - 1 && unknown[i + 1]) || (y > 0 && unknown[i - w]) || (y < h - 1 && unknown[i + w])) {
        ring.push([x, y]);
      }
    }
  }
  if (!ring.length) return null;
  const d = Math.max(w, h);
  let best = null;
  let bestScore = Infinity;
  for (const [ox, oy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, 1], [1, -1], [-1, -1]]) {
    const dx = Math.round(ox * d);
    const dy = Math.round(oy * d);
    // The whole shifted region must lie inside the layer.
    if (rx + dx < 0 || ry + dy < 0 || rx + dx + w > lw || ry + dy + h > lh) continue;
    let score = 0;
    for (const [x, y] of ring) {
      const a = ((ry + y) * lw + rx + x) * 4;
      const b = ((ry + y + dy) * lw + rx + x + dx) * 4;
      for (let c = 0; c < 3; c++) {
        const diff = data[a + c] - data[b + c];
        score += diff * diff;
      }
    }
    score /= ring.length;
    // Prefer the closer, axis-aligned candidates when scores tie.
    if (ox && oy) score *= 1.05;
    if (score < bestScore) {
      bestScore = score;
      best = { dx, dy };
    }
  }
  return best;
}
