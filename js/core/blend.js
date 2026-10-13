/*
 * Blend modes in JavaScript (W3C Compositing and Blending formulas), for work
 * the canvas cannot do in one step: adjustment layers and layer-style effects
 * that blend with the pixels under them. Mode names match canvas
 * globalCompositeOperation values ('source-over' = Normal).
 */

const lum = (r, g, b) => 0.3 * r + 0.59 * g + 0.11 * b;

function clipColor(c) {
  const l = lum(c[0], c[1], c[2]);
  const n = Math.min(c[0], c[1], c[2]);
  const x = Math.max(c[0], c[1], c[2]);
  if (n < 0) for (let i = 0; i < 3; i++) c[i] = l + ((c[i] - l) * l) / (l - n || 1);
  if (x > 1) for (let i = 0; i < 3; i++) c[i] = l + ((c[i] - l) * (1 - l)) / (x - l || 1);
  return c;
}

function setLum(c, l) {
  const d = l - lum(c[0], c[1], c[2]);
  c[0] += d;
  c[1] += d;
  c[2] += d;
  return clipColor(c);
}

const sat = (c) => Math.max(c[0], c[1], c[2]) - Math.min(c[0], c[1], c[2]);

function setSat(c, s) {
  const idx = [0, 1, 2].sort((a, b) => c[a] - c[b]);
  const [lo, mid, hi] = idx;
  if (c[hi] > c[lo]) {
    c[mid] = ((c[mid] - c[lo]) * s) / (c[hi] - c[lo]);
    c[hi] = s;
  } else {
    c[mid] = c[hi] = 0;
  }
  c[lo] = 0;
  return c;
}

const softLightD = (b) => (b <= 0.25 ? ((16 * b - 12) * b + 4) * b : Math.sqrt(b));

/** Separable modes: f(backdrop, source) per channel, values 0–1. */
const SEPARABLE = {
  'source-over': (b, s) => s,
  multiply: (b, s) => b * s,
  screen: (b, s) => b + s - b * s,
  overlay: (b, s) => (b <= 0.5 ? 2 * b * s : 1 - 2 * (1 - b) * (1 - s)),
  darken: (b, s) => Math.min(b, s),
  lighten: (b, s) => Math.max(b, s),
  'color-dodge': (b, s) => (b === 0 ? 0 : s >= 1 ? 1 : Math.min(1, b / (1 - s))),
  'color-burn': (b, s) => (b >= 1 ? 1 : s <= 0 ? 0 : 1 - Math.min(1, (1 - b) / s)),
  'hard-light': (b, s) => (s <= 0.5 ? 2 * b * s : 1 - 2 * (1 - b) * (1 - s)),
  'soft-light': (b, s) => (s <= 0.5 ? b - (1 - 2 * s) * b * (1 - b) : b + (2 * s - 1) * (softLightD(b) - b)),
  difference: (b, s) => Math.abs(b - s),
  exclusion: (b, s) => b + s - 2 * b * s,
};

const tmpB = [0, 0, 0];
const tmpS = [0, 0, 0];
const tmpC = [0, 0, 0];
const copy3 = (c) => {
  tmpC[0] = c[0];
  tmpC[1] = c[1];
  tmpC[2] = c[2];
  return tmpC;
};

const NON_SEPARABLE = {
  hue: (B, S) => setLum(setSat(S, sat(B)), lum(B[0], B[1], B[2])),
  saturation: (B, S) => setLum(setSat(copy3(B), sat(S)), lum(B[0], B[1], B[2])),
  color: (B, S) => setLum(S, lum(B[0], B[1], B[2])),
  luminosity: (B, S) => setLum(copy3(B), lum(S[0], S[1], S[2])),
};

/**
 * Returns blend(br, bg, bb, sr, sg, sb, out) for a mode: backdrop and source
 * colours 0–255, result written to out[0..2] (0–255).
 */
export function blendFn(mode) {
  const f = SEPARABLE[mode];
  if (f) {
    return (br, bg, bb, sr, sg, sb, out) => {
      out[0] = f(br / 255, sr / 255) * 255;
      out[1] = f(bg / 255, sg / 255) * 255;
      out[2] = f(bb / 255, sb / 255) * 255;
      return out;
    };
  }
  const g = NON_SEPARABLE[mode] || NON_SEPARABLE.color;
  return (br, bg, bb, sr, sg, sb, out) => {
    tmpB[0] = br / 255; tmpB[1] = bg / 255; tmpB[2] = bb / 255;
    tmpS[0] = sr / 255; tmpS[1] = sg / 255; tmpS[2] = sb / 255;
    const c = g(tmpB, tmpS);
    out[0] = c[0] * 255;
    out[1] = c[1] * 255;
    out[2] = c[2] * 255;
    return out;
  };
}
