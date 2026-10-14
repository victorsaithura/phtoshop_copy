/*
 * Content-Aware Fill: fill a hole with texture from its surroundings by
 * multi-scale patch synthesis (Wexler et al., with Barnes et al.'s
 * PatchMatch for the nearest-patch search). From coarse to fine, every
 * 7×7 patch touching the hole finds its most similar patch outside the hole,
 * and each hole pixel becomes the weighted vote of the patches covering it.
 * No DOM: it runs in a worker as well as on the page.
 */

const R = 3; // patch radius: 7×7 patches

function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Half-size level: known pixels average their known children; any hole child makes a hole. */
function downsample({ img, hole, w, h }) {
  const nw = Math.max(1, w >> 1);
  const nh = Math.max(1, h >> 1);
  const out = new Float32Array(nw * nh * 4);
  const oh = new Uint8Array(nw * nh);
  for (let y = 0; y < nh; y++) {
    for (let x = 0; x < nw; x++) {
      const o = y * nw + x;
      let n = 0;
      let anyHole = 0;
      const s = [0, 0, 0, 0];
      for (let dy = 0; dy < 2; dy++) {
        const yy = Math.min(h - 1, 2 * y + dy);
        for (let dx = 0; dx < 2; dx++) {
          const p = yy * w + Math.min(w - 1, 2 * x + dx);
          if (hole[p]) {
            anyHole = 1;
            continue;
          }
          for (let c = 0; c < 4; c++) s[c] += img[p * 4 + c];
          n++;
        }
      }
      oh[o] = anyHole;
      if (n) for (let c = 0; c < 4; c++) out[o * 4 + c] = s[c] / n;
    }
  }
  return { img: out, hole: oh, w: nw, h: nh };
}

/** Number of hole pixels in each pixel's patch window, via a summed-area table. */
function holeCounts({ hole, w, h }) {
  const S = new Int32Array((w + 1) * (h + 1));
  for (let y = 0; y < h; y++) {
    let row = 0;
    for (let x = 0; x < w; x++) {
      row += hole[y * w + x];
      S[(y + 1) * (w + 1) + x + 1] = S[y * (w + 1) + x + 1] + row;
    }
  }
  const counts = new Int32Array(w * h);
  for (let y = 0; y < h; y++) {
    const y0 = Math.max(0, y - R);
    const y1 = Math.min(h, y + R + 1);
    for (let x = 0; x < w; x++) {
      const x0 = Math.max(0, x - R);
      const x1 = Math.min(w, x + R + 1);
      counts[y * w + x] = S[y1 * (w + 1) + x1] - S[y0 * (w + 1) + x1] - S[y1 * (w + 1) + x0] + S[y0 * (w + 1) + x0];
    }
  }
  return counts;
}

/** First guess for the coarsest hole: grow inwards ring by ring, averaging filled neighbours. */
function diffuse({ img, hole, w, h }) {
  const done = new Uint8Array(w * h);
  let frontier = [];
  for (let p = 0; p < w * h; p++) {
    if (!hole[p]) done[p] = 1;
    else frontier.push(p);
  }
  while (frontier.length) {
    const next = [];
    const set = [];
    for (const p of frontier) {
      const x = p % w;
      const y = (p - x) / w;
      const s = [0, 0, 0, 0];
      let n = 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx;
          const yy = y + dy;
          if ((!dx && !dy) || xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
          const q = yy * w + xx;
          if (!done[q]) continue;
          for (let c = 0; c < 4; c++) s[c] += img[q * 4 + c];
          n++;
        }
      }
      if (n) set.push(p, s[0] / n, s[1] / n, s[2] / n, s[3] / n);
      else next.push(p);
    }
    if (!set.length) break; // nothing known at all
    for (let k = 0; k < set.length; k += 5) {
      const p = set[k];
      for (let c = 0; c < 4; c++) img[p * 4 + c] = set[k + 1 + c];
      done[p] = 1;
    }
    frontier = next;
  }
}

/** Sum of squared differences between the patches at t and s, giving up past `limit`. */
function patchDistance(img, w, h, tx, ty, sx, sy, limit) {
  let d = 0;
  for (let dy = -R; dy <= R; dy++) {
    const y = ty + dy;
    if (y < 0 || y >= h) continue;
    const rowT = y * w;
    const rowS = (sy + dy) * w;
    for (let dx = -R; dx <= R; dx++) {
      const x = tx + dx;
      if (x < 0 || x >= w) continue;
      const i = (rowT + x) * 4;
      const j = (rowS + sx + dx) * 4;
      const a = img[i] - img[j];
      const b = img[i + 1] - img[j + 1];
      const c = img[i + 2] - img[j + 2];
      const e = img[i + 3] - img[j + 3];
      d += a * a + b * b + c * c + e * e;
    }
    if (d >= limit) return d;
  }
  return d;
}

/**
 * Fill the hole. img: RGBA bytes (w × h); hole: nonzero where to fill.
 * onProgress(fraction) is called as work completes. Returns new RGBA bytes,
 * identical outside the hole.
 */
export function inpaint(img, hole, w, h, { onProgress = null, seed = 1 } = {}) {
  const rand = rng(seed);
  const base = { img: Float32Array.from(img), hole: Uint8Array.from(hole, (v) => (v ? 1 : 0)), w, h };
  // Pyramid down until the hole is a few pixels across (or the image gets too small).
  const extent = (lev) => {
    let x0 = lev.w, y0 = lev.h, x1 = -1, y1 = -1;
    for (let y = 0; y < lev.h; y++) {
      for (let x = 0; x < lev.w; x++) {
        if (!lev.hole[y * lev.w + x]) continue;
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
    return x1 < 0 ? 0 : Math.max(x1 - x0 + 1, y1 - y0 + 1);
  };
  if (!extent(base)) return new Uint8ClampedArray(img);
  const levels = [base];
  while (levels.length < 12) {
    const top = levels[levels.length - 1];
    if (extent(top) <= 8 || Math.min(top.w, top.h) / 2 < 6 * (2 * R + 1)) break;
    levels.push(downsample(top));
  }

  // Work estimate for progress: targets × EM passes, per level.
  const L = levels.length;
  const passes = (l) => (l === L - 1 ? 8 : Math.max(2, 5 - (L - 1 - l)));
  const counts = levels.map(holeCounts);
  const targetsOf = (l) => {
    const t = [];
    const c = counts[l];
    for (let p = 0; p < c.length; p++) if (c[p] > 0) t.push(p);
    return Int32Array.from(t);
  };
  const targets = levels.map((_, l) => targetsOf(l));
  const total = levels.reduce((s, _, l) => s + targets[l].length * passes(l), 0) || 1;
  let doneWork = 0;

  let prev = null; // coarser level's { nnf, w, h }
  for (let l = L - 1; l >= 0; l--) {
    const lev = levels[l];
    const { img: I, hole: M, w: lw, h: lh } = lev;
    const T = targets[l];
    const cnt = counts[l];
    // Valid sources: patches fully inside the image with no hole pixel.
    const valid = new Uint8Array(lw * lh);
    const sources = [];
    for (let y = R; y < lh - R; y++) {
      for (let x = R; x < lw - R; x++) {
        const p = y * lw + x;
        if (!cnt[p]) {
          valid[p] = 1;
          sources.push(p);
        }
      }
    }
    // Starting colours for the hole.
    if (l === L - 1) diffuse(lev);
    else {
      const up = levels[l + 1];
      for (let p = 0; p < lw * lh; p++) {
        if (!M[p]) continue;
        const x = p % lw;
        const y = (p - x) / lw;
        const q = (Math.min(up.h - 1, y >> 1) * up.w + Math.min(up.w - 1, x >> 1)) * 4;
        for (let c = 0; c < 4; c++) I[p * 4 + c] = up.img[q + c];
      }
    }
    if (!sources.length || !T.length) {
      prev = null;
      doneWork += T.length * passes(l);
      continue;
    }

    // Nearest-neighbour field: the source centre for each target centre.
    const nx = new Int32Array(lw * lh).fill(-1);
    const ny = new Int32Array(lw * lh).fill(-1);
    const nd = new Float32Array(lw * lh);
    const randomSource = (p) => {
      const s = sources[Math.floor(rand() * sources.length)];
      nx[p] = s % lw;
      ny[p] = (s - nx[p]) / lw;
    };
    for (const p of T) {
      const x = p % lw;
      const y = (p - x) / lw;
      let ok = false;
      if (prev) {
        // Carry the coarser match up a level.
        const cp = Math.min(prev.h - 1, y >> 1) * prev.w + Math.min(prev.w - 1, x >> 1);
        if (prev.nx[cp] >= 0) {
          const sx = 2 * prev.nx[cp] + (x & 1);
          const sy = 2 * prev.ny[cp] + (y & 1);
          if (sx < lw && sy < lh && valid[sy * lw + sx]) {
            nx[p] = sx;
            ny[p] = sy;
            ok = true;
          }
        }
      }
      if (!ok) randomSource(p);
      nd[p] = patchDistance(I, lw, lh, x, y, nx[p], ny[p], Infinity);
    }

    const tryMatch = (p, x, y, sx, sy) => {
      if (sx < 0 || sy < 0 || sx >= lw || sy >= lh || !valid[sy * lw + sx]) return;
      if (sx === nx[p] && sy === ny[p]) return;
      const d = patchDistance(I, lw, lh, x, y, sx, sy, nd[p]);
      if (d < nd[p]) {
        nd[p] = d;
        nx[p] = sx;
        ny[p] = sy;
      }
    };
    const patchMatch = (iterations) => {
      const span = Math.max(lw, lh);
      for (let it = 0; it < iterations; it++) {
        const fwd = it % 2 === 0;
        const step = fwd ? 1 : -1;
        for (let k = 0; k < T.length; k++) {
          const p = T[fwd ? k : T.length - 1 - k];
          const x = p % lw;
          const y = (p - x) / lw;
          // Propagation: a neighbour's match, shifted by one, often fits here too.
          const xn = x - step;
          if (xn >= 0 && xn < lw && nx[p - step] >= 0) tryMatch(p, x, y, nx[p - step] + step, ny[p - step]);
          const yn = y - step;
          const q = p - step * lw;
          if (yn >= 0 && yn < lh && nx[q] >= 0) tryMatch(p, x, y, nx[q], ny[q] + step);
          // Random search in shrinking windows around the best match so far.
          for (let r = span; r >= 1; r >>= 1) {
            tryMatch(p, x, y, nx[p] + Math.round((rand() * 2 - 1) * r), ny[p] + Math.round((rand() * 2 - 1) * r));
          }
        }
      }
    };

    // Voting: each hole pixel becomes the weighted average of what the
    // patches covering it say it should be; closer matches count more.
    const acc = new Float32Array(lw * lh * 4);
    const wsum = new Float32Array(lw * lh);
    const vote = () => {
      acc.fill(0);
      wsum.fill(0);
      const sample = [];
      for (let k = 0; k < T.length; k += Math.max(1, Math.floor(T.length / 500))) sample.push(nd[T[k]]);
      sample.sort((a, b) => a - b);
      const sigma2 = Math.max(1, sample[Math.floor(sample.length * 0.75)] / ((2 * R + 1) ** 2));
      for (const p of T) {
        const x = p % lw;
        const y = (p - x) / lw;
        const sx = nx[p];
        const sy = ny[p];
        const wt = Math.exp(-nd[p] / ((2 * R + 1) ** 2) / (2 * sigma2)) + 1e-6;
        for (let dy = -R; dy <= R; dy++) {
          const yy = y + dy;
          if (yy < 0 || yy >= lh) continue;
          for (let dx = -R; dx <= R; dx++) {
            const xx = x + dx;
            if (xx < 0 || xx >= lw) continue;
            const q = yy * lw + xx;
            if (!M[q]) continue;
            const s = ((sy + dy) * lw + sx + dx) * 4;
            acc[q * 4] += I[s] * wt;
            acc[q * 4 + 1] += I[s + 1] * wt;
            acc[q * 4 + 2] += I[s + 2] * wt;
            acc[q * 4 + 3] += I[s + 3] * wt;
            wsum[q] += wt;
          }
        }
      }
      for (let q = 0; q < lw * lh; q++) {
        if (!M[q] || !wsum[q]) continue;
        for (let c = 0; c < 4; c++) I[q * 4 + c] = acc[q * 4 + c] / wsum[q];
      }
      // The hole changed, so the stored distances are stale.
      for (const p of T) {
        const x = p % lw;
        nd[p] = patchDistance(I, lw, lh, x, (p - x) / lw, nx[p], ny[p], Infinity);
      }
    };

    const n = passes(l);
    for (let em = 0; em < n; em++) {
      patchMatch(l === L - 1 && em === 0 ? 4 : 2);
      vote();
      doneWork += T.length;
      onProgress?.(Math.min(1, doneWork / total));
    }
    prev = { nx, ny, w: lw, h: lh };
  }

  const out = new Uint8ClampedArray(img);
  const I = levels[0].img;
  for (let p = 0; p < w * h; p++) {
    if (!base.hole[p]) continue;
    for (let c = 0; c < 4; c++) out[p * 4 + c] = I[p * 4 + c];
  }
  return out;
}
