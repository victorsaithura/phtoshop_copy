import { createCanvas, downloadBlob } from './core/utils.js';
import { PSDocument } from './core/document.js';
import { Layer } from './core/layer.js';
import { isProjectFile, parseProject } from './project.js';

export const MAX_SIDE = 16384;
export const MAX_PIXELS = 100_000_000;

const IMAGE_EXT = /\.(png|jpe?g|gif|webp|bmp|svg|avif|ico)$/i;
export const isImageFile = (f) => !!f && ((f.type || '').startsWith('image/') || IMAGE_EXT.test(f.name || ''));
const TEXT_INPUTS = new Set(['text', 'number', 'search', 'email', 'password', 'url', 'tel']);
/** True when keystrokes belong to a form field rather than to shortcuts. */
export const isTyping = (el) =>
  !!el && ((el.tagName === 'INPUT' && TEXT_INPUTS.has(el.type)) || el.tagName === 'TEXTAREA' ||
    el.tagName === 'SELECT' || el.isContentEditable);

function loadViaImgElement(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('unsupported or damaged image'));
    };
    img.src = url;
  });
}

/** Decode an image file into a canvas. */
export async function loadImage(file) {
  let source;
  try {
    source = await createImageBitmap(file);
  } catch {
    source = await loadViaImgElement(file);
  }
  const w = source.naturalWidth || source.width;
  const h = source.naturalHeight || source.height;
  if (!w || !h) throw new Error('the image is empty');
  if (w > MAX_SIDE || h > MAX_SIDE || w * h > MAX_PIXELS) throw new Error(`the image is too large (${w} × ${h} px)`);
  const c = createCanvas(w, h);
  c.getContext('2d').drawImage(source, 0, 0, w, h);
  source.close?.();
  return c;
}

export function pickFiles({ multiple = false, accept = 'image/*,.svg,.pfp' } = {}) {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.multiple = multiple;
    input.addEventListener('change', () => resolve([...input.files]));
    input.addEventListener('cancel', () => resolve([]));
    input.click();
  });
}

const stripExt = (name) => (name || '').replace(/\.[^.]+$/, '');

/** Open each image or PhotoForge project as its own document. */
export async function openFiles(app, files) {
  const projects = files.filter(isProjectFile);
  const images = files.filter((f) => !isProjectFile(f) && isImageFile(f));
  if (files.length && !images.length && !projects.length) {
    app.toast('That file type is not supported. Open a PNG, JPEG, WebP, GIF, BMP or SVG image, or a .pfp project.');
  }
  for (const file of projects) {
    try {
      app.addDocument(await parseProject(await file.text()), 'Open');
    } catch (err) {
      app.toast(`Could not open ${file.name}: ${err.message}.`);
    }
  }
  for (const file of images) {
    try {
      const canvas = await loadImage(file);
      app.addDocument(PSDocument.fromImage(canvas, file.name), 'Open');
    } catch (err) {
      app.toast(`Could not open ${file.name}: ${err.message}.`);
    }
  }
}

/**
 * Add an image as a new layer. Without a position it is centred and, if
 * fit is true, scaled down to fit the canvas (like File ▸ Place).
 */
export function placeCanvas(app, canvas, { name, position = null, fit = true, label = 'Place' } = {}) {
  const doc = app.doc;
  if (!doc) return;
  let src = canvas;
  let x;
  let y;
  if (position) {
    ({ x, y } = position);
  } else {
    const scale = fit ? Math.min(1, doc.width / canvas.width, doc.height / canvas.height) : 1;
    if (scale < 1) {
      src = createCanvas(canvas.width * scale, canvas.height * scale);
      const c = src.getContext('2d');
      c.imageSmoothingQuality = 'high';
      c.drawImage(canvas, 0, 0, src.width, src.height);
    }
    x = Math.round((doc.width - src.width) / 2);
    y = Math.round((doc.height - src.height) / 2);
  }
  app.transact(label, { structure: true }, () => {
    doc.addLayer(new Layer({ name: name || doc.nextLayerName(), canvas: src, x, y }));
  });
}

/** Add image files to the current document as layers. */
export async function placeFiles(app, files, { fit = true, label = 'Place' } = {}) {
  for (const file of files.filter(isImageFile)) {
    try {
      const canvas = await loadImage(file);
      placeCanvas(app, canvas, { name: stripExt(file.name) || undefined, fit, label });
    } catch (err) {
      app.toast(`Could not place ${file.name}: ${err.message}.`);
    }
  }
}

/**
 * Paste an image read from the system clipboard. If it is our own copy
 * (same size as the internal clipboard) it goes back in place.
 */
export function pasteImage(app, canvas) {
  const cb = app.clipboard;
  if (cb && cb.canvas.width === canvas.width && cb.canvas.height === canvas.height) pasteInternal(app);
  else placeCanvas(app, canvas, { fit: false, label: 'Paste' });
}

/** Paste the internal clipboard as a new layer. */
export function pasteInternal(app) {
  const cb = app.clipboard;
  const doc = app.doc;
  if (!cb || !doc) return;
  const position = cb.docId === doc.id ? { x: cb.x, y: cb.y } : null;
  placeCanvas(app, cb.canvas, { position, fit: false, label: 'Paste' });
}

/** Best effort: put a PNG of the canvas on the system clipboard. */
export async function copyToSystemClipboard(canvas) {
  if (!navigator.clipboard?.write || typeof ClipboardItem === 'undefined') return false;
  try {
    const blob = new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('encode'))), 'image/png'));
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
    return true;
  } catch {
    return false;
  }
}

/** Flatten, optionally scale, encode and download. */
export async function exportDocument(doc, { format = 'png', quality = 0.92, scale = 1, filename = 'image' } = {}) {
  let canvas = doc.composite();
  if (scale !== 1) {
    const s = createCanvas(Math.max(1, Math.round(canvas.width * scale)), Math.max(1, Math.round(canvas.height * scale)));
    const c = s.getContext('2d');
    c.imageSmoothingQuality = 'high';
    c.drawImage(canvas, 0, 0, s.width, s.height);
    canvas = s;
  }
  if (format === 'jpeg') {
    const flat = createCanvas(canvas.width, canvas.height);
    const c = flat.getContext('2d');
    c.fillStyle = '#ffffff';
    c.fillRect(0, 0, flat.width, flat.height);
    c.drawImage(canvas, 0, 0);
    canvas = flat;
  }
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, `image/${format}`, quality));
  if (!blob) throw new Error('the browser could not encode the image');
  // Browsers without WebP encoding silently fall back to PNG.
  const ext = blob.type === 'image/jpeg' ? 'jpg' : (blob.type.split('/')[1] || 'png');
  downloadBlob(blob, `${filename}.${ext}`);
}

/** Drag-and-drop files anywhere, and Ctrl+V paste of images. */
export function setupDropAndPaste(app) {
  const overlay = document.getElementById('drop-overlay');
  let depth = 0;
  const hasFiles = (e) => [...(e.dataTransfer?.types || [])].includes('Files');

  window.addEventListener('dragenter', (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    depth++;
    overlay.firstElementChild.textContent = app.doc
      ? 'Drop to add as a new layer (hold Shift to open as a new document)'
      : 'Drop image to open';
    overlay.hidden = false;
  });
  window.addEventListener('dragover', (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
  });
  window.addEventListener('dragleave', (e) => {
    if (!hasFiles(e)) return;
    depth = Math.max(0, depth - 1);
    if (!depth) overlay.hidden = true;
  });
  window.addEventListener('drop', (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    depth = 0;
    overlay.hidden = true;
    const files = [...e.dataTransfer.files];
    // Projects always open as documents; images become layers unless Shift is held.
    const projects = files.filter(isProjectFile);
    const images = files.filter((f) => !isProjectFile(f));
    if (projects.length) openFiles(app, projects);
    if (!images.length) return;
    if (app.doc && !e.shiftKey) placeFiles(app, images);
    else openFiles(app, images);
  });

  window.addEventListener('paste', (e) => {
    if (isTyping(e.target) || document.querySelector('.modal-backdrop')) return;
    const files = [...(e.clipboardData?.files || [])].filter(isImageFile);
    const internal = app.clipboard;
    // Our own copies are also on the system clipboard when the browser allowed it,
    // so prefer the system image unless that copy failed.
    if (files.length && (!internal || internal.systemCopied)) {
      e.preventDefault();
      if (!app.doc) {
        openFiles(app, files);
        return;
      }
      loadImage(files[0])
        .then((canvas) => pasteImage(app, canvas))
        .catch((err) => app.toast(`Could not paste: ${err.message}.`));
    } else if (internal && app.doc) {
      e.preventDefault();
      pasteInternal(app);
    }
  });
}
