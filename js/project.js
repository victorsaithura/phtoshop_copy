import { PSDocument } from './core/document.js';
import { Layer, BLEND_MODES } from './core/layer.js';
import { Mask } from './core/mask.js';
import { TEXT_DEFAULTS, FONTS } from './core/text.js';
import { clamp, createCanvas, downloadBlob, normalizeHex } from './core/utils.js';

/*
 * PhotoForge project files (.pfp): JSON with every layer as a PNG data URL,
 * plus layer settings, type layer text and layer masks.
 */

export const PROJECT_EXT = '.pfp';
export const isProjectFile = (f) => /\.pfp$/i.test(f?.name || '');
const MAX_SIDE = 16384;
const BLEND_VALUES = new Set(BLEND_MODES.filter(Boolean).map((m) => m.value));

export function serializeDocument(doc) {
  return {
    format: 'photoforge',
    version: 1,
    name: doc.name,
    width: doc.width,
    height: doc.height,
    activeIndex: doc.activeIndex,
    layerCounter: doc.layerCounter,
    layers: doc.layers.map((l) => ({
      name: l.name,
      x: l.x,
      y: l.y,
      visible: l.visible,
      opacity: l.opacity,
      blendMode: l.blendMode,
      locked: l.locked,
      image: l.canvas.toDataURL('image/png'),
      text: l.text ? { ...l.text } : null,
      mask: l.mask
        ? { x: l.mask.ox, y: l.mask.oy, outside: l.mask.outside, enabled: l.mask.enabled, image: l.mask.canvas.toDataURL('image/png') }
        : null,
    })),
  };
}

export function saveProject(doc, baseName) {
  const json = JSON.stringify(serializeDocument(doc));
  downloadBlob(new Blob([json], { type: 'application/json' }), `${baseName}${PROJECT_EXT}`);
}

/** Decode an embedded PNG. Only inline data URLs are accepted (no network requests). */
async function loadCanvas(dataUrl) {
  if (typeof dataUrl !== 'string' || !dataUrl.startsWith('data:image/')) throw new Error('the file contains an invalid image');
  const img = new Image();
  img.src = dataUrl;
  await img.decode();
  const c = createCanvas(img.naturalWidth, img.naturalHeight);
  c.getContext('2d').drawImage(img, 0, 0);
  return c;
}

const num = (v, fallback = 0) => (Number.isFinite(Number(v)) ? Number(v) : fallback);

function cleanText(t) {
  if (!t || typeof t !== 'object') return null;
  return {
    ...TEXT_DEFAULTS,
    content: String(t.content ?? ''),
    font: FONTS.includes(t.font) ? t.font : TEXT_DEFAULTS.font,
    size: clamp(num(t.size, TEXT_DEFAULTS.size), 1, 1000),
    color: normalizeHex(t.color) || TEXT_DEFAULTS.color,
    bold: !!t.bold,
    italic: !!t.italic,
    align: ['left', 'center', 'right'].includes(t.align) ? t.align : 'left',
  };
}

/** Build a document from project JSON text. */
export async function parseProject(text) {
  let p;
  try {
    p = JSON.parse(text);
  } catch {
    throw new Error('the file is not a PhotoForge project');
  }
  if (!p || p.format !== 'photoforge' || !Array.isArray(p.layers) || !p.layers.length) {
    throw new Error('the file is not a PhotoForge project');
  }
  const width = Math.round(num(p.width));
  const height = Math.round(num(p.height));
  if (width < 1 || height < 1 || width > MAX_SIDE || height > MAX_SIDE) throw new Error('the project has an invalid size');

  const doc = new PSDocument({ width, height, name: String(p.name || 'Untitled'), background: 'transparent' });
  doc.layers = [];
  for (const d of p.layers) {
    const layer = new Layer({ name: String(d.name ?? 'Layer'), canvas: await loadCanvas(d.image), x: Math.round(num(d.x)), y: Math.round(num(d.y)) });
    layer.visible = d.visible !== false;
    layer.opacity = clamp(num(d.opacity, 1), 0, 1);
    layer.blendMode = BLEND_VALUES.has(d.blendMode) ? d.blendMode : 'source-over';
    layer.locked = !!d.locked;
    layer.text = cleanText(d.text);
    if (d.mask && typeof d.mask === 'object') {
      const m = new Mask(1, 1, Math.round(num(d.mask.x)), Math.round(num(d.mask.y)), 0);
      m.canvas = await loadCanvas(d.mask.image);
      m.outside = clamp(Math.round(num(d.mask.outside, 255)), 0, 255);
      m.enabled = d.mask.enabled !== false;
      layer.mask = m;
    }
    doc.layers.push(layer);
  }
  doc.activeId = doc.layers[clamp(Math.round(num(p.activeIndex)), 0, doc.layers.length - 1)].id;
  doc.layerCounter = Math.max(0, Math.round(num(p.layerCounter, doc.layers.length)));
  return doc;
}
