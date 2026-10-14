import { rectIntersect } from './utils.js';

/*
 * Filter ▸ Distort. Each filter is an inverse map: for every output pixel it
 * says where in the source the colour comes from, and warpImage resamples.
 */

/** Add a bilinear sample of premultiplied colour, weighted by wt, to acc (edge pixels repeat). */
function sample(s, w, h, px, py, wt, acc) {
  let fx = px - 0.5;
  let fy = py - 0.5;
  if (fx < 0) fx = 0;
  else if (fx > w - 1) fx = w - 1;
  if (fy < 0) fy = 0;
  else if (fy > h - 1) fy = h - 1;
  const x0 = Math.floor(fx);
  const y0 = Math.floor(fy);
  const tx = fx - x0;
  const ty = fy - y0;
  const i = (y0 * w + x0) * 4;
  const i10 = x0 < w - 1 ? i + 4 : i;
  const i01 = y0 < h - 1 ? i + w * 4 : i;
  const i11 = x0 < w - 1 ? i01 + 4 : i01;
  const a00 = s[i + 3] * (1 - tx) * (1 - ty) * wt, a10 = s[i10 + 3] * tx * (1 - ty) * wt;
  const a01 = s[i01 + 3] * (1 - tx) * ty * wt, a11 = s[i11 + 3] * tx * ty * wt;
  acc[0] += s[i] * a00 + s[i10] * a10 + s[i01] * a01 + s[i11] * a11;
  acc[1] += s[i + 1] * a00 + s[i10 + 1] * a10 + s[i01 + 1] * a01 + s[i11 + 1] * a11;
  acc[2] += s[i + 2] * a00 + s[i10 + 2] * a10 + s[i01 + 2] * a01 + s[i11 + 2] * a11;
  acc[3] += a00 + a10 + a01 + a11;
}

/**
 * Resample `img` in place through an inverse map. map(x, y, out) receives an
 * output pixel centre (image coordinates, pixel i spans i…i+1) and writes the
 * source position to out[0], out[1]. Colour is sampled bilinearly from
 * premultiplied values, with up to 4×4 samples where the map squeezes the
 * image so strong distortions stay smooth, and edge pixels repeat past the
 * border. Only pixels inside `area` change.
 */
export function warpImage(img, map, area = null) {
  const { width: w, height: h, data: d } = img;
  const a = rectIntersect(area || { x: 0, y: 0, w, h }, { x: 0, y: 0, w, h });
  if (!a) return img;
  const s = new Uint8ClampedArray(d);
  const acc = new Float64Array(4);
  // How many samples to take along a step of `len` source pixels: bilinear
  // copes with a mild squeeze, and a huge step is a seam in the map (Polar
  // Coordinates wrapping round), not a squeeze.
  const count = (len) => (len <= 1.5 || len > 64 ? 1 : Math.min(4, Math.ceil(len)));

  // Mapped positions of this row's pixel centres and the next row's, one extra
  // column on the right, so each pixel knows where its neighbours land.
  const n = a.w + 1;
  let cur = new Float64Array(n * 2);
  let next = new Float64Array(n * 2);
  const out = [0, 0];
  const fill = (buf, y) => {
    for (let i = 0; i < n; i++) {
      map(a.x + i + 0.5, y + 0.5, out);
      buf[i * 2] = out[0];
      buf[i * 2 + 1] = out[1];
    }
  };
  fill(cur, a.y);
  for (let y = a.y; y < a.y + a.h; y++) {
    fill(next, y + 1);
    for (let i = 0; i < a.w; i++) {
      const x = a.x + i;
      const sx = cur[i * 2];
      const sy = cur[i * 2 + 1];
      if (sx === x + 0.5 && sy === y + 0.5) continue; // not moved: keep the pixel exactly
      const ux = cur[i * 2 + 2] - sx, uy = cur[i * 2 + 3] - sy;
      const vx = next[i * 2] - sx, vy = next[i * 2 + 1] - sy;
      const nu = count(Math.sqrt(ux * ux + uy * uy));
      const nv = count(Math.sqrt(vx * vx + vy * vy));
      acc[0] = acc[1] = acc[2] = acc[3] = 0;
      if (nu === 1 && nv === 1) sample(s, w, h, sx, sy, 1, acc);
      else {
        const wt = 1 / (nu * nv);
        for (let j = 0; j < nv; j++) {
          const fv = (j + 0.5) / nv - 0.5;
          for (let k = 0; k < nu; k++) {
            const fu = (k + 0.5) / nu - 0.5;
            sample(s, w, h, sx + ux * fu + vx * fv, sy + uy * fu + vy * fv, wt, acc);
          }
        }
      }
      const o = (y * w + x) * 4;
      const al = acc[3];
      if (al <= 0) {
        d[o] = d[o + 1] = d[o + 2] = d[o + 3] = 0;
      } else {
        d[o] = acc[0] / al;
        d[o + 1] = acc[1] / al;
        d[o + 2] = acc[2] / al;
        d[o + 3] = al;
      }
    }
    [cur, next] = [next, cur];
  }
  return img;
}

/**
 * The rectangle a distortion is centred on, in the image's own coordinates:
 * the selection's bounds, or else the part of the layer on the canvas.
 */
export function distortFrame(ctx) {
  const reg = ctx.region;
  const f = ctx.selection || rectIntersect(reg, { x: 0, y: 0, w: ctx.docWidth, h: ctx.docHeight }) || reg;
  return { x: f.x - reg.x, y: f.y - reg.y, w: f.w, h: f.h };
}

/**
 * Inverse map for a radial distortion inside the ellipse that fills `f`.
 * fn(u, v, r, out) gets normalised coordinates (the rim is r = 1) and writes
 * the normalised source position; points outside the ellipse stay put.
 */
function radial(f, fn) {
  const cx = f.x + f.w / 2;
  const cy = f.y + f.h / 2;
  const rx = f.w / 2;
  const ry = f.h / 2;
  const uv = [0, 0];
  return (x, y, out) => {
    const u = (x - cx) / rx;
    const v = (y - cy) / ry;
    const r = Math.sqrt(u * u + v * v);
    if (r >= 1 || r === 0) {
      out[0] = x;
      out[1] = y;
      return;
    }
    fn(u, v, r, uv);
    out[0] = cx + uv[0] * rx;
    out[1] = cy + uv[1] * ry;
  };
}

/** Wave shapes over one cycle per unit of t, between −1 and 1. */
const WAVES = {
  sine: (t) => Math.sin(2 * Math.PI * t),
  triangle: (t) => {
    const f = (((t + 0.25) % 1) + 1) % 1;
    return 1 - 2 * Math.abs(2 * f - 1);
  },
  square: (t) => (Math.sin(2 * Math.PI * t) >= 0 ? 1 : -1),
};

const RIPPLE_SIZES = { small: 10, medium: 20, large: 40 };

const slider = (key, label, min, max, value, step = 1, unit = '') => ({ key, label, min, max, value, step, unit });
const choice = (key, label, value, options) => ({
  key, label, type: 'select', value, options: options.map(([v, l]) => ({ value: v, label: l })),
});

export function twirl(img, angle, frame) {
  const k = (angle * Math.PI) / 180;
  // The twist is strongest at the centre and eases out to nothing at the rim.
  return warpImage(img, radial(frame, (u, v, r, o) => {
    const t = 1 - r;
    const th = -k * t * t;
    const c = Math.cos(th);
    const s = Math.sin(th);
    o[0] = u * c - v * s;
    o[1] = u * s + v * c;
  }), frame);
}

export function pinch(img, amount, frame) {
  const p = (amount / 100) * 0.8;
  return warpImage(img, radial(frame, (u, v, r, o) => {
    // > 1 reads from further out, drawing the image in towards the centre.
    const f = Math.pow(Math.sin((Math.PI / 2) * r), -p);
    o[0] = u * f;
    o[1] = v * f;
  }), frame);
}

export function spherize(img, amount, mode, frame) {
  const a = amount / 100;
  // Source radius for an output radius r in 0…1: positive amounts magnify the
  // middle like a glass ball, negative ones shrink it like the inside of a bowl.
  const bend = a >= 0
    ? (r) => r + ((Math.asin(r) * 2) / Math.PI - r) * a
    : (r) => r + (Math.sin((r * Math.PI) / 2) - r) * -a;
  if (mode === 'normal') {
    return warpImage(img, radial(frame, (u, v, r, o) => {
      const f = bend(r) / r;
      o[0] = u * f;
      o[1] = v * f;
    }), frame);
  }
  // Horizontal or vertical only: a cylinder across the whole frame.
  const horiz = mode === 'horizontal';
  const c = horiz ? frame.x + frame.w / 2 : frame.y + frame.h / 2;
  const half = (horiz ? frame.w : frame.h) / 2;
  return warpImage(img, (x, y, out) => {
    const t = ((horiz ? x : y) - c) / half;
    const m = t < 0 ? -bend(-t) : bend(t);
    out[0] = horiz ? c + m * half : x;
    out[1] = horiz ? y : c + m * half;
  }, frame);
}

/** Ripple-glass wobble; ox, oy place the image in the document so the pattern stays put. */
export function ripple(img, amount, size, ox = 0, oy = 0) {
  const len = RIPPLE_SIZES[size] || RIPPLE_SIZES.medium;
  const amp = ((amount / 100) * len) / 10;
  const k = (2 * Math.PI) / len;
  return warpImage(img, (x, y, out) => {
    const X = x + ox;
    const Y = y + oy;
    // Each wave is bent by a slower one, so the pattern looks less mechanical.
    out[0] = x + amp * Math.sin(k * (Y + 0.35 * len * Math.sin((k * X) / 3.1)));
    out[1] = y + amp * Math.sin(k * (X + 0.35 * len * Math.sin((k * Y) / 2.7)));
  });
}

export function wave(img, { type, wavelength, amplitude, direction }, ox = 0, oy = 0) {
  const fn = WAVES[type] || WAVES.sine;
  const dx = direction !== 'vertical';
  const dy = direction !== 'horizontal';
  return warpImage(img, (x, y, out) => {
    out[0] = dx ? x + amplitude * fn((y + oy) / wavelength) : x;
    out[1] = dy ? y + amplitude * fn((x + ox) / wavelength) : y;
  });
}

export function zigzag(img, amount, ridges, style, frame) {
  const amp = (amount / 100) * 0.12;
  return warpImage(img, radial(frame, (u, v, r, o) => {
    // Rings that fade out towards the rim.
    const ring = Math.sin(2 * Math.PI * ridges * r) * (1 - r);
    let f = 1;
    let th = 0;
    if (style !== 'around') f = (r + amp * ring) / r;
    if (style === 'around') th = amp * 4 * ring;
    else if (style === 'pond') th = amp * 2 * Math.cos(2 * Math.PI * ridges * r) * (1 - r);
    const c = Math.cos(th) * f;
    const s = Math.sin(th) * f;
    o[0] = u * c - v * s;
    o[1] = u * s + v * c;
  }), frame);
}

export function polarCoordinates(img, conversion, frame) {
  const cx = frame.x + frame.w / 2;
  const cy = frame.y + frame.h / 2;
  const TAU = 2 * Math.PI;
  if (conversion === 'polarToRect') {
    return warpImage(img, (x, y, out) => {
      const th = ((x - frame.x) / frame.w) * TAU;
      const r = (y - frame.y) / frame.h;
      out[0] = cx + r * Math.sin(th) * (frame.w / 2);
      out[1] = cy - r * Math.cos(th) * (frame.h / 2);
    }, frame);
  }
  // Rectangular to Polar: the top edge gathers at the centre, the bottom edge
  // runs round the rim, and the left and right edges meet at 12 o'clock.
  return warpImage(img, (x, y, out) => {
    const u = (x - cx) / (frame.w / 2);
    const v = (y - cy) / (frame.h / 2);
    let th = Math.atan2(u, -v);
    if (th < 0) th += TAU;
    out[0] = frame.x + (th / TAU) * frame.w;
    out[1] = frame.y + Math.sqrt(u * u + v * v) * frame.h;
  }, frame);
}

/** Filter ▸ Distort definitions, merged into FILTERS. */
export const DISTORT_FILTERS = {
  pinch: {
    title: 'Pinch', group: 'Distort',
    params: [slider('amount', 'Amount', -100, 100, 50, 1, '%')],
    apply: (img, p, ctx) => pinch(img, p.amount, distortFrame(ctx)),
  },
  polarCoordinates: {
    title: 'Polar Coordinates', group: 'Distort',
    params: [choice('conversion', 'Conversion', 'rectToPolar',
      [['rectToPolar', 'Rectangular to Polar'], ['polarToRect', 'Polar to Rectangular']])],
    apply: (img, p, ctx) => polarCoordinates(img, p.conversion, distortFrame(ctx)),
  },
  ripple: {
    title: 'Ripple', group: 'Distort',
    params: [
      slider('amount', 'Amount', -999, 999, 100, 1, '%'),
      choice('size', 'Size', 'medium', [['small', 'Small'], ['medium', 'Medium'], ['large', 'Large']]),
    ],
    margin: (p) => Math.ceil((Math.abs(p.amount) / 100) * (RIPPLE_SIZES.large / 10)) + 2,
    apply: (img, p, ctx) => ripple(img, p.amount, p.size, ctx.region.x, ctx.region.y),
  },
  spherize: {
    title: 'Spherize', group: 'Distort',
    params: [
      slider('amount', 'Amount', -100, 100, 100, 1, '%'),
      choice('mode', 'Mode', 'normal', [['normal', 'Normal'], ['horizontal', 'Horizontal Only'], ['vertical', 'Vertical Only']]),
    ],
    apply: (img, p, ctx) => spherize(img, p.amount, p.mode, distortFrame(ctx)),
  },
  twirl: {
    title: 'Twirl', group: 'Distort',
    params: [slider('angle', 'Angle', -999, 999, 50, 1, '°')],
    apply: (img, p, ctx) => twirl(img, p.angle, distortFrame(ctx)),
  },
  wave: {
    title: 'Wave', group: 'Distort',
    params: [
      choice('type', 'Type', 'sine', [['sine', 'Sine'], ['triangle', 'Triangle'], ['square', 'Square']]),
      slider('wavelength', 'Wavelength', 2, 999, 120, 1, 'px'),
      slider('amplitude', 'Amplitude', 1, 200, 10, 1, 'px'),
      choice('direction', 'Direction', 'both', [['both', 'Both'], ['horizontal', 'Horizontal'], ['vertical', 'Vertical']]),
    ],
    margin: (p) => Math.ceil(p.amplitude) + 2,
    apply: (img, p, ctx) => wave(img, p, ctx.region.x, ctx.region.y),
  },
  zigzag: {
    title: 'ZigZag', group: 'Distort',
    params: [
      slider('amount', 'Amount', -100, 100, 10),
      slider('ridges', 'Ridges', 1, 20, 5),
      choice('style', 'Style', 'pond', [['pond', 'Pond Ripples'], ['out', 'Out From Center'], ['around', 'Around Center']]),
    ],
    apply: (img, p, ctx) => zigzag(img, p.amount, p.ridges, p.style, distortFrame(ctx)),
  },
};
