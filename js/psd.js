import { PSDocument } from './core/document.js';
import { Layer, PASS_THROUGH } from './core/layer.js';
import { Mask } from './core/mask.js';
import { hasStyles, rasterizeStyled } from './core/effects.js';
import { createCanvas } from './core/utils.js';

/*
 * Photoshop documents (.psd): layered RGB files, read and written in the
 * browser. Kept: pixel layers, names, opacity, blend modes, visibility,
 * layer masks and groups. On save, type is rasterized, layer styles are
 * baked into their layers and adjustment layers are saved as the merged
 * image at their position (Photoshop would need its own settings format).
 * On open, adjustment and fill layers, layer styles and clipping are
 * skipped with a warning; the pixels of type and smart object layers are kept.
 */

export const isPSDFile = (f) => /\.psd$/i.test(f?.name || '');
const MAX_SIDE = 16384;
const MAX_PIXELS = 100_000_000;

const MODE_KEYS = {
  'source-over': 'norm', darken: 'dark', multiply: 'mul ', 'color-burn': 'idiv', lighten: 'lite', screen: 'scrn',
  'color-dodge': 'div ', overlay: 'over', 'soft-light': 'sLit', 'hard-light': 'hLit', difference: 'diff',
  exclusion: 'smud', hue: 'hue ', saturation: 'sat ', color: 'colr', luminosity: 'lum ', [PASS_THROUGH]: 'pass',
};
const KEY_MODES = Object.fromEntries(Object.entries(MODE_KEYS).map(([m, k]) => [k, m]));
// Photoshop modes without a canvas equivalent, mapped to the closest one.
Object.assign(KEY_MODES, { diss: 'source-over', lbrn: 'color-burn', dkCl: 'darken', lddg: 'color-dodge', lgCl: 'lighten',
  vLit: 'hard-light', lLit: 'hard-light', pLit: 'hard-light', hMix: 'hard-light', fsub: 'difference', fdiv: 'color-dodge' });

const ADJUSTMENT_KEYS = new Set(['brit', 'levl', 'curv', 'expA', 'vibA', 'hue ', 'hue2', 'blnc', 'blwh', 'phfl', 'mixr',
  'clrL', 'nvrt', 'post', 'thrs', 'grdm', 'selc', 'SoCo', 'GdFl', 'PtFl']);

/* ---------- Byte helpers ---------- */

class Writer {
  constructor() {
    this.buf = new Uint8Array(1 << 16);
    this.pos = 0;
  }

  _room(n) {
    if (this.pos + n <= this.buf.length) return;
    let size = this.buf.length * 2;
    while (size < this.pos + n) size *= 2;
    const b = new Uint8Array(size);
    b.set(this.buf.subarray(0, this.pos));
    this.buf = b;
  }

  u8(v) { this._room(1); this.buf[this.pos++] = v & 255; }
  u16(v) { this.u8(v >> 8); this.u8(v); }
  u32(v) { this.u16((v >>> 16) & 0xffff); this.u16(v & 0xffff); }
  ascii(s) { for (const ch of s) this.u8(ch.charCodeAt(0)); }
  bytes(arr) {
    this._room(arr.length);
    this.buf.set(arr, this.pos);
    this.pos += arr.length;
  }

  zeros(n) { for (let i = 0; i < n; i++) this.u8(0); }

  /** A 4-byte length, the bytes fn writes, then padding to a multiple of `pad`. */
  section(fn, pad = 1) {
    const at = this.pos;
    this.u32(0);
    fn();
    while ((this.pos - at - 4) % pad) this.u8(0);
    const len = this.pos - at - 4;
    const end = this.pos;
    this.pos = at;
    this.u32(len);
    this.pos = end;
  }

  get result() { return this.buf.slice(0, this.pos); }
}

class Reader {
  constructor(buffer) {
    this.bytes = new Uint8Array(buffer);
    this.view = new DataView(this.bytes.buffer, this.bytes.byteOffset, this.bytes.byteLength);
    this.pos = 0;
  }

  _need(n) {
    if (this.pos + n > this.bytes.length) throw new Error('the file is damaged (it ends too early)');
  }

  u8() { this._need(1); return this.bytes[this.pos++]; }
  u16() { this._need(2); const v = this.view.getUint16(this.pos); this.pos += 2; return v; }
  i16() { this._need(2); const v = this.view.getInt16(this.pos); this.pos += 2; return v; }
  u32() { this._need(4); const v = this.view.getUint32(this.pos); this.pos += 4; return v; }
  i32() { this._need(4); const v = this.view.getInt32(this.pos); this.pos += 4; return v; }
  ascii(n) { this._need(n); let s = ''; for (let i = 0; i < n; i++) s += String.fromCharCode(this.bytes[this.pos++]); return s; }
  take(n) { this._need(n); const b = this.bytes.subarray(this.pos, this.pos + n); this.pos += n; return b; }
  skip(n) { this._need(n); this.pos += n; }
}

/* ---------- PackBits (RLE) ---------- */

/** Pack one row; returns the packed length written to `out` at `o`. */
function packRow(src, start, n, out, o) {
  const o0 = o;
  let i = 0;
  while (i < n) {
    let j = i;
    while (j + 1 < n && j - i < 127 && src[start + j + 1] === src[start + i]) j++;
    if (j > i) {
      out[o++] = (1 - (j - i + 1)) & 255;
      out[o++] = src[start + i];
      i = j + 1;
      continue;
    }
    let k = i;
    while (k < n && k - i < 128 && !(k + 1 < n && src[start + k] === src[start + k + 1])) k++;
    out[o++] = k - i - 1;
    for (let p = i; p < k; p++) out[o++] = src[start + p];
    i = k;
  }
  return o - o0;
}

function unpack(src, dst, rowBytes) {
  let s = 0;
  let d = 0;
  while (d < rowBytes && s < src.length) {
    let h = src[s++];
    if (h > 127) h -= 256;
    if (h >= 0) {
      const n = Math.min(h + 1, rowBytes - d, src.length - s);
      for (let i = 0; i < n; i++) dst[d++] = src[s++];
    } else if (h !== -128) {
      const v = src[s++];
      const n = Math.min(1 - h, rowBytes - d);
      for (let i = 0; i < n; i++) dst[d++] = v;
    }
  }
}

/** RLE-compress a plane (w × h bytes): { counts: Uint16 per row, data }. */
function packPlane(plane, w, h) {
  const out = new Uint8Array(h * (w + Math.ceil(w / 128) + 2));
  const counts = new Uint16Array(h);
  let o = 0;
  for (let y = 0; y < h; y++) {
    const n = packRow(plane, y * w, w, out, o);
    counts[y] = n;
    o += n;
  }
  return { counts, data: out.subarray(0, o) };
}

/* ---------- Writing ---------- */

/** Split RGBA pixels into planes: [r, g, b, a]. */
function planesOf(data, w, h) {
  const n = w * h;
  const planes = [new Uint8Array(n), new Uint8Array(n), new Uint8Array(n), new Uint8Array(n)];
  for (let p = 0, i = 0; p < n; p++, i += 4) {
    planes[0][p] = data[i];
    planes[1][p] = data[i + 1];
    planes[2][p] = data[i + 2];
    planes[3][p] = data[i + 3];
  }
  return planes;
}

/** Channel data for one layer: [{ id, bytes }] with compression and row counts included. */
function channelData(planes, ids, w, h) {
  return planes.map((plane, i) => {
    const wr = new Writer();
    wr.u16(1);
    const { counts, data } = packPlane(plane, w, h);
    for (const c of counts) wr.u16(c);
    wr.bytes(data);
    return { id: ids[i], bytes: wr.result };
  });
}

const emptyChannels = (ids) => ids.map((id) => ({ id, bytes: new Uint8Array([0, 0]) }));

function pascalName(w, name) {
  const bytes = [...name].map((ch) => (ch.charCodeAt(0) < 128 ? ch.charCodeAt(0) : 63)).slice(0, 255);
  w.u8(bytes.length);
  w.bytes(bytes);
  // Length byte + name, padded to a multiple of 4.
  for (let n = bytes.length + 1; n % 4; n++) w.u8(0);
}

function unicodeBlock(w, name) {
  w.ascii('8BIMluni');
  w.section(() => {
    w.u32(name.length);
    for (let i = 0; i < name.length; i++) w.u16(name.charCodeAt(i));
  }, 4);
}

/** Records for every layer, bottom first, with groups bracketed by section dividers. */
function layerRecords(doc) {
  const records = [];
  const W = doc.width;
  const H = doc.height;
  // Each group's contents are preceded by an end-of-group divider record.
  const opening = new Map(); // index where contents start -> number of groups starting there
  for (const l of doc.layers) {
    if (!l.isGroup) continue;
    const s = doc.span(l)[0];
    opening.set(s, (opening.get(s) || 0) + 1);
  }
  doc.layers.forEach((l, i) => {
    for (let k = 0; k < (opening.get(i) || 0); k++) {
      records.push({
        name: '</Layer group>', divider: 3, rect: { x: 0, y: 0, w: 0, h: 0 }, channels: emptyChannels([-1, 0, 1, 2]),
        opacity: 1, mode: 'source-over', visible: true,
      });
    }
    const rec = { name: l.name, opacity: l.opacity, mode: l.blendMode, visible: l.visible, divider: 0, mask: null };
    if (l.isGroup) {
      Object.assign(rec, { divider: l.collapsed ? 2 : 1, rect: { x: 0, y: 0, w: 0, h: 0 }, channels: emptyChannels([-1, 0, 1, 2]) });
    } else {
      let src;
      if (l.isAdjustment) {
        // Saved as what it shows: the image up to and including this layer.
        src = { canvas: stampThrough(doc, l), x: 0, y: 0 };
        Object.assign(rec, { opacity: 1, mode: 'source-over', name: `${l.name} (merged)` });
      } else if (hasStyles(l)) {
        src = rasterizeStyled(l);
      } else {
        src = { canvas: l.canvas, x: l.x, y: l.y };
      }
      const w = src.canvas.width;
      const h = src.canvas.height;
      const data = src.canvas.getContext('2d').getImageData(0, 0, w, h).data;
      const [r, g, b, a] = planesOf(data, w, h);
      rec.rect = { x: src.x, y: src.y, w, h };
      rec.channels = channelData([a, r, g, b], [-1, 0, 1, 2], w, h);
    }
    // Masks of pixel layers and groups (styled and adjustment layers have them baked in).
    if (l.mask && !l.isAdjustment && !(l.isPixel && hasStyles(l))) {
      const m = l.mask;
      const mb = m.bounds(l);
      const md = m.canvas.getContext('2d').getImageData(0, 0, mb.w, mb.h).data;
      const plane = new Uint8Array(mb.w * mb.h);
      for (let p = 0; p < plane.length; p++) plane[p] = md[p * 4 + 3];
      rec.mask = { rect: mb, outside: m.outside, enabled: m.enabled };
      rec.channels.push(...channelData([plane], [-2], mb.w, mb.h));
    }
    records.push(rec);
  });
  return { records, W, H };
}

/** The flattened image as it looks at an adjustment layer (everything above hidden). */
function stampThrough(doc, layer) {
  const i = doc.layers.indexOf(layer);
  const hidden = [];
  for (let j = i + 1; j < doc.layers.length; j++) {
    const l = doc.layers[j];
    if (l.visible && !doc.descendants(l).includes(layer)) {
      l.visible = false;
      hidden.push(l);
    }
  }
  try {
    return doc.composite();
  } finally {
    for (const l of hidden) l.visible = true;
  }
}

function writeRecord(w, rec) {
  const { x, y, w: rw, h: rh } = rec.rect;
  w.u32(y);
  w.u32(x);
  w.u32(y + rh);
  w.u32(x + rw);
  w.u16(rec.channels.length);
  for (const ch of rec.channels) {
    w.u16(ch.id & 0xffff);
    w.u32(ch.bytes.length);
  }
  w.ascii('8BIM');
  w.ascii(MODE_KEYS[rec.mode] || 'norm');
  w.u8(Math.round(rec.opacity * 255));
  w.u8(0); // clipping: base
  w.u8((rec.visible ? 0 : 2) | 8); // bit 1: hidden; bit 3: bit 4 is meaningful
  w.u8(0);
  w.section(() => {
    // Layer mask data.
    w.section(() => {
      if (!rec.mask) return;
      const m = rec.mask.rect;
      w.u32(m.y);
      w.u32(m.x);
      w.u32(m.y + m.h);
      w.u32(m.x + m.w);
      w.u8(rec.mask.outside);
      w.u8(rec.mask.enabled ? 0 : 2);
      w.zeros(2);
    });
    // Blending ranges: everything passes (grey + 4 channels).
    w.section(() => {
      for (let i = 0; i < 5; i++) {
        w.u16(0x0000);
        w.u16(0xffff);
        w.u16(0x0000);
        w.u16(0xffff);
      }
    });
    pascalName(w, rec.name);
    unicodeBlock(w, rec.name);
    if (rec.divider) {
      w.ascii('8BIMlsct');
      w.section(() => {
        w.u32(rec.divider);
        if (rec.divider !== 3) {
          w.ascii('8BIM');
          w.ascii(MODE_KEYS[rec.mode] || 'pass');
        }
      });
    }
  });
}

/** Encode a document as a .psd file. */
export function writePSD(doc) {
  const { records, W, H } = layerRecords(doc);
  const composite = doc.composite();
  const merged = planesOf(composite.getContext('2d').getImageData(0, 0, W, H).data, W, H);
  const w = new Writer();
  w.ascii('8BPS');
  w.u16(1);
  w.zeros(6);
  w.u16(4); // RGB + transparency
  w.u32(H);
  w.u32(W);
  w.u16(8);
  w.u16(3); // RGB
  w.u32(0); // colour mode data
  w.u32(0); // image resources
  w.section(() => {
    w.section(() => {
      // Negative count: the merged image's extra channel is its transparency.
      w.u16(-records.length & 0xffff);
      for (const rec of records) writeRecord(w, rec);
      for (const rec of records) for (const ch of rec.channels) w.bytes(ch.bytes);
    }, 2);
    w.u32(0); // global layer mask info
  }, 2);
  // Merged image, RLE.
  w.u16(1);
  const packed = merged.map((p) => packPlane(p, W, H));
  for (const p of packed) for (const c of p.counts) w.u16(c);
  for (const p of packed) w.bytes(p.data);
  return w.result;
}

/* ---------- Reading ---------- */

async function inflate(bytes) {
  if (typeof DecompressionStream === 'undefined') throw new Error('this browser cannot read ZIP-compressed PSD layers');
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** Decode one channel to a w × h plane of 8-bit values. */
async function readChannel(bytes, w, h, depth) {
  const r = new Reader(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
  const comp = r.u16();
  const bpp = depth / 8;
  const rowBytes = w * bpp;
  let raw;
  if (comp === 0) {
    raw = r.take(rowBytes * h);
  } else if (comp === 1) {
    const counts = [];
    for (let y = 0; y < h; y++) counts.push(r.u16());
    raw = new Uint8Array(rowBytes * h);
    const row = new Uint8Array(rowBytes);
    for (let y = 0; y < h; y++) {
      row.fill(0);
      unpack(r.take(counts[y]), row, rowBytes);
      raw.set(row, y * rowBytes);
    }
  } else if (comp === 2 || comp === 3) {
    raw = await inflate(r.take(bytes.length - 2));
    if (raw.length < rowBytes * h) throw new Error('the file is damaged (short ZIP data)');
    if (comp === 3) {
      // Undo the per-row delta prediction.
      for (let y = 0; y < h; y++) {
        if (bpp === 1) {
          for (let x = 1; x < w; x++) raw[y * w + x] = (raw[y * w + x] + raw[y * w + x - 1]) & 255;
        } else {
          const o = y * rowBytes;
          for (let x = 1; x < w; x++) {
            const prev = (raw[o + (x - 1) * 2] << 8) | raw[o + (x - 1) * 2 + 1];
            const v = (((raw[o + x * 2] << 8) | raw[o + x * 2 + 1]) + prev) & 0xffff;
            raw[o + x * 2] = v >> 8;
            raw[o + x * 2 + 1] = v & 255;
          }
        }
      }
    }
  } else {
    throw new Error('the file uses an unknown compression');
  }
  if (bpp === 1) return raw.length === w * h ? raw : raw.subarray(0, w * h);
  const out = new Uint8Array(w * h);
  for (let p = 0; p < out.length; p++) out[p] = raw[p * 2]; // keep the high byte
  return out;
}

function planesToCanvas(planes, w, h, gray) {
  const c = createCanvas(w, h);
  if (!w || !h) return c;
  const img = new ImageData(w, h);
  const d = img.data;
  const [r, g, b] = gray ? [planes[0], planes[0], planes[0]] : [planes[0], planes[1], planes[2]];
  const a = planes[-1];
  for (let p = 0, i = 0; p < w * h; p++, i += 4) {
    d[i] = r ? r[p] : 0;
    d[i + 1] = g ? g[p] : 0;
    d[i + 2] = b ? b[p] : 0;
    d[i + 3] = a ? a[p] : 255;
  }
  c.getContext('2d').putImageData(img, 0, 0);
  return c;
}

function readRecord(r) {
  const top = r.i32();
  const left = r.i32();
  const bottom = r.i32();
  const right = r.i32();
  const n = r.u16();
  if (n > 56) throw new Error('the file is damaged (too many channels in a layer)');
  const channels = [];
  for (let i = 0; i < n; i++) channels.push({ id: r.i16(), length: r.u32() });
  if (r.ascii(4) !== '8BIM') throw new Error('the file is damaged (bad layer record)');
  const key = r.ascii(4);
  const opacity = r.u8();
  const clipping = r.u8();
  const flags = r.u8();
  r.u8();
  const extraLen = r.u32();
  const extraEnd = r.pos + extraLen;
  const rec = {
    rect: { x: left, y: top, w: right - left, h: bottom - top }, channels, mode: key, opacity, clipping,
    hidden: !!(flags & 2), mask: null, divider: 0, name: '', adjustment: false, effects: false,
  };
  const maskLen = r.u32();
  if (maskLen >= 18) {
    const mt = r.i32();
    const ml = r.i32();
    const mb = r.i32();
    const mr = r.i32();
    const outside = r.u8();
    const mflags = r.u8();
    rec.mask = { rect: { x: ml, y: mt, w: mr - ml, h: mb - mt }, outside: outside ? 255 : 0, enabled: !(mflags & 2) };
    r.skip(maskLen - 18);
  } else {
    r.skip(maskLen);
  }
  r.skip(r.u32()); // blending ranges
  const nameLen = r.u8();
  rec.name = r.ascii(nameLen);
  r.skip((4 - ((nameLen + 1) % 4)) % 4);
  while (r.pos + 12 <= extraEnd) {
    const sig = r.ascii(4);
    if (sig !== '8BIM' && sig !== '8B64') break;
    const k = r.ascii(4);
    const len = r.u32();
    const end = r.pos + len;
    if (k === 'luni' && len >= 4) {
      const count = r.u32();
      let s = '';
      for (let i = 0; i < count && r.pos + 2 <= end; i++) s += String.fromCharCode(r.u16());
      rec.name = s.replace(/\0+$/, '');
    } else if ((k === 'lsct' || k === 'lsdk') && len >= 4) {
      rec.divider = r.u32();
      if (len >= 12 && rec.divider !== 3) {
        r.skip(4);
        rec.mode = r.ascii(4);
      }
    } else if (ADJUSTMENT_KEYS.has(k)) {
      rec.adjustment = true;
    } else if (k === 'lfx2' || k === 'lrFX' || k === 'lmfx') {
      rec.effects = true;
    }
    r.pos = Math.min(end, extraEnd);
    // Some writers pad odd-length blocks without counting the padding.
    if (len % 2 && r.pos < extraEnd && r.bytes[r.pos] === 0 && r.bytes[r.pos + 1] === 0x38) r.pos++;
  }
  r.pos = extraEnd;
  return rec;
}

/**
 * Decode a .psd file: { doc, warnings }. Only 8- and 16-bit RGB and
 * Grayscale documents are supported (not the large PSB format).
 */
export async function readPSD(buffer, name = 'Untitled.psd') {
  const r = new Reader(buffer);
  if (r.ascii(4) !== '8BPS') throw new Error('the file is not a Photoshop document');
  const version = r.u16();
  if (version !== 1) throw new Error('large document format (PSB) files are not supported');
  r.skip(6);
  const nChannels = r.u16();
  const H = r.u32();
  const W = r.u32();
  const depth = r.u16();
  const mode = r.u16();
  if (mode !== 3 && mode !== 1) throw new Error('only RGB and Grayscale Photoshop documents can be opened');
  if (depth !== 8 && depth !== 16) throw new Error(`${depth}-bit Photoshop documents are not supported`);
  if (!W || !H) throw new Error('the document has an invalid size');
  if (W > MAX_SIDE || H > MAX_SIDE || W * H > MAX_PIXELS) throw new Error(`the document is too large (${W} × ${H} px)`);
  const gray = mode === 1;
  r.skip(r.u32()); // colour mode data
  r.skip(r.u32()); // image resources

  const warnings = new Set();
  const doc = new PSDocument({ width: W, height: H, name, background: 'transparent' });
  doc.layers = [];
  const lmLen = r.u32();
  const lmEnd = r.pos + lmLen;
  let mergedAlpha = false;
  if (lmLen >= 4) {
    const liLen = r.u32();
    const liEnd = r.pos + liLen;
    if (liLen >= 2) {
      const count = r.i16();
      // Negative: the merged image's first extra channel is its transparency.
      mergedAlpha = count < 0;
      const layerCount = Math.abs(count);
      const recs = [];
      for (let i = 0; i < layerCount; i++) recs.push(readRecord(r));
      // Pixel data follows, layer by layer, channel by channel.
      for (const rec of recs) {
        for (const ch of rec.channels) ch.bytes = r.take(ch.length);
      }
      const withPixels = await buildLayers(doc, recs, depth, gray, warnings);
      // Some writers add one empty placeholder layer to flattened images: use the merged image then.
      if (!withPixels) doc.layers = [];
      r.pos = liEnd;
    }
  }
  r.pos = lmEnd;

  if (!doc.layers.length) {
    // No layers: use the flattened image.
    const comp = r.u16();
    const planes = {};
    const counts = [];
    if (comp === 1) for (let i = 0; i < nChannels * H; i++) counts.push(r.u16());
    const bpp = depth / 8;
    const order = gray ? [0, -1] : [0, 1, 2, -1];
    for (let c = 0; c < nChannels; c++) {
      let plane;
      if (comp === 0) {
        const raw = r.take(W * H * bpp);
        plane = bpp === 1 ? raw.slice() : Uint8Array.from({ length: W * H }, (_, p) => raw[p * 2]);
      } else if (comp === 1) {
        const rows = new Uint8Array(W * bpp * H);
        const row = new Uint8Array(W * bpp);
        for (let y = 0; y < H; y++) {
          row.fill(0);
          unpack(r.take(counts[c * H + y]), row, W * bpp);
          rows.set(row, y * W * bpp);
        }
        plane = bpp === 1 ? rows : Uint8Array.from({ length: W * H }, (_, p) => rows[p * 2]);
      } else {
        throw new Error('the file uses an unknown compression');
      }
      if (c < order.length) planes[order[c]] = plane;
    }
    // An extra channel is transparency only when the layer count said so (otherwise it is a saved selection).
    if (!mergedAlpha) delete planes[-1];
    const bg = new Layer({ name: 'Background', canvas: planesToCanvas(planes, W, H, gray) });
    doc.layers.push(bg);
  }
  doc.activeId = doc.layers[doc.layers.length - 1].id;
  doc.layerCounter = doc.layers.filter((l) => l.isPixel).length;
  doc.groupCounter = doc.layers.filter((l) => l.isGroup).length;
  return { doc, warnings: [...warnings] };
}

/** Adds the records as layers; returns how many have pixels. */
async function buildLayers(doc, recs, depth, gray, warnings) {
  const stack = []; // open groups, innermost last
  let withPixels = 0;
  for (const rec of recs) {
    const parent = stack[stack.length - 1] || null;
    if (rec.divider === 3) {
      stack.push(Layer.group('Group'));
      continue;
    }
    if (rec.divider === 1 || rec.divider === 2) {
      const g = stack.pop() || Layer.group('Group');
      Object.assign(g, {
        name: rec.name || 'Group', opacity: rec.opacity / 255, visible: !rec.hidden,
        blendMode: KEY_MODES[rec.mode] || PASS_THROUGH, collapsed: rec.divider === 2, parent: stack[stack.length - 1] || null,
      });
      await addMask(g, rec, depth);
      doc.layers.push(g);
      continue;
    }
    if (rec.adjustment) {
      warnings.add('adjustment and fill layers');
      continue;
    }
    if (rec.effects) warnings.add('layer styles');
    if (rec.clipping) warnings.add('clipping masks');
    const { x, y, w, h } = rec.rect;
    if (w < 0 || h < 0 || w * h > MAX_PIXELS) throw new Error('the file is damaged (bad layer size)');
    const planes = {};
    for (const ch of rec.channels) {
      if (ch.id >= -1 && ch.id <= 2 && w && h) planes[ch.id] = await readChannel(ch.bytes, w, h, depth);
    }
    if (w && h) withPixels++;
    const layer = new Layer({ name: rec.name || 'Layer', canvas: planesToCanvas(planes, w, h, gray), x: w ? x : 0, y: h ? y : 0 });
    layer.opacity = rec.opacity / 255;
    layer.visible = !rec.hidden;
    layer.blendMode = KEY_MODES[rec.mode] && KEY_MODES[rec.mode] !== PASS_THROUGH ? KEY_MODES[rec.mode] : 'source-over';
    layer.parent = parent;
    await addMask(layer, rec, depth);
    doc.layers.push(layer);
  }
  // Unclosed groups (a damaged file): keep their contents at the top level.
  for (const l of doc.layers) if (l.parent && !doc.layers.includes(l.parent)) l.parent = null;
  return withPixels;
}

async function addMask(layer, rec, depth) {
  const ch = rec.channels.find((c) => c.id === -2);
  if (!rec.mask || !ch) return;
  const { x, y, w, h } = rec.mask.rect;
  const m = new Mask(1, 1, x - layer.x, y - layer.y, 0);
  if (w > 0 && h > 0) {
    const plane = await readChannel(ch.bytes, w, h, depth);
    const img = new ImageData(w, h);
    for (let p = 0; p < plane.length; p++) {
      img.data[p * 4] = img.data[p * 4 + 1] = img.data[p * 4 + 2] = 255;
      img.data[p * 4 + 3] = plane[p];
    }
    m.canvas = createCanvas(w, h, { readFrequently: true });
    m.canvas.getContext('2d').putImageData(img, 0, 0);
  }
  m.outside = rec.mask.outside;
  m.enabled = rec.mask.enabled;
  layer.mask = m;
}

