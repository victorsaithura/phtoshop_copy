import { h } from './dom.js';
import { clamp, hexToRgb, hsvToRgb, normalizeHex, rgbToHex, rgbToHsv } from '../core/utils.js';

const SWATCHES = [
  '#000000', '#ffffff', '#ff0000', '#ffff00', '#00ff00', '#00ffff', '#0000ff', '#ff00ff',
  '#808080', '#c0c0c0', '#800000', '#808000', '#008000', '#008080', '#000080', '#800080',
  '#f7977a', '#fdc68a', '#fff79a', '#82ca9d', '#7accc8', '#8493ca', '#a187be', '#f49ac2',
];

/** Saturation/value square + hue strip + hex and RGB fields. */
export class ColorPicker {
  constructor({ color = '#000000', onChange = null, svHeight = 120 } = {}) {
    this.onChange = onChange;
    this.hsv = rgbToHsv(hexToRgb(color));
    this.sv = h('canvas', { class: 'cp-sv', style: { height: `${svHeight}px` } });
    this.hue = h('canvas', { class: 'cp-hue' });
    this.hex = h('input', { type: 'text', class: 'cp-hex', maxlength: '7', spellcheck: 'false', 'aria-label': 'Hex color' });
    this.rgb = ['R', 'G', 'B'].map((c) => h('input', { type: 'number', min: 0, max: 255, 'aria-label': c }));
    this.fields = h('div', { class: 'cp-fields' }, h('label', {}, '#', this.hex));
    const rgbRow = h('div', { class: 'cp-fields' }, ...this.rgb.map((input, i) => h('label', {}, 'RGB'[i], input)));
    this.el = h('div', { class: 'cp' }, this.sv, this.hue, this.fields, rgbRow);

    this._drag(this.sv, (x, y, w, hgt) => {
      this.hsv = { ...this.hsv, s: clamp(x / w, 0, 1), v: 1 - clamp(y / hgt, 0, 1) };
      this._changed();
    });
    this._drag(this.hue, (x, y, w) => {
      this.hsv = { ...this.hsv, h: clamp(x / w, 0, 0.9999) * 360 };
      this._changed();
    });
    this.hex.addEventListener('change', () => {
      const n = normalizeHex(this.hex.value);
      if (n) this.setColor(n, true);
      else this._syncFields();
    });
    for (const input of this.rgb) {
      input.addEventListener('change', () => {
        const [r, g, b] = this.rgb.map((i) => clamp(Number(i.value) || 0, 0, 255));
        this.setColor(rgbToHex({ r, g, b }), true);
      });
    }
    new ResizeObserver(() => this._resize()).observe(this.sv);
    this._syncFields();
  }

  get color() { return rgbToHex(hsvToRgb(this.hsv)); }

  setColor(hex, notify = false) {
    const hsv = rgbToHsv(hexToRgb(hex));
    // Keep the hue (and saturation) when they are undefined for greys/black.
    if (hsv.v === 0 || hsv.s === 0) {
      hsv.h = this.hsv.h;
      if (hsv.v === 0) hsv.s = this.hsv.s;
    }
    this.hsv = hsv;
    if (notify) this._changed();
    else {
      this._draw();
      this._syncFields();
    }
  }

  _changed() {
    this._draw();
    this._syncFields();
    this.onChange?.(this.color);
  }

  _drag(canvas, fn) {
    const handle = (e) => {
      const r = canvas.getBoundingClientRect();
      fn(e.clientX - r.left, e.clientY - r.top, r.width, r.height);
    };
    canvas.addEventListener('pointerdown', (e) => {
      canvas.setPointerCapture(e.pointerId);
      handle(e);
      const move = (ev) => handle(ev);
      const up = () => {
        canvas.removeEventListener('pointermove', move);
        canvas.removeEventListener('pointerup', up);
        canvas.removeEventListener('pointercancel', up);
      };
      canvas.addEventListener('pointermove', move);
      canvas.addEventListener('pointerup', up);
      canvas.addEventListener('pointercancel', up);
    });
  }

  _resize() {
    const dpr = window.devicePixelRatio || 1;
    for (const c of [this.sv, this.hue]) {
      c.width = Math.max(1, Math.round(c.clientWidth * dpr));
      c.height = Math.max(1, Math.round(c.clientHeight * dpr));
    }
    this._draw();
  }

  _draw() {
    const dpr = window.devicePixelRatio || 1;
    const { h: hue, s, v } = this.hsv;

    const c = this.sv;
    const w = c.width;
    const hh = c.height;
    if (w > 1) {
      const ctx = c.getContext('2d');
      ctx.fillStyle = rgbToHex(hsvToRgb({ h: hue, s: 1, v: 1 }));
      ctx.fillRect(0, 0, w, hh);
      const white = ctx.createLinearGradient(0, 0, w, 0);
      white.addColorStop(0, '#ffffff');
      white.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = white;
      ctx.fillRect(0, 0, w, hh);
      const black = ctx.createLinearGradient(0, 0, 0, hh);
      black.addColorStop(0, 'rgba(0,0,0,0)');
      black.addColorStop(1, '#000000');
      ctx.fillStyle = black;
      ctx.fillRect(0, 0, w, hh);
      ctx.lineWidth = 1.5 * dpr;
      ctx.beginPath();
      ctx.arc(s * w, (1 - v) * hh, 5 * dpr, 0, Math.PI * 2);
      ctx.strokeStyle = v > 0.6 && s < 0.4 ? '#000' : '#fff';
      ctx.stroke();
    }

    const hc = this.hue;
    if (hc.width > 1) {
      const ctx = hc.getContext('2d');
      const g = ctx.createLinearGradient(0, 0, hc.width, 0);
      for (let i = 0; i <= 6; i++) g.addColorStop(i / 6, rgbToHex(hsvToRgb({ h: (i * 60) % 360, s: 1, v: 1 })));
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, hc.width, hc.height);
      const x = (hue / 360) * hc.width;
      ctx.fillStyle = '#fff';
      ctx.fillRect(x - 1.5 * dpr, 0, 3 * dpr, hc.height);
      ctx.strokeStyle = '#000';
      ctx.lineWidth = dpr;
      ctx.strokeRect(x - 1.5 * dpr, 0, 3 * dpr, hc.height);
    }
  }

  _syncFields() {
    const rgb = hsvToRgb(this.hsv);
    if (document.activeElement !== this.hex) this.hex.value = rgbToHex(rgb).slice(1);
    ['r', 'g', 'b'].forEach((k, i) => {
      if (document.activeElement !== this.rgb[i]) this.rgb[i].value = rgb[k];
    });
  }
}

/** The Color panel: edits the foreground or background colour, plus swatches. */
export class ColorPanel {
  constructor(app) {
    this.app = app;
    this.target = 'fg';
    this.internal = false;
    this.picker = new ColorPicker({
      color: app.colors.fg,
      svHeight: 110,
      onChange: (hex) => {
        this.internal = true;
        app.setColor(this.target, hex);
        this.internal = false;
      },
    });
    this.fgSlot = h('button', { type: 'button', class: 'cp-slot fg', title: 'Edit foreground color',
      onClick: () => this._target('fg') });
    this.bgSlot = h('button', { type: 'button', class: 'cp-slot bg', title: 'Edit background color',
      onClick: () => this._target('bg') });
    this.picker.fields.prepend(h('div', { class: 'cp-slots' }, this.fgSlot, this.bgSlot));

    const swatches = h('div', { class: 'swatches', title: 'Click: foreground · Alt-click or right-click: background' });
    for (const c of SWATCHES) {
      const sw = h('button', { type: 'button', class: 'swatch', style: { background: c }, 'aria-label': c });
      sw.addEventListener('click', (e) => app.setColor(e.altKey ? 'bg' : 'fg', c));
      sw.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        app.setColor('bg', c);
      });
      swatches.append(sw);
    }
    this.el = h('div', {}, this.picker.el, swatches);

    app.on('colors', () => this._sync());
    this._sync();
  }

  _target(which) {
    this.target = which;
    this.picker.setColor(this.app.colors[which]);
    this._sync();
  }

  _sync() {
    const { fg, bg } = this.app.colors;
    this.fgSlot.style.background = fg;
    this.bgSlot.style.background = bg;
    this.fgSlot.classList.toggle('selected', this.target === 'fg');
    this.bgSlot.classList.toggle('selected', this.target === 'bg');
    if (!this.internal) this.picker.setColor(this.app.colors[this.target]);
  }
}
