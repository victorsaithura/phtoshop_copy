import {
  applyLUT, clamp01, clamp255, composeLUT, curveLUT, histogram, histogramRange, hslToRgb, luma, makeLUT, rgbToHsl,
} from './pixels.js';
import { hexToRgb } from './utils.js';

/*
 * Image ▸ Adjustments. Each entry:
 *   title, params (dialog controls) or custom ('levels' | 'curves'),
 *   apply(imageData, params, ctx) → imageData
 * ctx: { fg, bg, mask } — mask is the selection alpha for the pixels, if any.
 */

export const LEVELS_IDENTITY = { inB: 0, inW: 255, gamma: 1, outB: 0, outW: 255 };

export function levelsLUT({ inB, inW, gamma, outB, outW }) {
  const range = Math.max(1, inW - inB);
  return makeLUT((v) => outB + (outW - outB) * Math.pow(clamp01((v - inB) / range), 1 / gamma));
}

/** Per-channel LUTs followed by the composite (RGB) one. */
function channelLUTs(state, toLUT) {
  const master = toLUT(state.rgb);
  return ['r', 'g', 'b'].map((c) => composeLUT(toLUT(state[c]), master));
}

const toLinear = (c) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
const toSRGB = (l) => (l <= 0.0031308 ? l * 12.92 : 1.055 * Math.pow(l, 1 / 2.4) - 0.055);

// Colour balance transfer curves (after GIMP's classic tool).
const CB = (() => {
  const sa = new Float32Array(256), ss = new Float32Array(256), m = new Float32Array(256);
  const ha = new Float32Array(256), hs = new Float32Array(256);
  for (let i = 0; i < 256; i++) {
    const low = 1.075 - 1 / (i / 16 + 1);
    const mid = 0.667 * (1 - ((i - 127) / 127) ** 2);
    sa[i] = low;
    ss[255 - i] = low;
    m[i] = mid;
    ha[255 - i] = low;
    hs[i] = low;
  }
  return { sa, ss, m, ha, hs };
})();

function balanceLUT(s, mid, h) {
  return makeLUT((v) => {
    let x = v;
    x = clamp255(x + s * (s > 0 ? CB.sa : CB.ss)[Math.round(x)]);
    x = clamp255(x + mid * CB.m[Math.round(x)]);
    x = clamp255(x + h * (h > 0 ? CB.ha : CB.hs)[Math.round(x)]);
    return x;
  });
}

const slider = (key, label, min, max, value = 0, step = 1, unit = '') => ({ key, label, min, max, value, step, unit });

export const ADJUSTMENTS = {
  brightnessContrast: {
    title: 'Brightness/Contrast',
    params: [slider('brightness', 'Brightness', -150, 150), slider('contrast', 'Contrast', -50, 100)],
    apply(img, p) {
      const gamma = Math.pow(2, -p.brightness / 120);
      const k = p.contrast >= 0 ? 1 + (p.contrast / 100) * 1.5 : 1 + p.contrast / 100;
      return applyLUT(img, makeLUT((v) => ((Math.pow(v / 255, gamma) - 0.5) * k + 0.5) * 255));
    },
  },

  levels: {
    title: 'Levels',
    custom: 'levels',
    defaults: () => ({
      channel: 'rgb', rgb: { ...LEVELS_IDENTITY }, r: { ...LEVELS_IDENTITY }, g: { ...LEVELS_IDENTITY }, b: { ...LEVELS_IDENTITY },
    }),
    apply(img, p) {
      const [r, g, b] = channelLUTs(p, levelsLUT);
      return applyLUT(img, r, g, b);
    },
  },

  curves: {
    title: 'Curves',
    custom: 'curves',
    defaults: () => {
      const line = () => [[0, 0], [255, 255]];
      return { channel: 'rgb', rgb: line(), r: line(), g: line(), b: line() };
    },
    apply(img, p) {
      const [r, g, b] = channelLUTs(p, curveLUT);
      return applyLUT(img, r, g, b);
    },
  },

  exposure: {
    title: 'Exposure',
    params: [
      slider('exposure', 'Exposure', -5, 5, 0, 0.01),
      slider('offset', 'Offset', -0.5, 0.5, 0, 0.001),
      slider('gamma', 'Gamma Correction', 0.1, 9.99, 1, 0.01),
    ],
    apply(img, p) {
      const mul = Math.pow(2, p.exposure);
      return applyLUT(img, makeLUT((v) => {
        const lin = Math.max(0, toLinear(v / 255) * mul + p.offset);
        return toSRGB(clamp01(Math.pow(lin, 1 / p.gamma))) * 255;
      }));
    },
  },

  vibrance: {
    title: 'Vibrance',
    params: [slider('vibrance', 'Vibrance', -100, 100), slider('saturation', 'Saturation', -100, 100)],
    apply(img, p) {
      const d = img.data;
      const vib = p.vibrance / 100;
      const sat = p.saturation / 100;
      for (let i = 0; i < d.length; i += 4) {
        const r = d[i], g = d[i + 1], b = d[i + 2];
        const max = Math.max(r, g, b);
        const s = (max - Math.min(r, g, b)) / 255;
        // Vibrance boosts muted colours more than already-saturated ones.
        const f = (1 + sat) * (1 + vib * (1 - s));
        const L = luma(r, g, b);
        d[i] = L + (r - L) * f;
        d[i + 1] = L + (g - L) * f;
        d[i + 2] = L + (b - L) * f;
      }
      return img;
    },
  },

  hueSaturation: {
    title: 'Hue/Saturation',
    params: [
      slider('hue', 'Hue', -180, 180),
      slider('saturation', 'Saturation', -100, 100),
      slider('lightness', 'Lightness', -100, 100),
      { key: 'colorize', label: 'Colorize', type: 'checkbox', value: false },
    ],
    apply(img, p) {
      const d = img.data;
      const hsl = [0, 0, 0];
      const rgb = [0, 0, 0];
      const dh = p.hue / 360;
      const ds = p.saturation / 100;
      const dl = p.lightness / 100;
      const tintH = ((p.hue + 360) % 360) / 360;
      const tintS = (p.saturation + 100) / 200;
      for (let i = 0; i < d.length; i += 4) {
        rgbToHsl(d[i], d[i + 1], d[i + 2], hsl);
        let [h, s, l] = hsl;
        if (p.colorize) {
          h = tintH;
          s = tintS;
        } else {
          h = (h + dh + 1) % 1;
          s = clamp01(ds >= 0 ? s * (1 + 2 * ds) : s * (1 + ds));
        }
        l = dl >= 0 ? l + (1 - l) * dl : l * (1 + dl);
        hslToRgb(h, s, l, rgb);
        d[i] = rgb[0];
        d[i + 1] = rgb[1];
        d[i + 2] = rgb[2];
      }
      return img;
    },
  },

  colorBalance: {
    title: 'Color Balance',
    params: [
      { type: 'heading', label: 'Shadows' },
      slider('sCR', 'Cyan ↔ Red', -100, 100), slider('sMG', 'Magenta ↔ Green', -100, 100), slider('sYB', 'Yellow ↔ Blue', -100, 100),
      { type: 'heading', label: 'Midtones' },
      slider('mCR', 'Cyan ↔ Red', -100, 100), slider('mMG', 'Magenta ↔ Green', -100, 100), slider('mYB', 'Yellow ↔ Blue', -100, 100),
      { type: 'heading', label: 'Highlights' },
      slider('hCR', 'Cyan ↔ Red', -100, 100), slider('hMG', 'Magenta ↔ Green', -100, 100), slider('hYB', 'Yellow ↔ Blue', -100, 100),
      { key: 'preserve', label: 'Preserve Luminosity', type: 'checkbox', value: true },
    ],
    apply(img, p) {
      const lr = balanceLUT(p.sCR, p.mCR, p.hCR);
      const lg = balanceLUT(p.sMG, p.mMG, p.hMG);
      const lb = balanceLUT(p.sYB, p.mYB, p.hYB);
      const d = img.data;
      const a = [0, 0, 0];
      const b2 = [0, 0, 0];
      for (let i = 0; i < d.length; i += 4) {
        const r = d[i], g = d[i + 1], b = d[i + 2];
        let nr = lr[r], ng = lg[g], nb = lb[b];
        if (p.preserve) {
          rgbToHsl(r, g, b, a);
          rgbToHsl(nr, ng, nb, b2);
          hslToRgb(b2[0], b2[1], a[2], b2);
          [nr, ng, nb] = b2;
        }
        d[i] = nr;
        d[i + 1] = ng;
        d[i + 2] = nb;
      }
      return img;
    },
  },

  blackWhite: {
    title: 'Black & White',
    params: [
      slider('reds', 'Reds', -200, 300, 40, 1, '%'),
      slider('yellows', 'Yellows', -200, 300, 60, 1, '%'),
      slider('greens', 'Greens', -200, 300, 40, 1, '%'),
      slider('cyans', 'Cyans', -200, 300, 60, 1, '%'),
      slider('blues', 'Blues', -200, 300, 20, 1, '%'),
      slider('magentas', 'Magentas', -200, 300, 80, 1, '%'),
      { key: 'tint', label: 'Tint', type: 'checkbox', value: false },
      slider('tintHue', 'Tint Hue', 0, 360, 42, 1, '°'),
      slider('tintSat', 'Tint Saturation', 0, 100, 20, 1, '%'),
    ],
    apply(img, p) {
      const w = { R: p.reds / 100, Y: p.yellows / 100, G: p.greens / 100, C: p.cyans / 100, B: p.blues / 100, M: p.magentas / 100 };
      const d = img.data;
      const rgb = [0, 0, 0];
      const th = p.tintHue / 360;
      const ts = p.tintSat / 100;
      for (let i = 0; i < d.length; i += 4) {
        const r = d[i], g = d[i + 1], b = d[i + 2];
        // grey = min + (mid - min) × secondary weight + (max - mid) × primary weight
        let gray;
        if (r >= g && r >= b) gray = g >= b ? b + (g - b) * w.Y + (r - g) * w.R : g + (b - g) * w.M + (r - b) * w.R;
        else if (g >= r && g >= b) gray = r >= b ? b + (r - b) * w.Y + (g - r) * w.G : r + (b - r) * w.C + (g - b) * w.G;
        else gray = r >= g ? g + (r - g) * w.M + (b - r) * w.B : r + (g - r) * w.C + (b - g) * w.B;
        gray = clamp255(gray);
        if (p.tint) {
          hslToRgb(th, ts, gray / 255, rgb);
          d[i] = rgb[0];
          d[i + 1] = rgb[1];
          d[i + 2] = rgb[2];
        } else {
          d[i] = d[i + 1] = d[i + 2] = gray;
        }
      }
      return img;
    },
  },

  photoFilter: {
    title: 'Photo Filter',
    params: [
      { key: 'color', label: 'Filter color', type: 'color', value: '#ec8a00' },
      slider('density', 'Density', 1, 100, 25, 1, '%'),
      { key: 'preserve', label: 'Preserve Luminosity', type: 'checkbox', value: true },
    ],
    apply(img, p) {
      const c = hexToRgb(p.color);
      const k = p.density / 100;
      const d = img.data;
      for (let i = 0; i < d.length; i += 4) {
        const r = d[i], g = d[i + 1], b = d[i + 2];
        let nr = r + (r * c.r / 255 - r) * k * 2;
        let ng = g + (g * c.g / 255 - g) * k * 2;
        let nb = b + (b * c.b / 255 - b) * k * 2;
        if (p.preserve) {
          const shift = luma(r, g, b) - luma(nr, ng, nb);
          nr += shift;
          ng += shift;
          nb += shift;
        }
        d[i] = nr;
        d[i + 1] = ng;
        d[i + 2] = nb;
      }
      return img;
    },
  },

  invert: {
    title: 'Invert',
    apply: (img) => applyLUT(img, makeLUT((v) => 255 - v)),
  },

  posterize: {
    title: 'Posterize',
    params: [slider('levels', 'Levels', 2, 255, 4)],
    apply(img, p) {
      const n = p.levels - 1;
      return applyLUT(img, makeLUT((v) => (Math.round((v / 255) * n) / n) * 255));
    },
  },

  threshold: {
    title: 'Threshold',
    params: [slider('level', 'Threshold Level', 1, 255, 128)],
    apply(img, p) {
      const d = img.data;
      for (let i = 0; i < d.length; i += 4) {
        d[i] = d[i + 1] = d[i + 2] = luma(d[i], d[i + 1], d[i + 2]) >= p.level ? 255 : 0;
      }
      return img;
    },
  },

  gradientMap: {
    title: 'Gradient Map',
    params: [{ key: 'reverse', label: 'Reverse (uses the foreground → background colors)', type: 'checkbox', value: false }],
    apply(img, p, ctx) {
      let a = hexToRgb(ctx.fg);
      let b = hexToRgb(ctx.bg);
      if (p.reverse) [a, b] = [b, a];
      const lr = makeLUT((v) => a.r + (b.r - a.r) * (v / 255));
      const lg = makeLUT((v) => a.g + (b.g - a.g) * (v / 255));
      const lb = makeLUT((v) => a.b + (b.b - a.b) * (v / 255));
      const d = img.data;
      for (let i = 0; i < d.length; i += 4) {
        const t = Math.round(luma(d[i], d[i + 1], d[i + 2]));
        d[i] = lr[t];
        d[i + 1] = lg[t];
        d[i + 2] = lb[t];
      }
      return img;
    },
  },

  desaturate: {
    title: 'Desaturate',
    apply(img) {
      const d = img.data;
      for (let i = 0; i < d.length; i += 4) {
        const r = d[i], g = d[i + 1], b = d[i + 2];
        d[i] = d[i + 1] = d[i + 2] = (Math.max(r, g, b) + Math.min(r, g, b)) / 2;
      }
      return img;
    },
  },

  autoTone: {
    title: 'Auto Tone',
    apply(img, p, ctx) {
      const h = histogram(img, ctx.mask);
      const lut = (hist) => {
        const [lo, hi] = histogramRange(hist);
        return levelsLUT({ ...LEVELS_IDENTITY, inB: lo, inW: hi });
      };
      return applyLUT(img, lut(h.r), lut(h.g), lut(h.b));
    },
  },

  autoContrast: {
    title: 'Auto Contrast',
    apply(img, p, ctx) {
      const h = histogram(img, ctx.mask);
      const all = new Uint32Array(256);
      for (let i = 0; i < 256; i++) all[i] = h.r[i] + h.g[i] + h.b[i];
      const [lo, hi] = histogramRange(all);
      return applyLUT(img, levelsLUT({ ...LEVELS_IDENTITY, inB: lo, inW: hi }));
    },
  },
};

/** Default parameter values for an adjustment or filter definition. */
export function defaultParams(def) {
  if (def.defaults) return def.defaults();
  const p = {};
  for (const c of def.params || []) if (c.key) p[c.key] = c.value;
  return p;
}
