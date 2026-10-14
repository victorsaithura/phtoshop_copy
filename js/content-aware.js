import { inpaint } from './core/inpaint.js';
import { openModal } from './ui/dialogs.js';
import { h } from './ui/dom.js';
import { rectInflate, rectIntersect } from './core/utils.js';

let worker = null;
let jobs = 0;

/**
 * Fill in a worker so the page stays responsive (or here, if workers are
 * unavailable). Returns { promise, cancel }; the promise resolves with the
 * filled pixels, or null when cancelled.
 */
function runInpaint(data, hole, w, h, onProgress) {
  let cancelled = false;
  const here = () => new Promise((resolve) => {
    setTimeout(() => resolve(cancelled ? null : inpaint(data, hole, w, h, { onProgress })));
  });
  try {
    worker ||= new Worker(new URL('./workers/inpaint-worker.js', import.meta.url), { type: 'module' });
  } catch {
    worker = null;
  }
  if (!worker) return { promise: here(), cancel: () => { cancelled = true; } };
  const id = ++jobs;
  const w0 = worker;
  let stop = () => {};
  const promise = new Promise((resolve, reject) => {
    const cleanup = () => {
      w0.removeEventListener('message', onMessage);
      w0.removeEventListener('error', onError);
    };
    const onMessage = (e) => {
      const m = e.data;
      if (m.id !== id) return;
      if (m.progress != null) {
        onProgress(m.progress);
        return;
      }
      cleanup();
      if (m.error) reject(new Error(m.error));
      else resolve(m.result);
    };
    // A worker that can't start (no module workers, blocked script…): do the work here.
    const onError = (e) => {
      e.preventDefault?.();
      cleanup();
      if (worker === w0) worker = null;
      here().then(resolve, reject);
    };
    w0.addEventListener('message', onMessage);
    w0.addEventListener('error', onError);
    stop = () => {
      cleanup();
      resolve(null);
    };
    w0.postMessage({ id, data, hole, w, h });
  });
  return {
    promise,
    cancel: () => {
      cancelled = true;
      // Stop the work outright; a fresh worker starts with the next fill.
      w0.terminate();
      if (worker === w0) worker = null;
      stop();
    },
  };
}

/**
 * Edit ▸ Content-Aware Fill: replace the selected pixels of the active layer
 * with texture synthesised from around the selection.
 */
export async function contentAwareFill(app) {
  const doc = app.doc;
  const sel = doc?.selection;
  if (!sel || sel.isEmpty()) {
    app.toast('Select what to remove first, then use Content-Aware Fill.');
    return;
  }
  const layer = app.editableLayer('Content-Aware Fill');
  if (!layer) return;
  const hb = rectIntersect(sel.bounds, layer.bounds);
  if (!hb) {
    app.toast('Could not fill because the selected area is empty on this layer.');
    return;
  }
  // Sample from a band around the selection as wide as the selection itself.
  const margin = Math.max(40, Math.round(1.2 * Math.max(hb.w, hb.h)));
  const win = rectIntersect(rectInflate(hb, margin), layer.bounds);
  const original = layer.ctx.getImageData(win.x - layer.x, win.y - layer.y, win.w, win.h);
  const alpha = new Uint8Array(win.w * win.h);
  let holes = 0;
  for (let y = 0; y < win.h; y++) {
    const dy = win.y + y;
    if (dy < 0 || dy >= sel.height) continue;
    for (let x = 0; x < win.w; x++) {
      const dx = win.x + x;
      if (dx < 0 || dx >= sel.width) continue;
      const a = sel.alpha[dy * sel.width + dx];
      alpha[y * win.w + x] = a;
      if (a) holes++;
    }
  }
  if (holes > win.w * win.h * 0.85) {
    app.toast('Could not fill: there is too little image around the selection to sample. Select a smaller area.');
    return;
  }

  const fill = h('div', { class: 'progress-fill' });
  let finished = false;
  let job = null;
  const dlg = openModal({
    title: 'Content-Aware Fill',
    width: 340,
    body: h('div', { class: 'progress-wrap' }, h('div', { class: 'progress', role: 'progressbar', 'aria-label': 'Progress' }, fill)),
    buttons: [{ label: 'Cancel' }],
    onClose: () => {
      if (!finished) job?.cancel();
    },
  });
  dlg.el.classList.add('busy');
  job = runInpaint(new Uint8ClampedArray(original.data), alpha, win.w, win.h, (p) => {
    fill.style.width = `${Math.round(p * 100)}%`;
  });
  let out;
  try {
    out = await job.promise;
  } catch (err) {
    out = null;
    app.toast(`Content-Aware Fill failed: ${err.message}`);
  }
  finished = true;
  dlg.close();
  if (!out || app.doc !== doc || !doc.layers.includes(layer)) return;
  // Feathered selections blend the fill in.
  const res = new ImageData(win.w, win.h);
  const o = original.data;
  for (let p = 0, i = 0; p < alpha.length; p++, i += 4) {
    const k = alpha[p] / 255;
    for (let c = 0; c < 4; c++) res.data[i + c] = o[i + c] + (out[i + c] - o[i + c]) * k;
  }
  app.transact('Content-Aware Fill', { layers: [{ layer, rect: win }] }, () => {
    layer.ctx.putImageData(res, win.x - layer.x, win.y - layer.y);
  });
}
