import { storageGet, storageSet } from './core/utils.js';

/*
 * Rulers, guides, the grid and snapping (View menu).
 * Guides belong to each document: doc.guides = [{ o: 'h' | 'v', p: position }].
 * The view settings below are remembered between visits.
 */

export const RULER = 18; // ruler thickness, CSS px
const KEY = 'photoforge.view';
const DEFAULTS = {
  rulers: false, grid: false, guides: true, lockGuides: false,
  snap: true, snapGuides: true, snapGrid: true, snapDocument: true,
  gridSize: 100, gridSubdivisions: 4,
};

export function loadViewOptions() {
  const saved = storageGet(KEY, {});
  const o = { ...DEFAULTS };
  if (saved && typeof saved === 'object') {
    for (const k of Object.keys(DEFAULTS)) if (typeof saved[k] === typeof DEFAULTS[k]) o[k] = saved[k];
  }
  o.gridSize = Math.min(5000, Math.max(2, o.gridSize));
  o.gridSubdivisions = Math.min(20, Math.max(1, Math.round(o.gridSubdivisions)));
  return o;
}

export const saveViewOptions = (o) => storageSet(KEY, o);

/* ---------- Snapping ---------- */

/** A coordinate pulled onto the nearest guide, grid line or canvas edge within 8 screen px. */
export function snapValue(app, v, axis) {
  const o = app.viewOptions;
  const doc = app.doc;
  if (!o.snap || !doc) return v;
  const t = 8 / app.view.zoom;
  let best = v;
  let bestD = t;
  const consider = (p) => {
    const d = Math.abs(p - v);
    if (d < bestD) {
      bestD = d;
      best = p;
    }
  };
  if (o.snapGuides && o.guides) {
    const orient = axis === 'x' ? 'v' : 'h';
    for (const g of doc.guides) if (g.o === orient) consider(g.p);
  }
  if (o.snapGrid && o.grid) {
    const step = o.gridSize / o.gridSubdivisions;
    consider(Math.round(v / step) * step);
  }
  if (o.snapDocument) {
    consider(0);
    consider(axis === 'x' ? doc.width : doc.height);
  }
  return best;
}

export const snapPoint = (app, x, y) => ({ x: snapValue(app, x, 'x'), y: snapValue(app, y, 'y') });

/** How far to nudge a moving rectangle so an edge or its centre lands on a snap target. */
export function snapRect(app, r) {
  const along = (axis, lo, size) => {
    let best = 0;
    let bestD = Infinity;
    for (const e of [lo, lo + size / 2, lo + size]) {
      const s = snapValue(app, e, axis);
      if (s !== e && Math.abs(s - e) < bestD) {
        bestD = Math.abs(s - e);
        best = s - e;
      }
    }
    return best;
  };
  return { dx: along('x', r.x, r.w), dy: along('y', r.y, r.h) };
}

/* ---------- Drawing (screen space, CSS pixels) ---------- */

/** Visible part of the document in document coordinates. */
function visibleDoc(app) {
  const v = app.view;
  const doc = app.doc;
  return {
    x0: Math.max(0, Math.floor(-v.panX / v.zoom)),
    y0: Math.max(0, Math.floor(-v.panY / v.zoom)),
    x1: Math.min(doc.width, Math.ceil((v.width - v.panX) / v.zoom)),
    y1: Math.min(doc.height, Math.ceil((v.height - v.panY) / v.zoom)),
  };
}

export function drawGrid(ctx, app) {
  const o = app.viewOptions;
  if (!o.grid || !app.doc) return;
  const v = app.view;
  const major = o.gridSize;
  const minor = major / o.gridSubdivisions;
  const { x0, y0, x1, y1 } = visibleDoc(app);
  if (x1 <= x0 || y1 <= y0) return;
  const pass = (step, color) => {
    if (step * v.zoom < 5) return;
    ctx.beginPath();
    for (let i = Math.ceil(x0 / step); i * step <= x1; i++) {
      const sx = Math.round(v.panX + i * step * v.zoom) + 0.5;
      ctx.moveTo(sx, v.panY + y0 * v.zoom);
      ctx.lineTo(sx, v.panY + y1 * v.zoom);
    }
    for (let i = Math.ceil(y0 / step); i * step <= y1; i++) {
      const sy = Math.round(v.panY + i * step * v.zoom) + 0.5;
      ctx.moveTo(v.panX + x0 * v.zoom, sy);
      ctx.lineTo(v.panX + x1 * v.zoom, sy);
    }
    ctx.strokeStyle = color;
    ctx.stroke();
  };
  ctx.save();
  ctx.lineWidth = 1;
  if (o.gridSubdivisions > 1) pass(minor, 'rgba(128, 128, 128, 0.28)');
  pass(major, 'rgba(110, 110, 110, 0.7)');
  ctx.restore();
}

export function drawGuides(ctx, app) {
  const doc = app.doc;
  if (!doc) return;
  const v = app.view;
  const drag = app.guideCtl?.drag;
  const list = app.viewOptions.guides ? doc.guides.filter((g) => g !== drag?.guide) : [];
  if (drag && drag.pos != null && !drag.remove) list.push({ o: drag.orient, p: drag.pos });
  if (!list.length) return;
  ctx.save();
  ctx.globalAlpha = app.viewOptions.lockGuides ? 0.6 : 1;
  ctx.globalCompositeOperation = 'source-over';
  ctx.fillStyle = '#00d8ff';
  // Solid 1 px bars stay crisp and fully coloured at any zoom.
  for (const g of list) {
    if (g.o === 'h') ctx.fillRect(0, Math.round(v.panY + g.p * v.zoom), v.width, 1);
    else ctx.fillRect(Math.round(v.panX + g.p * v.zoom), 0, 1, v.height);
  }
  ctx.restore();
}

const STEPS = [1, 2, 5, 10, 20, 25, 50, 100, 200, 250, 500, 1000, 2000, 2500, 5000, 10000, 20000];

export function drawRulers(ctx, app) {
  if (!app.viewOptions.rulers || !app.doc) return;
  const v = app.view;
  const z = v.zoom;
  const major = STEPS.find((s) => s * z >= 64) || 20000;
  const sub = major % 10 === 0 ? 10 : major % 5 === 0 ? 5 : 2;
  const minor = major / sub;
  ctx.save();
  ctx.fillStyle = '#262626';
  ctx.fillRect(0, 0, v.width, RULER);
  ctx.fillRect(0, 0, RULER, v.height);
  ctx.font = '9px system-ui, sans-serif';
  ctx.fillStyle = '#a0a0a0';
  ctx.textBaseline = 'top';
  ctx.beginPath();
  const ticks = (pan, from, to, draw) => {
    for (let i = Math.floor((from - pan) / z / minor); ; i++) {
      const pos = i * minor;
      const s = Math.round(pan + pos * z) + 0.5;
      if (s > to) break;
      if (s < RULER) continue;
      const len = i % sub === 0 ? RULER : sub % 2 === 0 && i % (sub / 2) === 0 ? 8 : 4;
      draw(s, len, i % sub === 0 ? String(Math.round(pos)) : null);
    }
  };
  ticks(v.panX, RULER, v.width, (s, len, label) => {
    ctx.moveTo(s, RULER);
    ctx.lineTo(s, RULER - len);
    if (label) ctx.fillText(label, s + 2, 1);
  });
  ticks(v.panY, RULER, v.height, (s, len, label) => {
    ctx.moveTo(RULER, s);
    ctx.lineTo(RULER - len, s);
    if (label) {
      ctx.save();
      ctx.translate(1, s + 2);
      ctx.rotate(Math.PI / 2);
      ctx.fillText(label, 0, -9);
      ctx.restore();
    }
  });
  ctx.strokeStyle = '#6f6f6f';
  ctx.lineWidth = 1;
  ctx.stroke();
  // Where the pointer is.
  const hv = app.hover;
  if (hv) {
    ctx.beginPath();
    ctx.moveTo(Math.round(hv.sx) + 0.5, 0);
    ctx.lineTo(Math.round(hv.sx) + 0.5, RULER);
    ctx.moveTo(0, Math.round(hv.sy) + 0.5);
    ctx.lineTo(RULER, Math.round(hv.sy) + 0.5);
    ctx.strokeStyle = '#31a8ff';
    ctx.stroke();
  }
  ctx.fillStyle = '#262626';
  ctx.fillRect(0, 0, RULER, RULER);
  ctx.fillStyle = '#3a3a3a';
  ctx.fillRect(0, RULER - 1, v.width, 1);
  ctx.fillRect(RULER - 1, 0, 1, v.height);
  ctx.restore();
}

/* ---------- Dragging guides ---------- */

/**
 * Pointer handling for guides: drag from a ruler to add one; with the Move
 * tool (or Ctrl held) drag a guide to move it, or back onto a ruler (or off
 * the view) to delete it.
 */
export class GuideController {
  constructor(app) {
    this.app = app;
    this.drag = null;
  }

  _onRuler(ev) {
    return this.app.viewOptions.rulers && (ev.sx < RULER || ev.sy < RULER);
  }

  /** The guide under the pointer that can be dragged, if any. */
  hit(ev) {
    const { app } = this;
    const o = app.viewOptions;
    if (!o.guides || o.lockGuides || !app.doc) return null;
    if (app.tool?.id !== 'move' && !ev.ctrl) return null;
    const v = app.view;
    let best = null;
    let bestD = 4;
    for (const g of app.doc.guides) {
      const d = g.o === 'h' ? Math.abs(ev.sy - (v.panY + g.p * v.zoom)) : Math.abs(ev.sx - (v.panX + g.p * v.zoom));
      if (d <= bestD) {
        bestD = d;
        best = g;
      }
    }
    return best;
  }

  cursor(ev) {
    if (this._onRuler(ev)) return ev.sx < RULER && ev.sy < RULER ? 'default' : ev.sy < RULER ? 'ns-resize' : 'ew-resize';
    const g = this.hit(ev);
    return g ? (g.o === 'h' ? 'ns-resize' : 'ew-resize') : null;
  }

  /** Returns true when the press belongs to the rulers or a guide. */
  down(ev) {
    const { app } = this;
    if (!app.doc) return false;
    if (this._onRuler(ev)) {
      if (ev.sx < RULER && ev.sy < RULER) return true;
      this.drag = { guide: null, orient: ev.sy < RULER ? 'h' : 'v', pos: null, remove: true };
      return true;
    }
    const g = this.hit(ev);
    if (!g) return false;
    this.drag = { guide: g, orient: g.o, pos: g.p, remove: false };
    return true;
  }

  move(ev) {
    const d = this.drag;
    if (!d) return;
    const v = this.app.view;
    const raw = d.orient === 'h' ? ev.y : ev.x;
    d.pos = Math.round(snapValue(this.app, raw, d.orient === 'h' ? 'y' : 'x'));
    const out = ev.sx < 0 || ev.sy < 0 || ev.sx > v.width || ev.sy > v.height;
    d.remove = out || (this._onRuler(ev) && (d.orient === 'h' ? ev.sy < RULER : ev.sx < RULER));
  }

  up() {
    const d = this.drag;
    this.drag = null;
    const { app } = this;
    const doc = app.doc;
    if (!d || !doc) return;
    if (!d.guide) {
      if (!d.remove && d.pos != null) {
        app.viewOptions.guides = true;
        app.transact('New Guide', { structure: true }, () => doc.guides.push({ o: d.orient, p: d.pos }));
      }
    } else if (d.remove) {
      app.transact('Delete Guide', { structure: true }, () => doc.guides.splice(doc.guides.indexOf(d.guide), 1));
    } else if (d.pos !== d.guide.p) {
      const i = doc.guides.indexOf(d.guide);
      app.transact('Move Guide', { structure: true }, () => { doc.guides[i] = { o: d.orient, p: d.pos }; });
    }
    app.renderer.request(false);
  }
}
