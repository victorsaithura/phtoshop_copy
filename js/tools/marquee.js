import { Tool, strokeOutline } from './tool.js';

export const SELECTION_MODES = [
  { value: 'new', icon: 'sel-new', title: 'New selection' },
  { value: 'add', icon: 'sel-add', title: 'Add to selection (Shift)' },
  { value: 'subtract', icon: 'sel-subtract', title: 'Subtract from selection (Alt)' },
  { value: 'intersect', icon: 'sel-intersect', title: 'Intersect with selection (Shift+Alt)' },
];

/** Mode from the options bar, overridden by Shift (add), Alt (subtract) or both (intersect). */
export function selectionMode(options, e) {
  if (e.shift && e.alt) return 'intersect';
  if (e.shift) return 'add';
  if (e.alt) return 'subtract';
  return options.mode;
}

/**
 * Rectangular / Elliptical Marquee.
 * Shift at the start adds, Alt subtracts; pressed during the drag they
 * constrain to a square/circle and draw from the centre.
 * Dragging inside an existing selection moves its outline.
 */
export class MarqueeTool extends Tool {
  constructor(app, shape = 'rect') {
    const ellipse = shape === 'ellipse';
    super(app, {
      id: ellipse ? 'marquee-ellipse' : 'marquee-rect',
      name: ellipse ? 'Elliptical Marquee Tool' : 'Rectangular Marquee Tool',
      key: 'M',
      cursor: 'crosshair',
    });
    this.shape = shape;
    this.options = { mode: 'new', feather: 0 };
    this.drag = null;
    this.moving = null;
  }

  onPointerDown(e) {
    const sel = this.doc.selection;
    const mode = selectionMode(this.options, e);

    if (mode === 'new' && !sel.isEmpty() && sel.contains(e.x, e.y)) {
      this.moving = { x: e.x, y: e.y, dx: 0, dy: 0 };
      return;
    }
    this.drag = {
      x0: e.x, y0: e.y, x1: e.x, y1: e.y, mode,
      startShift: e.shift, startAlt: e.alt, shiftUp: false, altUp: false,
      constrain: false, center: false,
    };
  }

  onPointerMove(e) {
    if (this.moving) {
      const m = this.moving;
      m.dx = Math.round(e.x - m.x);
      m.dy = Math.round(e.y - m.y);
      this.app.selectionOffset = { x: m.dx, y: m.dy };
      return;
    }
    const d = this.drag;
    if (!d) return;
    d.x1 = e.x;
    d.y1 = e.y;
    // A modifier used to pick the mode must be released before it can constrain.
    if (!e.shift) d.shiftUp = true;
    if (!e.alt) d.altUp = true;
    d.constrain = e.shift && (!d.startShift || d.shiftUp);
    d.center = e.alt && (!d.startAlt || d.altUp);
  }

  _rect(d) {
    let w = d.x1 - d.x0;
    let h = d.y1 - d.y0;
    if (d.constrain) {
      const s = Math.max(Math.abs(w), Math.abs(h));
      w = Math.sign(w || 1) * s;
      h = Math.sign(h || 1) * s;
    }
    let x0 = d.x0;
    let y0 = d.y0;
    if (d.center) {
      x0 -= w;
      y0 -= h;
      w *= 2;
      h *= 2;
    }
    const ax = Math.round(Math.min(x0, x0 + w));
    const ay = Math.round(Math.min(y0, y0 + h));
    const bx = Math.round(Math.max(x0, x0 + w));
    const by = Math.round(Math.max(y0, y0 + h));
    return { x: ax, y: ay, w: bx - ax, h: by - ay };
  }

  onPointerUp() {
    const sel = this.doc.selection;
    if (this.moving) {
      const { dx, dy } = this.moving;
      this.moving = null;
      this.app.selectionOffset = null;
      if (dx || dy) this.app.transact('Move Selection', { selection: true }, () => sel.translate(dx, dy));
      return;
    }
    const d = this.drag;
    if (!d) return;
    this.drag = null;
    const r = this._rect(d);
    if (r.w < 1 || r.h < 1) {
      // A click without dragging deselects.
      if (d.mode === 'new' && !sel.isEmpty()) {
        this.app.transact('Deselect', { selection: true }, () => sel.clear());
      }
      this.app.renderer.request(false);
      return;
    }
    const ellipse = this.shape === 'ellipse';
    const label = ellipse ? 'Elliptical Marquee' : 'Rectangular Marquee';
    this.app.transact(label, { selection: true }, () => {
      sel.combine((ctx) => {
        if (ellipse) {
          ctx.beginPath();
          ctx.ellipse(r.x + r.w / 2, r.y + r.h / 2, r.w / 2, r.h / 2, 0, 0, Math.PI * 2);
          ctx.fill();
        } else {
          ctx.fillRect(r.x, r.y, r.w, r.h);
        }
      }, d.mode, this.options.feather, r);
    });
  }

  cancel() {
    this.drag = null;
    this.moving = null;
    this.app.selectionOffset = null;
    this.app.renderer.request(false);
  }

  drawOverlay(ctx, view) {
    const d = this.drag;
    if (!d) return;
    const r = this._rect(d);
    const p = view.docToScreen(r.x, r.y);
    const w = r.w * view.zoom;
    const h = r.h * view.zoom;
    strokeOutline(ctx, (c) => {
      if (this.shape === 'ellipse') c.ellipse(p.x + w / 2, p.y + h / 2, w / 2, h / 2, 0, 0, Math.PI * 2);
      else c.rect(Math.round(p.x) + 0.5, Math.round(p.y) + 0.5, Math.round(w), Math.round(h));
    }, true);
    // Size read-out next to the pointer, like Photoshop.
    const label = `W: ${r.w} px  H: ${r.h} px`;
    const end = view.docToScreen(d.x1, d.y1);
    ctx.font = '11px system-ui, sans-serif';
    const tw = ctx.measureText(label).width + 12;
    ctx.fillStyle = 'rgba(30,30,30,0.9)';
    ctx.fillRect(end.x + 14, end.y + 14, tw, 20);
    ctx.fillStyle = '#eee';
    ctx.fillText(label, end.x + 20, end.y + 28);
  }

  buildOptions(bar) {
    bar.segmented({ value: this.options.mode, options: SELECTION_MODES, onChange: (v) => this.setOption('mode', v) });
    bar.sep();
    bar.number({ label: 'Feather', min: 0, max: 250, value: this.options.feather, unit: 'px',
      onInput: (v) => this.setOption('feather', v) });
  }
}
