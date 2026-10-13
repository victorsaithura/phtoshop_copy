import { h, button } from './dom.js';
import { histogram, histogramRange, curveLUT } from '../core/pixels.js';
import { LEVELS_IDENTITY } from '../core/adjustments.js';
import { clamp } from '../core/utils.js';

const CHANNELS = [
  { value: 'rgb', label: 'RGB' },
  { value: 'r', label: 'Red' },
  { value: 'g', label: 'Green' },
  { value: 'b', label: 'Blue' },
];
const CHANNEL_COLOR = { rgb: '#d0d0d0', r: '#ff6060', g: '#5fd35f', b: '#6b9bff' };

function channelSelect(p, onChange) {
  const sel = h('select', { value: p.channel, 'aria-label': 'Channel' },
    CHANNELS.map((c) => h('option', { value: c.value }, c.label)));
  sel.addEventListener('change', () => {
    p.channel = sel.value;
    onChange();
  });
  return sel;
}

/** Match a canvas's backing store to its CSS size; returns false while it is hidden. */
function fitCanvas(canvas) {
  const dpr = window.devicePixelRatio || 1;
  const w = Math.round(canvas.clientWidth * dpr);
  const hh = Math.round(canvas.clientHeight * dpr);
  if (!w || !hh) return false;
  if (canvas.width !== w || canvas.height !== hh) {
    canvas.width = w;
    canvas.height = hh;
  }
  return true;
}

function drawHistogram(ctx, hist, w, hh, color, alpha = 1) {
  // Scale to the second-highest bin when one spike (e.g. a plain background) dominates.
  let top = 0;
  let second = 0;
  for (let i = 0; i < 256; i++) {
    if (hist[i] > top) [top, second] = [hist[i], top];
    else if (hist[i] > second) second = hist[i];
  }
  const max = top > second * 4 && second ? second * 1.5 : top;
  if (!max) return;
  ctx.globalAlpha = alpha;
  ctx.fillStyle = color;
  const bw = w / 256;
  for (let i = 0; i < 256; i++) {
    const bh = Math.min(hh, (hist[i] / max) * hh);
    ctx.fillRect(i * bw, hh - bh, Math.ceil(bw), bh);
  }
  ctx.globalAlpha = 1;
}

/** Row of draggable triangles; markers: [{ color, get(), set(v) }] with values 0–255. */
function markerStrip(markers, onDrag, extraClass = '') {
  const el = h('div', { class: `marker-strip ${extraClass}` });
  const tris = markers.map((m) => {
    const t = h('div', { class: 'marker' });
    t.style.setProperty('--c', m.color);
    el.append(t);
    return t;
  });
  let active = -1;
  const valueAt = (e) => {
    const r = el.getBoundingClientRect();
    return clamp(Math.round(((e.clientX - r.left) / r.width) * 255), 0, 255);
  };
  el.addEventListener('pointerdown', (e) => {
    const v = valueAt(e);
    let best = Infinity;
    markers.forEach((m, i) => {
      const d = Math.abs(m.get() - v);
      if (d < best || (d === best && v > m.get())) {
        best = d;
        active = i;
      }
    });
    el.setPointerCapture(e.pointerId);
    markers[active].set(v);
    onDrag();
  });
  el.addEventListener('pointermove', (e) => {
    if (active < 0) return;
    markers[active].set(valueAt(e));
    onDrag();
  });
  for (const ev of ['pointerup', 'pointercancel']) el.addEventListener(ev, () => { active = -1; });
  const layout = () => markers.forEach((m, i) => { tris[i].style.left = `${(m.get() / 255) * 100}%`; });
  return { el, layout };
}

function numberField(label, min, max, step, onChange) {
  const input = h('input', { type: 'number', min, max, step, 'aria-label': label, title: label });
  input.addEventListener('change', () => onChange(clamp(Number(input.value) || 0, min, max)));
  return input;
}

/* ---------- Levels ---------- */

export function levelsUI(edit, p, onChange) {
  const hists = histogram(edit.src, edit.mask);
  const canvas = h('canvas', { class: 'histogram' });
  const ch = () => p[p.channel];

  const changed = () => {
    refresh();
    onChange();
  };
  const set = (key, v) => {
    const c = ch();
    if (key === 'inB') c.inB = Math.min(v, c.inW - 2);
    else if (key === 'inW') c.inW = Math.max(v, c.inB + 2);
    else c[key] = v;
    changed();
  };

  const inB = numberField('Input black', 0, 253, 1, (v) => set('inB', v));
  const gamma = numberField('Midtones (gamma)', 0.1, 9.99, 0.01, (v) => set('gamma', v));
  const inW = numberField('Input white', 2, 255, 1, (v) => set('inW', v));
  const outB = numberField('Output black', 0, 255, 1, (v) => set('outB', v));
  const outW = numberField('Output white', 0, 255, 1, (v) => set('outW', v));

  const inputMarkers = markerStrip([
    { color: '#000000', get: () => ch().inB, set: (v) => { ch().inB = Math.min(v, ch().inW - 2); } },
    {
      color: '#808080',
      get: () => ch().inB + (ch().inW - ch().inB) * Math.pow(0.5, ch().gamma),
      set: (v) => {
        const c = ch();
        const t = clamp((v - c.inB) / (c.inW - c.inB), 0.01, 0.99);
        c.gamma = Math.round(clamp(Math.log(t) / Math.log(0.5), 0.1, 9.99) * 100) / 100;
      },
    },
    { color: '#ffffff', get: () => ch().inW, set: (v) => { ch().inW = Math.max(v, ch().inB + 2); } },
  ], changed);
  const outputMarkers = markerStrip([
    { color: '#000000', get: () => ch().outB, set: (v) => { ch().outB = v; } },
    { color: '#ffffff', get: () => ch().outW, set: (v) => { ch().outW = v; } },
  ], changed, 'output');

  function draw() {
    if (!fitCanvas(canvas)) return;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    drawHistogram(ctx, hists[p.channel], canvas.width, canvas.height, CHANNEL_COLOR[p.channel]);
  }

  function refresh() {
    const c = ch();
    inB.value = c.inB;
    gamma.value = c.gamma.toFixed(2);
    inW.value = c.inW;
    outB.value = c.outB;
    outW.value = c.outW;
    inputMarkers.layout();
    outputMarkers.layout();
    draw();
  }

  const select = channelSelect(p, refresh);
  const auto = button({
    label: 'Auto', title: 'Stretch each channel to its full range',
    onClick: () => {
      for (const c of ['r', 'g', 'b']) {
        const [lo, hi] = histogramRange(hists[c]);
        p[c] = { ...LEVELS_IDENTITY, inB: lo, inW: hi };
      }
      p.rgb = { ...LEVELS_IDENTITY };
      changed();
    },
  });
  const reset = button({ label: 'Reset', title: 'Reset this channel', onClick: () => { p[p.channel] = { ...LEVELS_IDENTITY }; changed(); } });

  new ResizeObserver(draw).observe(canvas);
  setTimeout(refresh);
  return h('div', { class: 'adjust-controls' },
    h('label', { class: 'adjust-inline' }, 'Channel', select),
    h('div', { class: 'adjust-heading' }, 'Input Levels'),
    h('div', {}, canvas, inputMarkers.el),
    h('div', { class: 'levels-fields' }, inB, gamma, inW),
    h('div', { class: 'adjust-heading' }, 'Output Levels'),
    outputMarkers.el,
    h('div', { class: 'levels-fields' }, outB, outW),
    h('div', { class: 'adjust-inline' }, auto, reset));
}

/* ---------- Curves ---------- */

const CURVE_PRESETS = [
  { value: 'default', label: 'Default', points: [[0, 0], [255, 255]] },
  { value: 'contrast', label: 'Increase Contrast', points: [[0, 0], [64, 48], [192, 208], [255, 255]] },
  { value: 'strong', label: 'Strong Contrast', points: [[0, 0], [64, 32], [192, 224], [255, 255]] },
  { value: 'lighter', label: 'Lighter', points: [[0, 0], [128, 160], [255, 255]] },
  { value: 'darker', label: 'Darker', points: [[0, 0], [128, 96], [255, 255]] },
  { value: 'negative', label: 'Negative', points: [[0, 255], [255, 0]] },
];

export function curvesUI(edit, p, onChange) {
  const hists = histogram(edit.src, edit.mask);
  const canvas = h('canvas', { class: 'curves-canvas', 'aria-label': 'Curve editor' });
  let selected = -1;
  let drag = false;
  const pts = () => p[p.channel];

  const inField = numberField('Input', 0, 255, 1, (v) => editPoint(v, null));
  const outField = numberField('Output', 0, 255, 1, (v) => editPoint(null, v));
  const preset = h('select', { 'aria-label': 'Preset' },
    h('option', { value: '' }, 'Custom'),
    CURVE_PRESETS.map((c) => h('option', { value: c.value }, c.label)));
  preset.addEventListener('change', () => {
    const found = CURVE_PRESETS.find((c) => c.value === preset.value);
    if (!found) return;
    p[p.channel] = found.points.map((pt) => [...pt]);
    selected = -1;
    changed();
  });
  const select = channelSelect(p, () => {
    selected = -1;
    refresh();
  });

  function changed() {
    refresh();
    onChange();
  }

  /** Move point i to (x, y), keeping it between its neighbours. */
  function placePoint(i, x, y) {
    const list = pts();
    const lo = i > 0 ? list[i - 1][0] + 1 : 0;
    const hi = i < list.length - 1 ? list[i + 1][0] - 1 : 255;
    list[i] = [clamp(Math.round(x), lo, hi), clamp(Math.round(y), 0, 255)];
  }

  function editPoint(x, y) {
    if (selected < 0) return;
    const [ox, oy] = pts()[selected];
    placePoint(selected, x ?? ox, y ?? oy);
    preset.value = '';
    changed();
  }

  const toCurve = (e) => {
    const r = canvas.getBoundingClientRect();
    return {
      x: ((e.clientX - r.left) / r.width) * 255,
      y: (1 - (e.clientY - r.top) / r.height) * 255,
      outside: e.clientX < r.left - 24 || e.clientX > r.right + 24 || e.clientY < r.top - 24 || e.clientY > r.bottom + 24,
      scale: r.width / 255,
    };
  };

  canvas.addEventListener('pointerdown', (e) => {
    const c = toCurve(e);
    const list = pts();
    let best = -1;
    let bestD = 10 / c.scale; // 10 CSS px
    list.forEach(([x, y], i) => {
      const d = Math.hypot(x - c.x, y - c.y);
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    });
    if (best < 0) {
      const x = clamp(Math.round(c.x), 0, 255);
      if (list.some((pt) => pt[0] === x)) return;
      list.push([x, clamp(Math.round(c.y), 0, 255)]);
      list.sort((a, b) => a[0] - b[0]);
      best = list.findIndex((pt) => pt[0] === x);
    }
    selected = best;
    drag = true;
    preset.value = '';
    canvas.setPointerCapture(e.pointerId);
    changed();
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!drag || selected < 0) return;
    const c = toCurve(e);
    const list = pts();
    // Dragging an inner point off the graph removes it.
    if (c.outside && selected > 0 && selected < list.length - 1) {
      list.splice(selected, 1);
      selected = -1;
      drag = false;
      changed();
      return;
    }
    placePoint(selected, c.x, c.y);
    changed();
  });
  for (const ev of ['pointerup', 'pointercancel']) canvas.addEventListener(ev, () => { drag = false; });

  function draw() {
    if (!fitCanvas(canvas)) return;
    const ctx = canvas.getContext('2d');
    const W = canvas.width;
    const H = canvas.height;
    const dpr = window.devicePixelRatio || 1;
    ctx.clearRect(0, 0, W, H);
    drawHistogram(ctx, hists[p.channel], W, H, '#555', 0.8);
    ctx.strokeStyle = 'rgba(255,255,255,0.12)';
    ctx.lineWidth = dpr;
    ctx.beginPath();
    for (let i = 1; i < 4; i++) {
      ctx.moveTo((W * i) / 4, 0);
      ctx.lineTo((W * i) / 4, H);
      ctx.moveTo(0, (H * i) / 4);
      ctx.lineTo(W, (H * i) / 4);
    }
    ctx.moveTo(0, H);
    ctx.lineTo(W, 0);
    ctx.stroke();

    const lut = curveLUT(pts());
    ctx.strokeStyle = CHANNEL_COLOR[p.channel];
    ctx.lineWidth = 2 * dpr;
    ctx.beginPath();
    for (let i = 0; i < 256; i++) {
      const x = (i / 255) * W;
      const y = H - (lut[i] / 255) * H;
      if (i) ctx.lineTo(x, y);
      else ctx.moveTo(x, y);
    }
    ctx.stroke();

    pts().forEach(([x, y], i) => {
      const s = 7 * dpr;
      const cx = (x / 255) * W;
      const cy = H - (y / 255) * H;
      ctx.fillStyle = i === selected ? '#ffffff' : '#1c1c1c';
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = dpr;
      ctx.fillRect(cx - s / 2, cy - s / 2, s, s);
      ctx.strokeRect(cx - s / 2, cy - s / 2, s, s);
    });
  }

  function refresh() {
    const pt = selected >= 0 ? pts()[selected] : null;
    inField.disabled = outField.disabled = !pt;
    inField.value = pt ? pt[0] : '';
    outField.value = pt ? pt[1] : '';
    draw();
  }

  const reset = button({
    label: 'Reset', title: 'Reset this channel',
    onClick: () => {
      p[p.channel] = [[0, 0], [255, 255]];
      selected = -1;
      preset.value = 'default';
      changed();
    },
  });

  new ResizeObserver(draw).observe(canvas);
  setTimeout(refresh);
  return h('div', { class: 'adjust-controls' },
    h('div', { class: 'adjust-inline' }, h('label', {}, 'Preset ', preset), h('label', {}, 'Channel ', select)),
    canvas,
    h('div', { class: 'levels-fields' }, h('label', {}, 'Input ', inField), h('label', {}, 'Output ', outField), reset),
    h('div', { class: 'form-note' }, 'Click to add a point, drag to shape the curve, drag a point off the graph to remove it.'));
}
