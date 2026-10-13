import { h, iconButton } from './dom.js';
import { MIN_ZOOM, MAX_ZOOM } from '../core/viewport.js';
import { createCanvas, debounce } from '../core/utils.js';

const shown = (el) => el.offsetParent !== null;

/** Navigator: the whole image with the visible area outlined; click or drag to move there. */
export class NavigatorPanel {
  constructor(app) {
    this.app = app;
    this.canvas = h('canvas', { class: 'nav-canvas', width: 240, height: 150, 'aria-label': 'Navigator — click or drag to move the view' });
    this.thumb = null;
    this.stale = true;
    this.slider = h('input', { type: 'range', class: 'range', min: 0, max: 1000, 'aria-label': 'Zoom' });
    this.label = h('span', { class: 'nav-zoom' });
    this.el = h('div', { class: 'navigator' }, this.canvas,
      h('div', { class: 'nav-row' },
        iconButton('zoom-out', 'Zoom out', () => app.runAction('view.zoomOut')),
        this.slider,
        iconButton('zoom-in', 'Zoom in', () => app.runAction('view.zoomIn')),
        this.label));

    const ratio = Math.log(MAX_ZOOM / MIN_ZOOM);
    this.slider.addEventListener('input', () => {
      if (!app.doc) return;
      app.view.setZoom(MIN_ZOOM * Math.exp((this.slider.value / 1000) * ratio));
      app.viewChanged();
    });
    const pan = (e) => {
      const doc = app.doc;
      if (!doc || !this.layout) return;
      const r = this.canvas.getBoundingClientRect();
      const { ox, oy, s } = this.layout;
      const k = this.canvas.width / r.width;
      const dx = ((e.clientX - r.left) * k - ox) / s;
      const dy = ((e.clientY - r.top) * k - oy) / s;
      const v = app.view;
      v.panX = v.width / 2 - dx * v.zoom;
      v.panY = v.height / 2 - dy * v.zoom;
      app.viewChanged();
    };
    this.canvas.addEventListener('pointerdown', (e) => {
      this.canvas.setPointerCapture(e.pointerId);
      pan(e);
      const move = (ev) => pan(ev);
      const up = () => {
        this.canvas.removeEventListener('pointermove', move);
        this.canvas.removeEventListener('pointerup', up);
      };
      this.canvas.addEventListener('pointermove', move);
      this.canvas.addEventListener('pointerup', up);
    });
    this.sliderSync = () => {
      const z = app.view.zoom;
      this.slider.value = Math.round((Math.log(z / MIN_ZOOM) / ratio) * 1000);
      this.label.textContent = app.doc ? `${Math.round(z * 1000) / 10}%` : '';
    };
    const refresh = debounce(() => this.refresh(), 250);
    app.on('pixels', () => {
      this.stale = true;
      refresh();
    });
    app.on('document', () => {
      this.stale = true;
      this.refresh();
    });
    app.on('view', () => this.draw());
  }

  onShow() { this.refresh(); }

  refresh() {
    if (!shown(this.el)) return;
    const doc = this.app.doc;
    if (doc && this.stale) {
      const W = this.canvas.width;
      const H = this.canvas.height;
      const s = Math.min(W / doc.width, H / doc.height);
      const w = Math.max(1, Math.round(doc.width * s));
      const hh = Math.max(1, Math.round(doc.height * s));
      this.layout = { s, ox: Math.floor((W - w) / 2), oy: Math.floor((H - hh) / 2), w, h: hh };
      this.thumb = createCanvas(w, hh);
      const t = this.thumb.getContext('2d');
      t.imageSmoothingQuality = 'high';
      t.drawImage(this.app.renderer.getComposite(), 0, 0, w, hh);
      this.stale = false;
    }
    this.draw();
  }

  draw() {
    this.sliderSync();
    if (!shown(this.el)) return;
    const ctx = this.canvas.getContext('2d');
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    const doc = this.app.doc;
    if (!doc || !this.thumb) return;
    const { s, ox, oy, w, h: hh } = this.layout;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(ox, oy, w, hh);
    ctx.drawImage(this.thumb, ox, oy);
    const v = this.app.view;
    const a = v.screenToDoc(0, 0);
    const b = v.screenToDoc(v.width, v.height);
    ctx.strokeStyle = '#ff3b30';
    ctx.lineWidth = 2;
    ctx.strokeRect(ox + a.x * s, oy + a.y * s, (b.x - a.x) * s, (b.y - a.y) * s);
  }
}

/** Info: pointer position, the colour under it, and the selection size. */
export class InfoPanel {
  constructor(app) {
    this.app = app;
    const val = () => h('span', { class: 'info-val' });
    this.rgb = { r: val(), g: val(), b: val(), hex: val() };
    this.pos = { x: val(), y: val() };
    this.sel = { w: val(), h: val() };
    this.swatch = h('span', { class: 'info-swatch' });
    const pair = (k, el) => h('div', { class: 'info-pair' }, h('span', { class: 'info-key' }, k), el);
    this.el = h('div', { class: 'info-grid' },
      h('div', { class: 'info-col' }, pair('R', this.rgb.r), pair('G', this.rgb.g), pair('B', this.rgb.b), pair('#', this.rgb.hex)),
      h('div', { class: 'info-col' }, pair('X', this.pos.x), pair('Y', this.pos.y), this.swatch),
      h('div', { class: 'info-col' }, pair('W', this.sel.w), pair('H', this.sel.h)));
    app.on('cursor', (ev) => this.cursor(ev));
    app.on('selection', () => this.selection());
    app.on('document', () => {
      this.cursor(null);
      this.selection();
    });
  }

  cursor(ev) {
    const doc = this.app.doc;
    const inside = ev && doc && ev.x >= 0 && ev.y >= 0 && ev.x < doc.width && ev.y < doc.height;
    this.pos.x.textContent = ev && doc ? Math.floor(ev.x) : '';
    this.pos.y.textContent = ev && doc ? Math.floor(ev.y) : '';
    if (!inside || !shown(this.el)) {
      for (const k of ['r', 'g', 'b', 'hex']) this.rgb[k].textContent = '';
      this.swatch.style.background = 'transparent';
      return;
    }
    const d = this.app.renderer.getComposite().getContext('2d').getImageData(Math.floor(ev.x), Math.floor(ev.y), 1, 1).data;
    const hex = [d[0], d[1], d[2]].map((c) => c.toString(16).padStart(2, '0')).join('');
    this.rgb.r.textContent = d[0];
    this.rgb.g.textContent = d[1];
    this.rgb.b.textContent = d[2];
    this.rgb.hex.textContent = d[3] ? hex : '—';
    this.swatch.style.background = d[3] ? `#${hex}` : 'transparent';
  }

  selection() {
    const b = this.app.doc && !this.app.doc.selection.isEmpty() ? this.app.doc.selection.bounds : null;
    this.sel.w.textContent = b ? b.w : '';
    this.sel.h.textContent = b ? b.h : '';
  }
}

const CHANNELS = [
  { value: 'rgb', label: 'Colors' },
  { value: 'lum', label: 'Luminosity' },
  { value: 'r', label: 'Red' },
  { value: 'g', label: 'Green' },
  { value: 'b', label: 'Blue' },
];

/** Histogram of the image (or the selection) with mean, standard deviation and median. */
export class HistogramPanel {
  constructor(app) {
    this.app = app;
    this.channel = 'rgb';
    this.data = null;
    this.stale = true;
    this.canvas = h('canvas', { class: 'histo-canvas', width: 256, height: 100, 'aria-label': 'Histogram' });
    const sel = h('select', { 'aria-label': 'Channel', value: this.channel },
      CHANNELS.map((c) => h('option', { value: c.value }, c.label)));
    sel.addEventListener('change', () => {
      this.channel = sel.value;
      this.draw();
    });
    this.stats = h('div', { class: 'histo-stats' });
    this.el = h('div', { class: 'histo-panel' }, h('label', { class: 'adjust-inline' }, 'Channel', sel), this.canvas, this.stats);
    const later = debounce(() => this.refresh(), 400);
    for (const evt of ['pixels', 'selection', 'document']) {
      app.on(evt, () => {
        this.stale = true;
        later();
      });
    }
  }

  onShow() { this.refresh(); }

  refresh() {
    if (!shown(this.el) || !this.stale) return;
    this.stale = false;
    const doc = this.app.doc;
    if (!doc) {
      this.data = null;
      this.draw();
      return;
    }
    // Sample a reduced copy of the image: plenty for a histogram, and fast.
    const s = Math.min(1, 400 / Math.max(doc.width, doc.height));
    const w = Math.max(1, Math.round(doc.width * s));
    const hh = Math.max(1, Math.round(doc.height * s));
    const c = createCanvas(w, hh, { readFrequently: true });
    const ctx = c.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(this.app.renderer.getComposite(), 0, 0, w, hh);
    const px = ctx.getImageData(0, 0, w, hh).data;
    const sel = doc.selection.isEmpty() ? null : doc.selection;
    const hist = { r: new Uint32Array(256), g: new Uint32Array(256), b: new Uint32Array(256), lum: new Uint32Array(256) };
    let n = 0;
    for (let y = 0; y < hh; y++) {
      for (let x = 0; x < w; x++) {
        if (sel && !sel.contains((x + 0.5) / s, (y + 0.5) / s)) continue;
        const i = (y * w + x) * 4;
        if (!px[i + 3]) continue;
        hist.r[px[i]]++;
        hist.g[px[i + 1]]++;
        hist.b[px[i + 2]]++;
        hist.lum[Math.round(0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2])]++;
        n++;
      }
    }
    let pixels = doc.width * doc.height;
    if (sel) {
      pixels = 0;
      for (const a of sel.alpha) if (a >= 128) pixels++;
    }
    this.data = { hist, n, pixels };
    this.draw();
  }

  draw() {
    const ctx = this.canvas.getContext('2d');
    const W = this.canvas.width;
    const H = this.canvas.height;
    ctx.fillStyle = '#1b1b1b';
    ctx.fillRect(0, 0, W, H);
    const d = this.data;
    if (!d || !d.n) {
      this.stats.textContent = '';
      return;
    }
    const sets = this.channel === 'rgb'
      ? [['r', 'rgba(255,70,70,0.75)'], ['g', 'rgba(70,220,70,0.75)'], ['b', 'rgba(80,130,255,0.75)']]
      : [[this.channel, this.channel === 'lum' ? '#d0d0d0' : { r: '#ff5a5a', g: '#5ad35a', b: '#6b9bff' }[this.channel]]];
    let max = 1;
    for (const [k] of sets) for (let i = 0; i < 256; i++) max = Math.max(max, d.hist[k][i]);
    ctx.globalCompositeOperation = this.channel === 'rgb' ? 'screen' : 'source-over';
    for (const [k, color] of sets) {
      ctx.fillStyle = color;
      for (let i = 0; i < 256; i++) {
        const bh = Math.round((d.hist[k][i] / max) * (H - 2));
        if (bh) ctx.fillRect(i, H - bh, 1, bh);
      }
    }
    ctx.globalCompositeOperation = 'source-over';
    // Statistics for the chosen channel (Colors uses luminosity).
    const hist = d.hist[this.channel === 'rgb' ? 'lum' : this.channel];
    let sum = 0;
    for (let i = 0; i < 256; i++) sum += i * hist[i];
    const mean = sum / d.n;
    let v = 0;
    for (let i = 0; i < 256; i++) v += hist[i] * (i - mean) ** 2;
    let acc = 0;
    let median = 0;
    for (let i = 0; i < 256; i++) {
      acc += hist[i];
      if (acc >= d.n / 2) {
        median = i;
        break;
      }
    }
    this.stats.textContent = `Mean ${mean.toFixed(2)} · Std Dev ${Math.sqrt(v / d.n).toFixed(2)} · Median ${median} · Pixels ${d.pixels.toLocaleString('en')}`;
  }
}

