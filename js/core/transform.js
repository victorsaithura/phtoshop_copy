import { createCanvas, rectIntersect } from './utils.js';
import { PSDocument } from './document.js';
import { renderText } from './text.js';

/*
 * Whole-document operations (Image menu) and layer transforms (Edit ▸ Transform).
 * Document operations resize every layer and drop the selection, recorded as
 * one undoable step.
 */

const docSpec = (doc) => ({ structure: true, selection: true, layers: doc.layers.slice() });

/** Draw `canvas` (placed at x, y) through a document-space matrix; returns the new canvas and position. */
export function transformCanvasAt(canvas, x, y, m, smooth) {
  const w = canvas.width;
  const h = canvas.height;
  const pts = [[x, y], [x + w, y], [x, y + h], [x + w, y + h]].map(([px, py]) => m.transformPoint(new DOMPoint(px, py)));
  const minX = Math.floor(Math.min(...pts.map((p) => p.x)) + 1e-6);
  const minY = Math.floor(Math.min(...pts.map((p) => p.y)) + 1e-6);
  const maxX = Math.ceil(Math.max(...pts.map((p) => p.x)) - 1e-6);
  const maxY = Math.ceil(Math.max(...pts.map((p) => p.y)) - 1e-6);
  const c = createCanvas(maxX - minX, maxY - minY, { readFrequently: false });
  const ctx = c.getContext('2d');
  ctx.imageSmoothingEnabled = smooth;
  ctx.imageSmoothingQuality = 'high';
  ctx.setTransform(new DOMMatrix().translate(-minX, -minY).multiply(m));
  ctx.drawImage(canvas, x, y);
  return { canvas: c, x: minX, y: minY };
}

/** Redraw a layer (and its mask) through a document-space matrix. */
export function transformLayerCanvas(layer, m, smooth) {
  const mask = layer.mask;
  const maskAt = mask ? transformCanvasAt(mask.canvas, layer.x + mask.ox, layer.y + mask.oy, m, smooth) : null;
  const t = transformCanvasAt(layer.canvas, layer.x, layer.y, m, smooth);
  layer.canvas = t.canvas;
  layer.x = t.x;
  layer.y = t.y;
  if (maskAt) {
    mask.canvas = maskAt.canvas;
    mask.ox = maskAt.x - layer.x;
    mask.oy = maskAt.y - layer.y;
    mask.ensureCovers(layer, layer.bounds);
  }
}

/** Resample with repeated halving for smoother large reductions. */
export function resampleCanvas(src, w, h, method = 'smooth') {
  let cur = src;
  if (method === 'smooth') {
    while (cur.width / 2 >= w && cur.height / 2 >= h) {
      const half = createCanvas(Math.max(1, Math.round(cur.width / 2)), Math.max(1, Math.round(cur.height / 2)));
      const hc = half.getContext('2d');
      hc.imageSmoothingQuality = 'high';
      hc.drawImage(cur, 0, 0, half.width, half.height);
      cur = half;
    }
  }
  const out = createCanvas(w, h);
  const ctx = out.getContext('2d');
  ctx.imageSmoothingEnabled = method === 'smooth';
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(cur, 0, 0, w, h);
  return out;
}

export function resizeImage(app, w, h, method = 'smooth') {
  const doc = app.doc;
  if (w === doc.width && h === doc.height) return;
  const sx = w / doc.width;
  const sy = h / doc.height;
  app.transact('Image Size', docSpec(doc), () => {
    for (const l of doc.layers) {
      const x0 = Math.round(l.x * sx);
      const y0 = Math.round(l.y * sy);
      // Resize the mask in document space first (it is stored relative to the layer).
      let maskAt = null;
      if (l.mask) {
        const m = l.mask;
        const mx = Math.round((l.x + m.ox) * sx);
        const my = Math.round((l.y + m.oy) * sy);
        const mw = Math.max(1, Math.round((l.x + m.ox + m.width) * sx) - mx);
        const mh = Math.max(1, Math.round((l.y + m.oy + m.height) * sy) - my);
        maskAt = { canvas: resampleCanvas(m.canvas, mw, mh, method), x: mx, y: my };
      }
      if (l.text) {
        // Type stays editable: scale the font instead of the pixels.
        l.text = { ...l.text, size: Math.max(1, Math.round(l.text.size * Math.sqrt(sx * sy) * 10) / 10) };
        renderText(l, false);
      } else {
        const nw = Math.max(1, Math.round((l.x + l.width) * sx) - x0);
        const nh = Math.max(1, Math.round((l.y + l.height) * sy) - y0);
        l.canvas = resampleCanvas(l.canvas, nw, nh, method);
      }
      l.x = x0;
      l.y = y0;
      if (maskAt) {
        l.mask.canvas = maskAt.canvas;
        l.mask.ox = maskAt.x - x0;
        l.mask.oy = maskAt.y - y0;
        l.mask.ensureCovers(l, l.bounds);
      }
    }
    doc.width = w;
    doc.height = h;
    doc.selection.reset(w, h);
  });
  app.view.fit(w, h);
  app.viewChanged();
}

/**
 * Canvas Size. anchor: { x, y } in 0…1 (0.5, 0.5 = centre). `fill` colours the
 * new area on the bottom layer (null = transparent).
 */
export function resizeCanvas(app, w, h, anchor = { x: 0.5, y: 0.5 }, fill = null) {
  const doc = app.doc;
  if (w === doc.width && h === doc.height) return;
  const dx = Math.round((w - doc.width) * anchor.x);
  const dy = Math.round((h - doc.height) * anchor.y);
  app.transact('Canvas Size', docSpec(doc), () => {
    const oldRect = { x: dx, y: dy, w: doc.width, h: doc.height };
    for (const l of doc.layers) {
      l.x += dx;
      l.y += dy;
    }
    doc.width = w;
    doc.height = h;
    doc.selection.reset(w, h);
    const bottom = doc.layers[0];
    if (fill && bottom) {
      const ext = createCanvas(w, h);
      const ec = ext.getContext('2d');
      ec.fillStyle = fill;
      ec.fillRect(0, 0, w, h);
      const keep = rectIntersect(oldRect, doc.bounds);
      if (keep) ec.clearRect(keep.x, keep.y, keep.w, keep.h);
      bottom.ensureCovers(doc.bounds);
      const bc = bottom.ctx;
      bc.save();
      bc.globalCompositeOperation = 'destination-over';
      bc.drawImage(ext, -bottom.x, -bottom.y);
      bc.restore();
    }
  });
  app.view.fit(w, h);
  app.viewChanged();
}

/** Crop to rect (document coordinates; may extend past the canvas). */
export function cropDocument(app, rect, deleteCropped = true) {
  const doc = app.doc;
  const r = { x: Math.round(rect.x), y: Math.round(rect.y), w: Math.round(rect.w), h: Math.round(rect.h) };
  if (r.w < 1 || r.h < 1) return;
  if (r.x === 0 && r.y === 0 && r.w === doc.width && r.h === doc.height) return;
  app.transact('Crop', docSpec(doc), () => {
    for (const l of doc.layers) {
      l.x -= r.x;
      l.y -= r.y;
      if (!deleteCropped) continue;
      const keep = rectIntersect(l.bounds, { x: 0, y: 0, w: r.w, h: r.h });
      if (keep && keep.w === l.width && keep.h === l.height) continue;
      l.text = null;
      const c = createCanvas(keep ? keep.w : 1, keep ? keep.h : 1);
      if (keep) c.getContext('2d').drawImage(l.canvas, l.x - keep.x, l.y - keep.y);
      const oldX = l.x;
      const oldY = l.y;
      l.canvas = c;
      l.x = keep ? keep.x : 0;
      l.y = keep ? keep.y : 0;
      if (l.mask) {
        // The mask keeps its place in the document.
        l.mask.ox += oldX - l.x;
        l.mask.oy += oldY - l.y;
      }
    }
    doc.width = r.w;
    doc.height = r.h;
    doc.selection.reset(r.w, r.h);
  });
  app.view.fit(r.w, r.h);
  app.viewChanged();
}

/** Rotate the whole image clockwise by `deg` degrees. */
export function rotateDocument(app, deg) {
  const doc = app.doc;
  const W = doc.width;
  const H = doc.height;
  const turn = ((deg % 360) + 360) % 360;
  if (!turn) return;
  let m;
  let nw;
  let nh;
  if (turn === 90) [m, nw, nh] = [new DOMMatrix([0, 1, -1, 0, H, 0]), H, W];
  else if (turn === 180) [m, nw, nh] = [new DOMMatrix([-1, 0, 0, -1, W, H]), W, H];
  else if (turn === 270) [m, nw, nh] = [new DOMMatrix([0, -1, 1, 0, 0, W]), H, W];
  else {
    const rad = (turn * Math.PI) / 180;
    nw = Math.ceil(Math.abs(W * Math.cos(rad)) + Math.abs(H * Math.sin(rad)) - 1e-6);
    nh = Math.ceil(Math.abs(W * Math.sin(rad)) + Math.abs(H * Math.cos(rad)) - 1e-6);
    m = new DOMMatrix().translate(nw / 2, nh / 2).rotate(turn).translate(-W / 2, -H / 2);
  }
  const exact = turn % 90 === 0;
  const label = exact ? (turn === 180 ? 'Rotate 180°' : turn === 90 ? 'Rotate 90° Clockwise' : 'Rotate 90° Counter Clockwise') : 'Rotate Canvas';
  app.transact(label, docSpec(doc), () => {
    for (const l of doc.layers) {
      l.text = null;
      transformLayerCanvas(l, m, !exact);
    }
    doc.width = nw;
    doc.height = nh;
    doc.selection.reset(nw, nh);
  });
  app.view.fit(nw, nh);
  app.viewChanged();
}

export function flipDocument(app, horizontal) {
  const doc = app.doc;
  const m = horizontal ? new DOMMatrix([-1, 0, 0, 1, doc.width, 0]) : new DOMMatrix([1, 0, 0, -1, 0, doc.height]);
  app.transact(horizontal ? 'Flip Canvas Horizontal' : 'Flip Canvas Vertical', docSpec(doc), () => {
    for (const l of doc.layers) {
      l.text = null;
      transformLayerCanvas(l, m, false);
    }
    doc.selection.reset(doc.width, doc.height);
  });
}

/** Bounding box of a layer's non-transparent pixels (document coordinates). */
export function contentBounds(layer) {
  const { width: w, height: h } = layer;
  const data = layer.ctx.getImageData(0, 0, w, h).data;
  let minX = w, minY = h, maxX = -1, maxY = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!data[(y * w + x) * 4 + 3]) continue;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  if (maxX < 0) return null;
  return { x: layer.x + minX, y: layer.y + minY, w: maxX - minX + 1, h: maxY - minY + 1 };
}

/** Edit ▸ Transform on the active layer, around the centre of its content. */
export function transformLayer(app, kind) {
  const layer = app.editableLayer('transform command');
  if (!layer) return;
  const b = contentBounds(layer);
  if (!b) return;
  // Whole-pixel centre keeps 90° turns on the pixel grid.
  const cx = kind.startsWith('rot90') ? Math.round(b.x + b.w / 2) : b.x + b.w / 2;
  const cy = kind.startsWith('rot90') ? Math.round(b.y + b.h / 2) : b.y + b.h / 2;
  const M = {
    flipH: [[-1, 0, 0, 1, 2 * cx, 0], 'Flip Horizontal'],
    flipV: [[1, 0, 0, -1, 0, 2 * cy], 'Flip Vertical'],
    rot180: [[-1, 0, 0, -1, 2 * cx, 2 * cy], 'Rotate 180°'],
    rot90cw: [[0, 1, -1, 0, cx + cy, cy - cx], 'Rotate 90° Clockwise'],
    rot90ccw: [[0, -1, 1, 0, cx - cy, cx + cy], 'Rotate 90° Counter Clockwise'],
  }[kind];
  if (!M) return;
  app.transact(M[1], { layers: [layer] }, () => transformLayerCanvas(layer, new DOMMatrix(M[0]), false));
}

export function duplicateDocument(app, name) {
  const src = app.doc;
  const doc = new PSDocument({ width: src.width, height: src.height, name, background: 'transparent' });
  doc.layers = src.layers.map((l) => {
    const c = l.clone(l.name);
    c.locked = l.locked;
    return c;
  });
  doc.activeId = doc.layers[Math.max(0, src.activeIndex)].id;
  doc.layerCounter = src.layerCounter;
  app.addDocument(doc, 'Duplicate Image');
}
