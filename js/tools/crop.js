import { Tool, DoubleClick } from './tool.js';
import { cropDocument } from '../core/transform.js';

const RATIOS = [
  { value: 'free', label: 'Ratio: Free' },
  { value: 'original', label: 'Original Ratio' },
  { value: '1:1', label: '1 : 1 (Square)' },
  { value: '4:3', label: '4 : 3' },
  { value: '3:2', label: '3 : 2' },
  { value: '16:9', label: '16 : 9' },
  { value: '5:4', label: '5 : 4' },
  { value: '4:5', label: '4 : 5' },
  { value: '2:3', label: '2 : 3' },
  { value: '9:16', label: '9 : 16' },
];

const CURSORS = {
  nw: 'nwse-resize', se: 'nwse-resize', ne: 'nesw-resize', sw: 'nesw-resize',
  n: 'ns-resize', s: 'ns-resize', e: 'ew-resize', w: 'ew-resize', move: 'move', new: 'crosshair',
};

const normalize = (r) => ({
  x: r.w < 0 ? r.x + r.w : r.x,
  y: r.h < 0 ? r.y + r.h : r.y,
  w: Math.abs(r.w),
  h: Math.abs(r.h),
});

/** Resize rect `o` by dragging `handle` to (x, y), optionally keeping width/height = ratio. */
function resizeRect(o, handle, x, y, ratio) {
  if (ratio && handle.length === 2) {
    // Corner: the opposite corner stays put.
    const ax = handle.includes('w') ? o.x + o.w : o.x;
    const ay = handle.includes('n') ? o.y + o.h : o.y;
    const w = x - ax;
    const hgt = (Math.abs(w) / ratio) * (Math.sign(y - ay) || 1);
    return normalize({ x: ax, y: ay, w, h: hgt });
  }
  let l = o.x;
  let t = o.y;
  let r = o.x + o.w;
  let b = o.y + o.h;
  if (handle.includes('w')) l = x;
  if (handle.includes('e')) r = x;
  if (handle.includes('n')) t = y;
  if (handle.includes('s')) b = y;
  let rect = normalize({ x: l, y: t, w: r - l, h: b - t });
  if (ratio) {
    if (handle === 'e' || handle === 'w') {
      const hh = rect.w / ratio;
      rect = { ...rect, y: o.y + o.h / 2 - hh / 2, h: hh };
    } else {
      const ww = rect.h * ratio;
      rect = { ...rect, x: o.x + o.w / 2 - ww / 2, w: ww };
    }
  }
  return rect;
}

/** Crop Tool: adjust the box with its handles; Enter (or double-click) crops, Esc resets. */
export class CropTool extends Tool {
  constructor(app) {
    super(app, { id: 'crop', name: 'Crop Tool', key: 'C', icon: 'crop', cursor: 'crosshair' });
    this.options = { ratio: 'free', deleteCropped: true };
    this.rect = null; // null = the whole canvas
    this.drag = null;
    this.clicks = new DoubleClick();
  }

  get box() {
    return this.rect || (this.doc ? this.doc.bounds : null);
  }

  ratio(shift) {
    const r = this.options.ratio;
    if (r === 'original') return this.doc.width / this.doc.height;
    if (r !== 'free') {
      const [a, b] = r.split(':').map(Number);
      return a / b;
    }
    return shift ? 1 : null;
  }

  _hit(e) {
    const v = this.app.view;
    const b = this.box;
    const p0 = v.docToScreen(b.x, b.y);
    const p1 = v.docToScreen(b.x + b.w, b.y + b.h);
    const xs = { w: p0.x, c: (p0.x + p1.x) / 2, e: p1.x };
    const ys = { n: p0.y, c: (p0.y + p1.y) / 2, s: p1.y };
    const near = (a, c) => Math.abs(a - c) <= 9;
    for (const hy of ['n', 'c', 's']) {
      for (const hx of ['w', 'c', 'e']) {
        if (hx === 'c' && hy === 'c') continue;
        if (near(e.sx, xs[hx]) && near(e.sy, ys[hy])) return (hy === 'c' ? '' : hy) + (hx === 'c' ? '' : hx);
      }
    }
    const inside = e.sx > p0.x && e.sx < p1.x && e.sy > p0.y && e.sy < p1.y;
    if (inside) {
      if (near(e.sx, p0.x)) return 'w';
      if (near(e.sx, p1.x)) return 'e';
      if (near(e.sy, p0.y)) return 'n';
      if (near(e.sy, p1.y)) return 's';
      return 'move';
    }
    return 'new';
  }

  onHover(e) {
    if (!this.doc) return;
    const cursor = CURSORS[this._hit(e)];
    if (cursor !== this.cursor) {
      this.cursor = cursor;
      this.app.updateCursor();
    }
  }

  onPointerDown(e) {
    const hit = this._hit(e);
    if (this.clicks.down(e) && hit === 'move') {
      this.commit();
      return;
    }
    this.drag = { hit, x: e.x, y: e.y, orig: { ...this.box } };
    this.rect = hit === 'new' ? { x: e.x, y: e.y, w: 0, h: 0 } : { ...this.box };
  }

  onPointerMove(e) {
    const d = this.drag;
    if (!d) return;
    this.clicks.move(e);
    const ratio = this.ratio(e.shift);
    if (d.hit === 'new') {
      const w = e.x - d.x;
      const hgt = ratio ? (Math.abs(w) / ratio) * (Math.sign(e.y - d.y) || 1) : e.y - d.y;
      this.rect = normalize({ x: d.x, y: d.y, w, h: hgt });
    } else if (d.hit === 'move') {
      this.rect = { ...d.orig, x: d.orig.x + e.x - d.x, y: d.orig.y + e.y - d.y };
    } else {
      this.rect = resizeRect(d.orig, d.hit, e.x, e.y, ratio);
    }
  }

  onPointerUp() {
    const d = this.drag;
    if (!d) return;
    this.drag = null;
    const r = this.rect;
    if (d.hit === 'new' && (r.w < 2 || r.h < 2)) this.rect = d.orig;
    else this.rect = { x: Math.round(r.x), y: Math.round(r.y), w: Math.max(1, Math.round(r.w)), h: Math.max(1, Math.round(r.h)) };
    this.app.renderer.request(false);
  }

  commit() {
    const b = this.box;
    this.drag = null;
    this.rect = null;
    if (b) cropDocument(this.app, b, this.options.deleteCropped);
    this.app.renderer.request(false);
  }

  cancel() {
    this.drag = null;
    this.rect = null;
    this.app.renderer.request(false);
  }

  onDeactivate() {
    this.cancel();
  }

  onKeyDown(e) {
    if (e.key === 'Enter') {
      this.commit();
      return true;
    }
    return false;
  }

  drawOverlay(ctx, view) {
    const b = this.box;
    if (!b) return;
    const p0 = view.docToScreen(b.x, b.y);
    const p1 = view.docToScreen(b.x + b.w, b.y + b.h);
    const x = Math.round(p0.x) + 0.5;
    const y = Math.round(p0.y) + 0.5;
    const w = Math.round(p1.x - p0.x);
    const hgt = Math.round(p1.y - p0.y);

    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    ctx.beginPath();
    ctx.rect(0, 0, view.width, view.height);
    ctx.rect(x, y, w, hgt);
    ctx.fill('evenodd');

    ctx.lineWidth = 1;
    ctx.strokeStyle = 'rgba(255,255,255,0.4)';
    ctx.beginPath();
    for (let i = 1; i < 3; i++) {
      ctx.moveTo(Math.round(x + (w * i) / 3), y);
      ctx.lineTo(Math.round(x + (w * i) / 3), y + hgt);
      ctx.moveTo(x, Math.round(y + (hgt * i) / 3));
      ctx.lineTo(x + w, Math.round(y + (hgt * i) / 3));
    }
    ctx.stroke();
    ctx.strokeStyle = '#ffffff';
    ctx.strokeRect(x, y, w, hgt);

    ctx.fillStyle = '#ffffff';
    ctx.strokeStyle = '#000000';
    for (const hx of [x, x + w / 2, x + w]) {
      for (const hy of [y, y + hgt / 2, y + hgt]) {
        if (hx === x + w / 2 && hy === y + hgt / 2) continue;
        ctx.fillRect(hx - 4, hy - 4, 8, 8);
        ctx.strokeRect(hx - 4, hy - 4, 8, 8);
      }
    }

    const label = `${Math.round(b.w)} × ${Math.round(b.h)} px`;
    ctx.font = '11px system-ui, sans-serif';
    const tw = ctx.measureText(label).width + 12;
    ctx.fillStyle = 'rgba(30,30,30,0.9)';
    ctx.fillRect(x, y + hgt + 8, tw, 20);
    ctx.fillStyle = '#eeeeee';
    ctx.fillText(label, x + 6, y + hgt + 22);
  }

  buildOptions(bar) {
    bar.select({
      value: this.options.ratio,
      options: RATIOS,
      title: 'Aspect ratio',
      onChange: (v) => {
        this.setOption('ratio', v);
        const r = this.ratio(false);
        if (r) {
          // Fit the largest box with this ratio inside the current one.
          const b = this.box;
          const w = Math.min(b.w, b.h * r);
          const hgt = w / r;
          this.rect = { x: Math.round(b.x + (b.w - w) / 2), y: Math.round(b.y + (b.h - hgt) / 2), w: Math.round(w), h: Math.round(hgt) };
          this.app.renderer.request(false);
        }
      },
    });
    bar.checkbox({
      label: 'Delete Cropped Pixels',
      title: 'Off: pixels outside the crop are kept on their layers (hidden) and can be moved back into view',
      checked: this.options.deleteCropped,
      onChange: (v) => this.setOption('deleteCropped', v),
    });
    bar.sep();
    bar.button({ label: 'Cancel', title: 'Reset the crop box (Esc)', onClick: () => this.cancel() });
    bar.button({ label: '✓ Crop', title: 'Apply the crop (Enter)', className: 'btn btn-small btn-primary', onClick: () => this.commit() });
  }
}
