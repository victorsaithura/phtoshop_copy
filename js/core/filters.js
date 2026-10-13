import { clamp255, copyImageData, luma, mulberry32 } from './pixels.js';
import { createCanvas } from './utils.js';

/* ---------- Blur building blocks ---------- */

function premultiply(d) {
  for (let i = 0; i < d.length; i += 4) {
    const a = d[i + 3];
    if (a === 255) continue;
    d[i] = (d[i] * a) / 255;
    d[i + 1] = (d[i + 1] * a) / 255;
    d[i + 2] = (d[i + 2] * a) / 255;
  }
}

function unpremultiply(d) {
  for (let i = 0; i < d.length; i += 4) {
    const a = d[i + 3];
    if (a === 255 || a === 0) continue;
    d[i] = (d[i] * 255) / a;
    d[i + 1] = (d[i + 1] * 255) / a;
    d[i + 2] = (d[i + 2] * 255) / a;
  }
}

/** One box-blur pass along rows or columns, clamping at the edges. O(1) per pixel. */
function boxPass(src, dst, w, h, r, horizontal) {
  if (r <= 0) {
    dst.set(src);
    return;
  }
  const inv = 1 / (2 * r + 1);
  const n = horizontal ? w : h;
  const lines = horizontal ? h : w;
  const step = horizontal ? 4 : w * 4;
  const last = n - 1;
  for (let line = 0; line < lines; line++) {
    const base = horizontal ? line * w * 4 : line * 4;
    let s0 = 0, s1 = 0, s2 = 0, s3 = 0;
    for (let k = -r; k <= r; k++) {
      const idx = base + (k < 0 ? 0 : k > last ? last : k) * step;
      s0 += src[idx];
      s1 += src[idx + 1];
      s2 += src[idx + 2];
      s3 += src[idx + 3];
    }
    for (let x = 0; x < n; x++) {
      const o = base + x * step;
      dst[o] = s0 * inv;
      dst[o + 1] = s1 * inv;
      dst[o + 2] = s2 * inv;
      dst[o + 3] = s3 * inv;
      const ai = x + r + 1;
      const si = x - r;
      const add = base + (ai > last ? last : ai) * step;
      const sub = base + (si < 0 ? 0 : si) * step;
      s0 += src[add] - src[sub];
      s1 += src[add + 1] - src[sub + 1];
      s2 += src[add + 2] - src[sub + 2];
      s3 += src[add + 3] - src[sub + 3];
    }
  }
}

/** Box widths whose repeated application approximates a Gaussian of `sigma`. */
function boxesForGauss(sigma, n = 3) {
  const wIdeal = Math.sqrt((12 * sigma * sigma) / n + 1);
  let wl = Math.floor(wIdeal);
  if (wl % 2 === 0) wl--;
  const wu = wl + 2;
  const m = Math.round((12 * sigma * sigma - n * wl * wl - 4 * n * wl - 3 * n) / (-4 * wl - 4));
  return Array.from({ length: n }, (_, i) => (i < m ? wl : wu));
}

function blurBoxes(img, radii) {
  const { width: w, height: h, data } = img;
  premultiply(data);
  const tmp = new Uint8ClampedArray(data.length);
  for (const r of radii) {
    boxPass(data, tmp, w, h, r, true);
    boxPass(tmp, data, w, h, r, false);
  }
  unpremultiply(data);
  return img;
}

export function gaussianBlur(img, radius) {
  if (radius < 0.3) return img;
  return blurBoxes(img, boxesForGauss(radius).map((s) => (s - 1) / 2));
}

export function boxBlur(img, radius) {
  return blurBoxes(img, [Math.max(0, Math.round(radius))]);
}

/** Averages copies shifted along the angle (GPU-accelerated via canvas). */
export function motionBlur(img, angleDeg, distance) {
  const { width: w, height: h } = img;
  if (distance < 1) return img;
  const pad = Math.ceil(distance / 2) + 1;
  const base = createCanvas(w, h);
  base.getContext('2d').putImageData(img, 0, 0);
  // Padded copy with the edge pixels stretched outwards, so edges don't fade.
  const src = createCanvas(w + pad * 2, h + pad * 2);
  const s = src.getContext('2d');
  s.imageSmoothingEnabled = false;
  s.drawImage(base, pad, pad);
  s.drawImage(base, 0, 0, 1, h, 0, pad, pad, h);
  s.drawImage(base, w - 1, 0, 1, h, pad + w, pad, pad, h);
  s.drawImage(src, 0, pad, w + pad * 2, 1, 0, 0, w + pad * 2, pad);
  s.drawImage(src, 0, pad + h - 1, w + pad * 2, 1, 0, pad + h, w + pad * 2, pad);

  const out = createCanvas(w, h, { readFrequently: true });
  const o = out.getContext('2d', { willReadFrequently: true });
  const steps = Math.max(2, Math.min(64, Math.round(distance)));
  const rad = (angleDeg * Math.PI) / 180;
  const ux = Math.cos(rad);
  const uy = -Math.sin(rad);
  for (let i = 0; i < steps; i++) {
    const t = (i / (steps - 1) - 0.5) * distance;
    o.globalAlpha = 1 / (i + 1); // running average
    o.drawImage(src, -pad + ux * t, -pad + uy * t);
  }
  return o.getImageData(0, 0, w, h);
}

export function unsharpMask(img, amount, radius, threshold) {
  const blurred = gaussianBlur(copyImageData(img), radius).data;
  const d = img.data;
  const k = amount / 100;
  for (let i = 0; i < d.length; i += 4) {
    for (let c = 0; c < 3; c++) {
      const diff = d[i + c] - blurred[i + c];
      if (Math.abs(diff) >= threshold) d[i + c] = d[i + c] + diff * k;
    }
  }
  return img;
}

export function addNoise(img, amount, distribution, mono, seed = 1) {
  const rand = mulberry32(seed);
  const amp = (amount / 100) * 127;
  const gauss = () => Math.sqrt(-2 * Math.log(rand() || 1e-9)) * Math.cos(2 * Math.PI * rand()) * (amp / 2);
  const uniform = () => (rand() * 2 - 1) * amp;
  const noise = distribution === 'gaussian' ? gauss : uniform;
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    if (mono) {
      const n = noise();
      d[i] += n;
      d[i + 1] += n;
      d[i + 2] += n;
    } else {
      d[i] += noise();
      d[i + 1] += noise();
      d[i + 2] += noise();
    }
  }
  return img;
}

/** Square cells aligned to the document grid (ox, oy = image origin in the document). */
export function mosaic(img, size, ox = 0, oy = 0) {
  const { width: w, height: h, data: d } = img;
  const sx = -(((ox % size) + size) % size);
  const sy = -(((oy % size) + size) % size);
  for (let cy = sy; cy < h; cy += size) {
    for (let cx = sx; cx < w; cx += size) {
      const x0 = Math.max(0, cx), y0 = Math.max(0, cy);
      const x1 = Math.min(w, cx + size), y1 = Math.min(h, cy + size);
      let r = 0, g = 0, b = 0, a = 0, n = 0;
      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
          const i = (y * w + x) * 4;
          const al = d[i + 3];
          r += d[i] * al;
          g += d[i + 1] * al;
          b += d[i + 2] * al;
          a += al;
          n++;
        }
      }
      if (!n) continue;
      const ar = a ? r / a : 0, ag = a ? g / a : 0, ab = a ? b / a : 0, aa = a / n;
      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
          const i = (y * w + x) * 4;
          d[i] = ar;
          d[i + 1] = ag;
          d[i + 2] = ab;
          d[i + 3] = aa;
        }
      }
    }
  }
  return img;
}

export function emboss(img, angleDeg, height, amount) {
  const { width: w, height: h } = img;
  const src = copyImageData(img).data;
  const d = img.data;
  const rad = (angleDeg * Math.PI) / 180;
  const dx = Math.round(Math.cos(rad) * height);
  const dy = Math.round(-Math.sin(rad) * height);
  const k = amount / 100;
  const at = (x, y) => {
    const i = ((y < 0 ? 0 : y >= h ? h - 1 : y) * w + (x < 0 ? 0 : x >= w ? w - 1 : x)) * 4;
    return luma(src[i], src[i + 1], src[i + 2]);
  };
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const v = 128 + (at(x + dx, y + dy) - at(x - dx, y - dy)) * k;
      const i = (y * w + x) * 4;
      d[i] = d[i + 1] = d[i + 2] = v;
    }
  }
  return img;
}

/** Sobel edges per channel, drawn dark on white like Photoshop's Find Edges. */
export function findEdges(img) {
  const { width: w, height: h } = img;
  const s = copyImageData(img).data;
  const d = img.data;
  for (let y = 0; y < h; y++) {
    const rowUp = (y > 0 ? y - 1 : 0) * w;
    const row = y * w;
    const rowDown = (y < h - 1 ? y + 1 : y) * w;
    for (let x = 0; x < w; x++) {
      const xl = x > 0 ? x - 1 : 0;
      const xr = x < w - 1 ? x + 1 : x;
      // 3×3 neighbourhood (edges clamped): tl t tr / l · r / bl b br
      const tl = (rowUp + xl) * 4, t = (rowUp + x) * 4, tr = (rowUp + xr) * 4;
      const l = (row + xl) * 4, r = (row + xr) * 4;
      const bl = (rowDown + xl) * 4, b = (rowDown + x) * 4, br = (rowDown + xr) * 4;
      const i = (row + x) * 4;
      for (let c = 0; c < 3; c++) {
        const gx = s[tr + c] + 2 * s[r + c] + s[br + c] - s[tl + c] - 2 * s[l + c] - s[bl + c];
        const gy = s[bl + c] + 2 * s[b + c] + s[br + c] - s[tl + c] - 2 * s[t + c] - s[tr + c];
        d[i + c] = 255 - Math.min(255, Math.sqrt(gx * gx + gy * gy) / 2);
      }
    }
  }
  return img;
}

/** Darken (amount < 0) or lighten the corners of the document. */
export function vignette(img, amount, midpoint, region, docW, docH) {
  const { width: w, height: h, data: d } = img;
  const cx = docW / 2 - region.x;
  const cy = docH / 2 - region.y;
  const inner = (midpoint / 100) * 0.95;
  const a = amount / 100;
  for (let y = 0; y < h; y++) {
    const ny = (y + 0.5 - cy) / (docH / 2);
    for (let x = 0; x < w; x++) {
      const nx = (x + 0.5 - cx) / (docW / 2);
      const dist = Math.sqrt(nx * nx + ny * ny) / Math.SQRT2;
      let t = (dist - inner) / (1 - inner || 1);
      t = t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t);
      if (!t) continue;
      const i = (y * w + x) * 4;
      for (let c = 0; c < 3; c++) {
        const v = d[i + c];
        d[i + c] = a < 0 ? v * (1 + a * t) : v + (255 - v) * a * t;
      }
    }
  }
  return img;
}

export function highPass(img, radius) {
  const blurred = gaussianBlur(copyImageData(img), radius).data;
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    d[i] = clamp255(d[i] - blurred[i] + 128);
    d[i + 1] = clamp255(d[i + 1] - blurred[i + 1] + 128);
    d[i + 2] = clamp255(d[i + 2] - blurred[i + 2] + 128);
  }
  return img;
}

/* ---------- Filter menu definitions ---------- */

const slider = (key, label, min, max, value, step = 1, unit = '') => ({ key, label, min, max, value, step, unit });

/*
 * margin(params): extra pixels around a selection the filter needs to read.
 * apply(imageData, params, ctx) returns the filtered ImageData.
 */
export const FILTERS = {
  gaussianBlur: {
    title: 'Gaussian Blur', group: 'Blur',
    params: [slider('radius', 'Radius', 0.1, 250, 2, 0.1, 'px')],
    margin: (p) => Math.ceil(p.radius * 3),
    apply: (img, p) => gaussianBlur(img, p.radius),
  },
  motionBlur: {
    title: 'Motion Blur', group: 'Blur',
    params: [slider('angle', 'Angle', -90, 90, 0, 1, '°'), slider('distance', 'Distance', 1, 500, 20, 1, 'px')],
    margin: (p) => p.distance,
    apply: (img, p) => motionBlur(img, p.angle, p.distance),
  },
  boxBlur: {
    title: 'Box Blur', group: 'Blur',
    params: [slider('radius', 'Radius', 1, 500, 5, 1, 'px')],
    margin: (p) => p.radius * 2,
    apply: (img, p) => boxBlur(img, p.radius),
  },
  sharpen: {
    title: 'Sharpen', group: 'Sharpen',
    margin: () => 4,
    apply: (img) => unsharpMask(img, 60, 1, 0),
  },
  unsharpMask: {
    title: 'Unsharp Mask', group: 'Sharpen',
    params: [
      slider('amount', 'Amount', 1, 500, 100, 1, '%'),
      slider('radius', 'Radius', 0.1, 100, 1, 0.1, 'px'),
      slider('threshold', 'Threshold', 0, 255, 0, 1, 'levels'),
    ],
    margin: (p) => Math.ceil(p.radius * 3),
    apply: (img, p) => unsharpMask(img, p.amount, p.radius, p.threshold),
  },
  addNoise: {
    title: 'Add Noise', group: 'Noise',
    params: [
      slider('amount', 'Amount', 0.1, 400, 12.5, 0.1, '%'),
      { key: 'distribution', label: 'Distribution', type: 'select', value: 'uniform',
        options: [{ value: 'uniform', label: 'Uniform' }, { value: 'gaussian', label: 'Gaussian' }] },
      { key: 'mono', label: 'Monochromatic', type: 'checkbox', value: false },
    ],
    apply: (img, p) => addNoise(img, p.amount, p.distribution, p.mono),
  },
  mosaic: {
    title: 'Mosaic', group: 'Pixelate',
    params: [slider('size', 'Cell Size', 2, 200, 10, 1, 'px')],
    margin: (p) => p.size,
    apply: (img, p, ctx) => mosaic(img, p.size, ctx.region.x, ctx.region.y),
  },
  emboss: {
    title: 'Emboss', group: 'Stylize',
    params: [
      slider('angle', 'Angle', -180, 180, 135, 1, '°'),
      slider('height', 'Height', 1, 100, 3, 1, 'px'),
      slider('amount', 'Amount', 1, 500, 100, 1, '%'),
    ],
    margin: (p) => p.height + 1,
    apply: (img, p) => emboss(img, p.angle, p.height, p.amount),
  },
  findEdges: {
    title: 'Find Edges', group: 'Stylize',
    margin: () => 2,
    apply: (img) => findEdges(img),
  },
  vignette: {
    title: 'Vignette', group: 'Render',
    params: [slider('amount', 'Amount', -100, 100, -50), slider('midpoint', 'Midpoint', 0, 100, 50)],
    apply: (img, p, ctx) => vignette(img, p.amount, p.midpoint, ctx.region, ctx.docWidth, ctx.docHeight),
  },
  highPass: {
    title: 'High Pass', group: 'Other',
    params: [slider('radius', 'Radius', 0.1, 250, 10, 0.1, 'px')],
    margin: (p) => Math.ceil(p.radius * 3),
    apply: (img, p) => highPass(img, p.radius),
  },
};
