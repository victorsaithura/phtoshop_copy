import { PSDocument, isAncestor } from './core/document.js';
import { Layer, BLEND_MODES, PASS_THROUGH, copyJSON } from './core/layer.js';
import { Mask } from './core/mask.js';
import { TEXT_DEFAULTS, FONTS } from './core/text.js';
import { ADJUSTMENTS, ADJUSTMENT_LAYER_TYPES, defaultParams } from './core/adjustments.js';
import { EFFECTS, effectDefaults } from './core/effects.js';
import { clamp, createCanvas, downloadBlob, normalizeHex } from './core/utils.js';

/*
 * PhotoForge project files (.pfp): JSON with every layer as a PNG data URL,
 * plus layer settings, type layer text, layer masks, groups (version 2: each
 * layer's `parent` is the index of its group), adjustment layers and styles.
 */

export const PROJECT_EXT = '.pfp';
export const isProjectFile = (f) => /\.pfp$/i.test(f?.name || '');
const MAX_SIDE = 16384;
const BLEND_VALUES = new Set(BLEND_MODES.filter(Boolean).map((m) => m.value));

/** The project as plain data; encode(canvas) gives each image (a PNG data URL by default). */
export function serializeDocument(doc, encode = (c) => c.toDataURL('image/png')) {
  return {
    format: 'photoforge',
    version: 2,
    name: doc.name,
    width: doc.width,
    height: doc.height,
    activeIndex: doc.activeIndex,
    layerCounter: doc.layerCounter,
    groupCounter: doc.groupCounter,
    guides: doc.guides.map((g) => ({ ...g })),
    layers: doc.layers.map((l) => ({
      kind: l.kind,
      parent: l.parent ? doc.layers.indexOf(l.parent) : -1,
      collapsed: l.collapsed,
      adjustment: copyJSON(l.adjustment),
      styles: copyJSON(l.styles),
      name: l.name,
      x: l.x,
      y: l.y,
      visible: l.visible,
      opacity: l.opacity,
      blendMode: l.blendMode,
      locked: l.locked,
      image: encode(l.canvas),
      text: l.text ? { ...l.text } : null,
      mask: l.mask
        ? { x: l.mask.ox, y: l.mask.oy, outside: l.mask.outside, enabled: l.mask.enabled, image: encode(l.mask.canvas) }
        : null,
    })),
  };
}

/** Like serializeDocument, but PNG encoding happens off the main thread (for autosave). */
export async function serializeDocumentAsync(doc) {
  const jobs = [];
  const encode = (canvas) => {
    // toBlob copies the pixels now and encodes later, so the snapshot stays consistent.
    jobs.push(new Promise((resolve, reject) => canvas.toBlob((blob) => {
      if (!blob) return reject(new Error('could not encode an image'));
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(blob);
    }, 'image/png')));
    return jobs.length - 1;
  };
  const p = serializeDocument(doc, encode);
  const urls = await Promise.all(jobs);
  for (const l of p.layers) {
    l.image = urls[l.image];
    if (l.mask) l.mask.image = urls[l.mask.image];
  }
  return p;
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

const CHANNELS = ['rgb', 'r', 'g', 'b'];

function cleanCurve(v, fallback) {
  if (!Array.isArray(v) || v.length < 2 || v.length > 32) return fallback;
  const pts = v.map((p) => (Array.isArray(p) ? [clamp(Math.round(num(p[0])), 0, 255), clamp(Math.round(num(p[1])), 0, 255)] : null));
  if (pts.some((p) => !p)) return fallback;
  return pts.sort((a, b) => a[0] - b[0]);
}

/** Copy only the settings `base` has, with the same types and within the controls' ranges. */
function cleanLike(base, raw, controls = []) {
  const out = {};
  const src = raw && typeof raw === 'object' ? raw : {};
  for (const [k, dv] of Object.entries(base)) {
    const v = src[k];
    const c = controls.find((x) => x.key === k);
    if (typeof dv === 'number') {
      const lo = c?.min ?? (k === 'gamma' ? 0.1 : 0);
      const hi = c?.max ?? (k === 'gamma' ? 9.99 : 255);
      out[k] = clamp(num(v, dv), lo, hi);
    } else if (typeof dv === 'boolean') {
      out[k] = typeof v === 'boolean' ? v : dv;
    } else if (typeof dv === 'string') {
      if (c?.type === 'select') out[k] = c.options.some((o) => o.value === v) ? v : dv;
      else if (k === 'channel') out[k] = CHANNELS.includes(v) ? v : dv;
      else out[k] = normalizeHex(v) || dv;
    } else if (Array.isArray(dv)) {
      out[k] = cleanCurve(v, dv);
    } else if (dv && typeof dv === 'object') {
      out[k] = cleanLike(dv, v);
    }
  }
  return out;
}

function cleanAdjustment(a) {
  if (!a || typeof a !== 'object' || !ADJUSTMENT_LAYER_TYPES.includes(a.type)) return null;
  const def = ADJUSTMENTS[a.type];
  const base = defaultParams(def);
  if (a.type === 'gradientMap') Object.assign(base, { fg: '#000000', bg: '#ffffff' });
  return { type: a.type, params: cleanLike(base, a.params, def.params || []) };
}

function cleanStyles(st) {
  if (!st || typeof st !== 'object') return null;
  const out = {};
  for (const key of Object.keys(EFFECTS)) {
    if (st[key] && typeof st[key] === 'object') out[key] = cleanLike(effectDefaults(key), st[key], EFFECTS[key].params);
  }
  return Object.keys(out).length ? out : null;
}

/** Groups must sit directly above everything they contain. */
function validGroups(layers) {
  return layers.every((l, i) => {
    if (!l.parent) return true;
    const g = layers.indexOf(l.parent);
    if (g <= i || !l.parent.isGroup) return false;
    for (let j = i + 1; j < g; j++) if (!isAncestor(l.parent, layers[j])) return false;
    return true;
  });
}

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
    const kind = ['pixel', 'group', 'adjustment'].includes(d.kind) ? d.kind : 'pixel';
    const adjustment = kind === 'adjustment' ? cleanAdjustment(d.adjustment) : null;
    if (kind === 'adjustment' && !adjustment) throw new Error('the project contains an unknown adjustment layer');
    const layer = new Layer({
      name: String(d.name ?? 'Layer'), canvas: await loadCanvas(d.image), x: Math.round(num(d.x)), y: Math.round(num(d.y)), kind,
    });
    layer.visible = d.visible !== false;
    layer.opacity = clamp(num(d.opacity, 1), 0, 1);
    const groupMode = kind === 'group' && d.blendMode === PASS_THROUGH;
    layer.blendMode = groupMode || BLEND_VALUES.has(d.blendMode) ? d.blendMode : kind === 'group' ? PASS_THROUGH : 'source-over';
    layer.locked = !!d.locked;
    layer.text = kind === 'pixel' ? cleanText(d.text) : null;
    layer.adjustment = adjustment;
    layer.styles = kind === 'pixel' ? cleanStyles(d.styles) : null;
    layer.collapsed = kind === 'group' && !!d.collapsed;
    if (d.mask && typeof d.mask === 'object') {
      const m = new Mask(1, 1, Math.round(num(d.mask.x)), Math.round(num(d.mask.y)), 0);
      m.canvas = await loadCanvas(d.mask.image);
      m.outside = clamp(Math.round(num(d.mask.outside, 255)), 0, 255);
      m.enabled = d.mask.enabled !== false;
      layer.mask = m;
      layer.maskSelected = kind === 'adjustment';
    }
    doc.layers.push(layer);
  }
  p.layers.forEach((d, i) => {
    const g = Math.round(num(d.parent, -1));
    // Only groups above the layer count, so parent chains can never loop.
    if (g > i && g < doc.layers.length && doc.layers[g].isGroup) doc.layers[i].parent = doc.layers[g];
  });
  if (!validGroups(doc.layers)) throw new Error('the project’s layer groups are damaged');
  doc.activeId = doc.layers[clamp(Math.round(num(p.activeIndex)), 0, doc.layers.length - 1)].id;
  doc.layerCounter = Math.max(0, Math.round(num(p.layerCounter, doc.layers.length)));
  doc.groupCounter = Math.max(0, Math.round(num(p.groupCounter, 0)));
  if (Array.isArray(p.guides)) {
    doc.guides = p.guides.slice(0, 500)
      .filter((g) => g && (g.o === 'h' || g.o === 'v') && Number.isFinite(Number(g.p)))
      .map((g) => ({ o: g.o, p: clamp(Math.round(Number(g.p)), -MAX_SIDE, 2 * MAX_SIDE) }));
  }
  return doc;
}
