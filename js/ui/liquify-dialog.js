import { h, checkbox, button, iconButton } from './dom.js';
import { icon } from './icons.js';
import { openModal } from './dialogs.js';
import { paramControls } from './adjust-dialog.js';
import { LiveEdit } from '../core/live-edit.js';
import { LiquifyField, renderLiquify } from '../core/liquify.js';
import { createCanvas, rectUnion, rectIntersect } from '../core/utils.js';

const TOOLS = [
  { id: 'warp', label: 'Forward Warp', key: 'W', icon: 'lq-warp' },
  { id: 'reconstruct', label: 'Reconstruct', key: 'R', icon: 'lq-reconstruct' },
  { id: 'smooth', label: 'Smooth', key: 'E', icon: 'lq-smooth' },
  { id: 'twirl', label: 'Twirl Clockwise (Alt: counter-clockwise)', key: 'C', icon: 'lq-twirl' },
  { id: 'pucker', label: 'Pucker (Alt: bloat)', key: 'S', icon: 'lq-pucker' },
  { id: 'bloat', label: 'Bloat (Alt: pucker)', key: 'B', icon: 'lq-bloat' },
  { id: 'push', label: 'Push Left (drag down to push right)', key: 'O', icon: 'lq-push' },
  { id: 'freeze', label: 'Freeze Mask', key: 'F', icon: 'lq-freeze' },
  { id: 'thaw', label: 'Thaw Mask', key: 'D', icon: 'lq-thaw' },
  { id: 'hand', label: 'Hand', key: 'H', icon: 'hand' },
  { id: 'zoom', label: 'Zoom (Alt-click zooms out)', key: 'Z', icon: 'zoom' },
];
// Tools that keep working while the button is held still.
const CONTINUOUS = new Set(['reconstruct', 'smooth', 'twirl', 'pucker', 'bloat']);
const UNDO_STEPS = 10;

// Tool and brush settings are remembered for the session.
const settings = { tool: 'warp', size: 0, pressure: 100, density: 50, rate: 80, showMesh: false, showMask: true };

/**
 * Filter ▸ Liquify: push, twirl, pucker and bloat the active layer (or the
 * selected part) with brushes, in a workspace with its own zoom, pan and
 * undo. Freeze Mask protects areas; Reconstruct paints the original back.
 */
export function liquifyDialog(app) {
  const edit = LiveEdit.start(app, 'liquify filter');
  if (!edit) return;
  const W = edit.region.w;
  const H = edit.region.h;
  const src = edit.src;
  const field = new LiquifyField(W, H);
  const p = {
    size: settings.size || Math.max(10, Math.min(300, Math.round(Math.min(W, H) / 6))),
    pressure: settings.pressure, density: settings.density, rate: settings.rate,
  };

  const canvas = h('canvas', { class: 'lq-canvas' });
  const overlay = h('canvas', { class: 'lq-overlay', tabindex: -1, 'aria-label': 'Liquify preview — drag to distort' });
  const view = h('div', { class: 'lq-view' }, canvas, overlay);
  const ctx = canvas.getContext('2d');
  const octx = overlay.getContext('2d');
  // View: z canvas pixels per image pixel; image (0, 0) sits at canvas (ox, oy).
  const v = { z: 1, ox: 0, oy: 0, cw: 0, ch: 0, dpr: 1, frame: null, full: true, dirty: null, raf: 0, hover: null, space: false };
  const levels = [src]; // the image at full, half, quarter… size for zoomed-out previews
  let stroke = null;
  const undoStack = [];
  const redoStack = [];

  const level = (k) => {
    while (levels.length <= k) {
      const prev = levels[levels.length - 1];
      const nw = Math.max(1, Math.round(prev.width / 2));
      const nh = Math.max(1, Math.round(prev.height / 2));
      if (nw === prev.width && nh === prev.height) break;
      const a = createCanvas(prev.width, prev.height);
      a.getContext('2d').putImageData(prev, 0, 0);
      const b = createCanvas(nw, nh, { readFrequently: true });
      const bc = b.getContext('2d', { willReadFrequently: true });
      bc.imageSmoothingQuality = 'high';
      bc.drawImage(a, 0, 0, nw, nh);
      levels.push(bc.getImageData(0, 0, nw, nh));
    }
    return levels[Math.min(k, levels.length - 1)];
  };

  /* ---------- Drawing ---------- */

  const schedule = () => {
    if (!v.raf) v.raf = requestAnimationFrame(frame);
  };
  /** Redraw the part of the view showing image rect r (or everything). */
  const invalidate = (r = null) => {
    if (!r) v.full = true;
    else {
      const x0 = Math.floor(v.ox + r.x * v.z) - 2;
      const y0 = Math.floor(v.oy + r.y * v.z) - 2;
      const x1 = Math.ceil(v.ox + (r.x + r.w) * v.z) + 2;
      const y1 = Math.ceil(v.oy + (r.y + r.h) * v.z) + 2;
      v.dirty = rectUnion(v.dirty, { x: x0, y: y0, w: x1 - x0, h: y1 - y0 });
    }
    schedule();
  };

  function frame() {
    v.raf = 0;
    if (stroke && !stroke.pan && CONTINUOUS.has(settings.tool)) dabAt(stroke.cur, 0, 0);
    const all = { x: 0, y: 0, w: v.cw, h: v.ch };
    const r = v.full ? all : rectIntersect(v.dirty, all);
    if (r && v.frame) {
      const k = v.z >= 1 ? 0 : Math.floor(Math.log2(1 / v.z));
      const lv = level(k);
      renderLiquify(field, lv, v.frame, r, {
        z: v.z, ox: v.ox, oy: v.oy, sx: lv.width / W, sy: lv.height / H, backdrop: true, tint: settings.showMask,
      });
      ctx.putImageData(v.frame, 0, 0, r.x, r.y, r.w, r.h);
    }
    v.full = false;
    v.dirty = null;
    drawOverlay();
    if (stroke && !stroke.pan && CONTINUOUS.has(settings.tool)) schedule();
  }

  function drawOverlay() {
    octx.clearRect(0, 0, v.cw, v.ch);
    if (settings.showMesh) {
      // Lines of the original image, carried along by the distortion.
      const step = Math.max(2, Math.round(32 / v.z));
      const o = [0, 0];
      const line = (pts) => {
        pts.forEach(([x, y], i) => {
          field.forward(x, y, o);
          const sx = v.ox + o[0] * v.z;
          const sy = v.oy + o[1] * v.z;
          if (i) octx.lineTo(sx, sy);
          else octx.moveTo(sx, sy);
        });
      };
      const along = (n, f) => Array.from({ length: n + 1 }, (_, i) => f(i));
      octx.save();
      octx.beginPath();
      for (let y = 0; y <= H; y += step) line(along(Math.ceil(W / (step / 2)), (i) => [Math.min(W, (i * step) / 2), y]));
      for (let x = 0; x <= W; x += step) line(along(Math.ceil(H / (step / 2)), (i) => [x, Math.min(H, (i * step) / 2)]));
      // Light under dark, so the mesh shows on any image.
      octx.lineWidth = 2.5 * v.dpr;
      octx.strokeStyle = 'rgba(255, 255, 255, 0.45)';
      octx.stroke();
      octx.lineWidth = v.dpr;
      octx.strokeStyle = 'rgba(30, 30, 30, 0.85)';
      octx.stroke();
      octx.restore();
    }
    const hv = v.hover;
    if (hv && settings.tool !== 'hand' && settings.tool !== 'zoom' && !v.space) {
      const r = Math.max(1, (p.size / 2) * v.z);
      octx.save();
      octx.lineWidth = 3 * v.dpr;
      octx.strokeStyle = 'rgba(0, 0, 0, 0.5)';
      octx.beginPath();
      octx.arc(hv.cx, hv.cy, r, 0, Math.PI * 2);
      octx.stroke();
      octx.lineWidth = v.dpr;
      octx.strokeStyle = 'rgba(255, 255, 255, 0.95)';
      octx.stroke();
      octx.restore();
    }
  }

  /** Size the canvases to the view; `fit` also fits the image in it. */
  const layout = (fit = false) => {
    const box = view.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    const cw = Math.max(1, Math.round(box.width * dpr));
    const ch = Math.max(1, Math.round(box.height * dpr));
    if (cw !== v.cw || ch !== v.ch) {
      // Keep the middle of the view where it was.
      v.ox += (cw - v.cw) / 2;
      v.oy += (ch - v.ch) / 2;
      canvas.width = overlay.width = cw;
      canvas.height = overlay.height = ch;
      v.cw = cw;
      v.ch = ch;
      v.dpr = dpr;
      v.frame = ctx.createImageData(cw, ch);
    }
    if (fit) {
      v.z = Math.min((cw * 0.96) / W, (ch * 0.96) / H, dpr);
      v.ox = (cw - W * v.z) / 2;
      v.oy = (ch - H * v.z) / 2;
    }
    syncZoom();
    invalidate();
  };

  const zoomLabel = h('span', { class: 'lq-zoom-label' });
  const syncZoom = () => { zoomLabel.textContent = `${Math.round((v.z / v.dpr) * 1000) / 10}%`; };
  const zoomAt = (factor, cx = v.cw / 2, cy = v.ch / 2) => {
    const z = Math.min(32 * v.dpr, Math.max(0.01, v.z * factor));
    const qx = (cx - v.ox) / v.z;
    const qy = (cy - v.oy) / v.z;
    v.z = z;
    v.ox = cx - qx * z;
    v.oy = cy - qy * z;
    syncZoom();
    invalidate();
  };

  /* ---------- Editing ---------- */

  const pushUndo = () => {
    undoStack.push(field.snapshot());
    if (undoStack.length > UNDO_STEPS) undoStack.shift();
    redoStack.length = 0;
  };
  const undo = () => {
    if (!undoStack.length) return;
    redoStack.push(field.snapshot());
    field.restore(undoStack.pop());
    invalidate();
  };
  const redo = () => {
    if (!redoStack.length) return;
    undoStack.push(field.snapshot());
    field.restore(redoStack.pop());
    invalidate();
  };

  function dabAt(pt, dx, dy) {
    const changed = field.dab(pt.x, pt.y, p.size / 2, {
      tool: settings.tool, density: p.density / 100, pressure: (p.pressure / 100) * stroke.pressure,
      rate: p.rate / 100, dx, dy, reverse: stroke.alt,
    });
    if (changed) invalidate(changed);
  }

  /** Brush along the pointer's path in steps of a quarter of the radius. */
  const strokeTo = (pt) => {
    const s = stroke;
    const dx = pt.x - s.last.x;
    const dy = pt.y - s.last.y;
    const dist = Math.hypot(dx, dy);
    if (!dist) return;
    const n = Math.max(1, Math.ceil(dist / Math.max(1, p.size / 8)));
    for (let k = 1; k <= n; k++) dabAt({ x: s.last.x + (dx * k) / n, y: s.last.y + (dy * k) / n }, dx / n, dy / n);
    s.last = pt;
  };

  const point = (e) => {
    const r = overlay.getBoundingClientRect();
    const cx = (e.clientX - r.left) * v.dpr;
    const cy = (e.clientY - r.top) * v.dpr;
    return { cx, cy, x: (cx - v.ox) / v.z, y: (cy - v.oy) / v.z };
  };

  overlay.addEventListener('pointerdown', (e) => {
    overlay.focus();
    const pt = point(e);
    if (e.button === 1 || (e.button === 0 && (v.space || settings.tool === 'hand'))) {
      e.preventDefault();
      overlay.setPointerCapture(e.pointerId);
      stroke = { pan: true, x: e.clientX, y: e.clientY, ox: v.ox, oy: v.oy };
      return;
    }
    if (e.button !== 0) return;
    if (settings.tool === 'zoom') {
      zoomAt(e.altKey ? 0.5 : 2, pt.cx, pt.cy);
      return;
    }
    overlay.setPointerCapture(e.pointerId);
    pushUndo();
    stroke = { last: pt, cur: pt, alt: e.altKey, pressure: e.pointerType === 'pen' ? Math.max(0.05, e.pressure || 0.5) : 1 };
    if (!CONTINUOUS.has(settings.tool)) dabAt(pt, 0, 0);
    schedule();
  });
  overlay.addEventListener('pointermove', (e) => {
    const pt = point(e);
    v.hover = pt;
    if (stroke?.pan) {
      v.ox = stroke.ox + (e.clientX - stroke.x) * v.dpr;
      v.oy = stroke.oy + (e.clientY - stroke.y) * v.dpr;
      invalidate();
      return;
    }
    if (stroke) {
      stroke.alt = e.altKey;
      if (e.pointerType === 'pen') stroke.pressure = Math.max(0.05, e.pressure || 0.5);
      stroke.cur = pt;
      // Twirl, pucker and the like work over time (see frame); the others follow the pointer.
      if (!CONTINUOUS.has(settings.tool)) strokeTo(pt);
    }
    schedule();
  });
  const end = () => {
    stroke = null;
    schedule();
  };
  overlay.addEventListener('pointerup', end);
  overlay.addEventListener('pointercancel', end);
  overlay.addEventListener('pointerleave', () => {
    v.hover = null;
    schedule();
  });
  overlay.addEventListener('wheel', (e) => {
    e.preventDefault();
    const pt = point(e);
    zoomAt(e.deltaY < 0 ? 1.25 : 0.8, pt.cx, pt.cy);
  }, { passive: false });

  /* ---------- Controls ---------- */

  const remember = () => Object.assign(settings, p);
  const toolButtons = TOOLS.map((t) => {
    const b = h('button', {
      type: 'button', class: 'icon-btn lq-tool', title: `${t.label} (${t.key})`, 'aria-label': t.label,
      onClick: () => setTool(t.id),
    }, icon(t.icon, 18));
    b.dataset.tool = t.id;
    return b;
  });
  const setTool = (id) => {
    settings.tool = id;
    for (const b of toolButtons) {
      const on = b.dataset.tool === id;
      b.classList.toggle('active', on);
      b.setAttribute('aria-pressed', String(on));
    }
    overlay.style.cursor = id === 'hand' ? 'grab' : id === 'zoom' ? 'zoom-in' : 'crosshair';
    schedule();
  };

  const controls = paramControls([
    { key: 'size', label: 'Size', min: 1, max: 1500, value: p.size, unit: 'px' },
    { key: 'pressure', label: 'Pressure', min: 1, max: 100, value: p.pressure, unit: '%' },
    { key: 'density', label: 'Density', min: 0, max: 100, value: p.density, unit: '%' },
    { key: 'rate', label: 'Rate', min: 0, max: 100, value: p.rate, unit: '%' },
  ], p, () => {
    remember();
    schedule();
  });
  const setSize = (size) => {
    p.size = Math.min(1500, Math.max(1, Math.round(size)));
    for (const el of controls.querySelectorAll('input[aria-label="Size"]')) el.value = p.size;
    remember();
    schedule();
  };

  const props = h('div', { class: 'lq-props' },
    h('div', { class: 'adjust-heading' }, 'Brush Tool Options'),
    controls,
    h('div', { class: 'adjust-heading' }, 'Reconstruct'),
    h('div', { class: 'lq-row' },
      button({ label: 'Restore All', title: 'Remove every distortion', onClick: () => {
        pushUndo();
        field.d.fill(0);
        invalidate();
      } })),
    h('div', { class: 'adjust-heading' }, 'Mask'),
    checkbox({ label: 'Show Mask', checked: settings.showMask, onChange: (on) => {
      settings.showMask = on;
      invalidate();
    } }),
    h('div', { class: 'lq-row' },
      button({ label: 'Thaw All', title: 'Clear the freeze mask', onClick: () => {
        pushUndo();
        field.freeze.fill(0);
        invalidate();
      } })),
    h('div', { class: 'adjust-heading' }, 'View'),
    checkbox({ label: 'Show Mesh', checked: settings.showMesh, onChange: (on) => {
      settings.showMesh = on;
      schedule();
    } }),
    h('div', { class: 'lq-row' },
      iconButton('zoom-out', 'Zoom out (Ctrl+−)', () => zoomAt(0.8)),
      zoomLabel,
      iconButton('zoom-in', 'Zoom in (Ctrl++)', () => zoomAt(1.25)),
      button({ label: 'Fit', title: 'Fit in view (Ctrl+0)', onClick: () => layout(true) })),
    h('p', { class: 'recover-hint' }, 'Ctrl+Z undoes a stroke. [ and ] change the brush size. Scroll to zoom; hold Space or use the Hand to pan.'));

  const onKey = (e) => {
    if (e.target instanceof HTMLElement && e.target.matches('input[type=number], input[type=text], textarea')) return;
    const mod = e.ctrlKey || e.metaKey;
    const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
    let handled = true;
    if (e.code === 'Space') {
      if (!v.space) {
        v.space = true;
        overlay.style.cursor = 'grab';
        schedule();
      }
    } else if (mod && key === 'z') {
      if (e.shiftKey) redo();
      else undo();
    } else if (mod && (key === '=' || key === '+')) zoomAt(1.25);
    else if (mod && key === '-') zoomAt(0.8);
    else if (mod && key === '0') layout(true);
    else if (mod || e.altKey) handled = false;
    else if (key === '[') setSize(p.size / 1.2);
    else if (key === ']') setSize(p.size * 1.2);
    else {
      const t = TOOLS.find((tool) => tool.key.toLowerCase() === key);
      if (t) setTool(t.id);
      else handled = false;
    }
    if (handled) {
      e.preventDefault();
      e.stopPropagation();
    }
  };
  const onKeyUp = (e) => {
    if (e.code !== 'Space') return;
    v.space = false;
    setTool(settings.tool);
  };

  let ok = false;
  const ro = new ResizeObserver(() => layout(false));
  openModal({
    title: 'Liquify',
    width: 1180,
    body: h('div', { class: 'liquify' },
      h('div', { class: 'lq-tools', role: 'toolbar', 'aria-label': 'Liquify tools' }, toolButtons),
      view, props),
    buttons: [{ label: 'Cancel' }, { label: 'OK', primary: true, onClick: () => { ok = true; } }],
    onClose: () => {
      ro.disconnect();
      cancelAnimationFrame(v.raf);
      document.removeEventListener('keydown', onKey, true);
      document.removeEventListener('keyup', onKeyUp, true);
      if (!ok || field.isEmpty()) return;
      edit.compute(() => renderLiquify(field, src, new ImageData(W, H), { x: 0, y: 0, w: W, h: H }));
      edit.commit('Liquify');
    },
  });
  document.addEventListener('keydown', onKey, true);
  document.addEventListener('keyup', onKeyUp, true);
  setTool(settings.tool);
  layout(true);
  ro.observe(view);
  // After the dialog focuses its first control, hand the keys to the preview.
  setTimeout(() => overlay.focus());
}
