import { Tool, strokeOutline } from './tool.js';
import { Stroke, getTip, brushCursor, brushKeys } from './brush.js';
import { cloneCanvas, createCanvas, rectInflate, rectIntersect, rectUnion } from '../core/utils.js';
import { healBlend, chooseSpotSource } from '../core/heal.js';
import { luma, makeLUT } from '../core/pixels.js';

const KINDS = {
  clone: { name: 'Clone Stamp Tool', key: 'S', label: 'Clone Stamp',
    defaults: { size: 40, hardness: 0.6, opacity: 1, aligned: true, sample: 'current' } },
  heal: { name: 'Healing Brush Tool', key: 'J', label: 'Healing Brush',
    defaults: { size: 30, hardness: 0.6, aligned: true, sample: 'current' } },
  spot: { name: 'Spot Healing Brush Tool', key: 'J', label: 'Spot Healing Brush', defaults: { size: 30, hardness: 0.6 } },
  dodge: { name: 'Dodge Tool', key: 'O', label: 'Dodge', defaults: { size: 60, hardness: 0.3, range: 'midtones', exposure: 0.5 } },
  burn: { name: 'Burn Tool', key: 'O', label: 'Burn', defaults: { size: 60, hardness: 0.3, range: 'midtones', exposure: 0.5 } },
  sponge: { name: 'Sponge Tool', key: 'O', label: 'Sponge', defaults: { size: 60, hardness: 0.3, mode: 'desaturate', flow: 0.5 } },
  blur: { name: 'Blur Tool', key: 'R', label: 'Blur', defaults: { size: 40, hardness: 0.3, strength: 0.5 } },
  sharpen: { name: 'Sharpen Tool', key: 'R', label: 'Sharpen', defaults: { size: 40, hardness: 0.3, strength: 0.5 } },
  smudge: { name: 'Smudge Tool', key: 'R', label: 'Smudge', defaults: { size: 30, hardness: 0.3, strength: 0.5 } },
};

const AMOUNT_KEY = { clone: 'opacity', dodge: 'exposure', burn: 'exposure', sponge: 'flow', blur: 'strength', sharpen: 'strength', smudge: 'strength' };

/** Tone weight of a 0–255 value for Dodge/Burn ranges. */
function rangeWeight(range, v) {
  const t = v / 255;
  if (range === 'shadows') return (1 - t) * (1 - t);
  if (range === 'highlights') return t * t;
  return 4 * t * (1 - t);
}

/**
 * Clone Stamp, Healing Brush, Spot Healing Brush, Dodge, Burn, Sponge,
 * Blur, Sharpen and Smudge. Strokes are built on a working copy of the
 * layer that is shown live and committed as one undoable step.
 */
export class RetouchTool extends Tool {
  constructor(app, kind) {
    const meta = KINDS[kind];
    super(app, { id: kind === 'spot' ? 'spot-heal' : kind, name: meta.name, key: meta.key, icon: kind, cursor: 'none' });
    this.kind = kind;
    this.label = meta.label;
    this.options = { ...meta.defaults };
    this.wantsCoalesced = true;
    this.source = null; // { x, y, docId } for Clone Stamp / Healing Brush
    this.offset = null;
    this.s = null; // active stroke session
  }

  get usesSource() { return this.kind === 'clone' || this.kind === 'heal'; }

  onPointerDown(e) {
    const doc = this.doc;
    if (this.usesSource && e.alt) {
      this.source = { x: e.x, y: e.y, docId: doc.id };
      this.offset = null;
      this.app.toast('Source point set. Now paint where you want to copy it to.');
      return;
    }
    const layer = this.app.editableLayer(this.name.toLowerCase());
    if (!layer) return;
    if (this.usesSource && (!this.source || this.source.docId !== doc.id)) {
      this.app.toast(`Could not use the ${this.name.toLowerCase()} because the area to copy from has not been defined. Alt-click to set a source point.`);
      return;
    }
    if (this.kind === 'smudge') this._startSmudge(layer, e);
    else this._start(layer, e);
  }

  onPointerMove(e) {
    const s = this.s;
    if (!s) return;
    if (this.kind === 'smudge') this._smudgeTo(e);
    else {
      s.stroke.lineTo(e.x, e.y, e.pressure);
      this._update(s.stroke.takeDirty());
    }
  }

  onPointerUp() {
    if (!this.s) return;
    if (this.kind === 'heal' || this.kind === 'spot') this._heal();
    this._commit();
  }

  cancel() {
    if (!this.s) return;
    const r = this.s.bounds || this.s.stroke?.bounds;
    this.s = null;
    this.app.renderer.request(true, r || undefined);
  }

  layerOverride(layer) {
    const s = this.s;
    return s && s.layer === layer ? { canvas: s.work, x: layer.x, y: layer.y } : null;
  }

  /* ---------- Coverage-based tools ---------- */

  _start(layer, e) {
    const doc = this.doc;
    const o = this.options;
    // Copying can add pixels anywhere on the canvas.
    if (this.usesSource) layer.ensureCovers(doc.bounds);
    const s = {
      layer,
      orig: layer.ctx.getImageData(0, 0, layer.width, layer.height),
      work: cloneCanvas(layer.canvas),
      stroke: new Stroke(this.app, layer, {
        size: o.size, hardness: o.hardness, flow: 1, opacity: 1, spacing: 0.2,
        color: '#ffffff', erase: false, aliased: false, pressureSize: e.pen,
      }),
    };
    if (this.usesSource) {
      if (!o.aligned || !this.offset) this.offset = { x: Math.round(this.source.x - e.x), y: Math.round(this.source.y - e.y) };
      if (o.sample === 'all') {
        s.src = doc.composite().getContext('2d').getImageData(0, 0, doc.width, doc.height);
        s.srcX = 0;
        s.srcY = 0;
      } else {
        s.src = s.orig;
        s.srcX = layer.x;
        s.srcY = layer.y;
      }
    }
    this.s = s;
    s.stroke.start(e.x, e.y, e.pressure);
    this._update(s.stroke.takeDirty());
  }

  /** Recompute the working copy inside `rect` (document coordinates). */
  _update(rect) {
    const s = this.s;
    if (!rect || !s) return;
    const { layer, orig } = s;
    const doc = this.doc;
    const r = rectIntersect(rectIntersect(rect, layer.bounds), doc.bounds);
    if (!r) return;
    const o = this.options;
    const cov = s.stroke.ctx.getImageData(r.x, r.y, r.w, r.h).data;
    const out = new ImageData(r.w, r.h);
    const od = out.data;
    const src = orig.data;
    const lw = layer.width;
    const lh = layer.height;
    const sel = doc.selection.alpha;
    const W = doc.width;
    const kind = this.kind;
    const off = this.offset;
    const tone = kind === 'dodge' || kind === 'burn'
      ? makeLUT((v) => (kind === 'dodge'
        ? v + (255 - v) * rangeWeight(o.range, v) * o.exposure
        : v - v * rangeWeight(o.range, v) * o.exposure))
      : null;
    for (let y = 0; y < r.h; y++) {
      for (let x = 0; x < r.w; x++) {
        const i = (y * r.w + x) * 4;
        const dx = r.x + x;
        const dy = r.y + y;
        const li = ((dy - layer.y) * lw + (dx - layer.x)) * 4;
        let a = cov[i + 3] / 255;
        if (sel) a *= sel[dy * W + dx] / 255;
        const R = src[li], G = src[li + 1], B = src[li + 2], A = src[li + 3];
        if (!a) {
          od[i] = R; od[i + 1] = G; od[i + 2] = B; od[i + 3] = A;
          continue;
        }
        if (kind === 'clone' || kind === 'heal') {
          // Normal ("source-over") blend of the source pixel.
          const sx = dx + off.x - s.srcX;
          const sy = dy + off.y - s.srcY;
          let sr = 0, sg = 0, sb = 0, sa = 0;
          if (sx >= 0 && sy >= 0 && sx < s.src.width && sy < s.src.height) {
            const si = (sy * s.src.width + sx) * 4;
            sr = s.src.data[si]; sg = s.src.data[si + 1]; sb = s.src.data[si + 2]; sa = s.src.data[si + 3];
          }
          const k = (sa / 255) * a * (kind === 'clone' ? o.opacity : 1);
          const da = A / 255;
          const oa = k + da * (1 - k);
          if (oa <= 0) {
            od[i] = R; od[i + 1] = G; od[i + 2] = B; od[i + 3] = 0;
          } else {
            od[i] = (sr * k + R * da * (1 - k)) / oa;
            od[i + 1] = (sg * k + G * da * (1 - k)) / oa;
            od[i + 2] = (sb * k + B * da * (1 - k)) / oa;
            od[i + 3] = oa * 255;
          }
          continue;
        }
        let nr, ng, nb;
        if (kind === 'spot') {
          // Show the painted area as a dark tint until it is healed on release.
          const t = 0.45 * a;
          od[i] = R * (1 - t); od[i + 1] = G * (1 - t); od[i + 2] = B * (1 - t); od[i + 3] = Math.max(A, 90 * a);
          continue;
        } else if (tone) {
          nr = tone[R]; ng = tone[G]; nb = tone[B];
        } else if (kind === 'sponge') {
          const L = luma(R, G, B);
          const m = o.mode === 'saturate' ? 1 + o.flow : 1 - o.flow;
          nr = L + (R - L) * m; ng = L + (G - L) * m; nb = L + (B - L) * m;
        } else {
          // Blur / Sharpen: 5×5 average of the original pixels.
          let br = 0, bg = 0, bb = 0, n = 0;
          for (let yy = -2; yy <= 2; yy++) {
            const ly = Math.min(lh - 1, Math.max(0, dy - layer.y + yy));
            for (let xx = -2; xx <= 2; xx++) {
              const lx = Math.min(lw - 1, Math.max(0, dx - layer.x + xx));
              const j = (ly * lw + lx) * 4;
              br += src[j]; bg += src[j + 1]; bb += src[j + 2];
              n++;
            }
          }
          br /= n; bg /= n; bb /= n;
          if (kind === 'blur') { nr = br; ng = bg; nb = bb; } else {
            nr = R + (R - br) * 1.5; ng = G + (G - bg) * 1.5; nb = B + (B - bb) * 1.5;
          }
          a *= o.strength;
        }
        od[i] = R + (nr - R) * a;
        od[i + 1] = G + (ng - G) * a;
        od[i + 2] = B + (nb - B) * a;
        od[i + 3] = A;
      }
    }
    s.work.getContext('2d').putImageData(out, r.x - layer.x, r.y - layer.y);
    this.app.renderer.request(true, r);
  }

  /** Healing Brush / Spot Healing: blend the copied texture into its surroundings. */
  _heal() {
    const s = this.s;
    const { layer, orig } = s;
    const doc = this.doc;
    const painted = rectIntersect(rectIntersect(s.stroke.bounds, layer.bounds), doc.bounds);
    if (!painted) return;
    const R = rectIntersect(rectIntersect(rectInflate(painted, 3), layer.bounds), doc.bounds);
    const { w, h } = R;
    const lx = R.x - layer.x;
    const ly = R.y - layer.y;
    const cov = s.stroke.ctx.getImageData(R.x, R.y, w, h).data;
    const sel = doc.selection.alpha;
    const alpha = new Float32Array(w * h);
    const unknown = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        let a = cov[i * 4 + 3] / 255;
        if (sel) a *= sel[(R.y + y) * doc.width + R.x + x] / 255;
        alpha[i] = a;
        unknown[i] = a > 0.02 ? 1 : 0;
      }
    }
    const dst = new Uint8ClampedArray(w * h * 4);
    for (let y = 0; y < h; y++) {
      const from = ((ly + y) * layer.width + lx) * 4;
      dst.set(orig.data.subarray(from, from + w * 4), y * w * 4);
    }
    let src;
    if (this.kind === 'heal') {
      src = new Uint8ClampedArray(dst);
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const sx = R.x + x + this.offset.x - s.srcX;
          const sy = R.y + y + this.offset.y - s.srcY;
          if (sx < 0 || sy < 0 || sx >= s.src.width || sy >= s.src.height) continue;
          const si = (sy * s.src.width + sx) * 4;
          const di = (y * w + x) * 4;
          for (let c = 0; c < 4; c++) src[di + c] = s.src.data[si + c];
        }
      }
    } else {
      const pick = chooseSpotSource(orig.data, layer.width, layer.height, { x: lx, y: ly, w, h }, unknown);
      src = new Uint8ClampedArray(w * h * 4);
      if (pick) {
        for (let y = 0; y < h; y++) {
          const from = ((ly + y + pick.dy) * layer.width + lx + pick.dx) * 4;
          src.set(orig.data.subarray(from, from + w * 4), y * w * 4);
        }
      }
    }
    const healed = healBlend(dst, src, unknown, w, h);
    const out = new ImageData(w, h);
    for (let i = 0; i < w * h; i++) {
      const a = unknown[i] ? alpha[i] : 0;
      for (let c = 0; c < 4; c++) out.data[i * 4 + c] = dst[i * 4 + c] + (healed[i * 4 + c] - dst[i * 4 + c]) * a;
    }
    s.work.getContext('2d').putImageData(out, lx, ly);
  }

  _commit() {
    const s = this.s;
    this.s = null;
    const { layer } = s;
    const bounds = s.bounds || s.stroke?.bounds;
    const rect = bounds && rectIntersect(rectIntersect(rectInflate(bounds, 3), layer.bounds), this.doc.bounds);
    if (!rect) {
      this.app.renderer.request(true);
      return;
    }
    this.app.transact(this.label, { layers: [{ layer, rect }] }, () => {
      const c = layer.ctx;
      const lx = rect.x - layer.x;
      const ly = rect.y - layer.y;
      c.clearRect(lx, ly, rect.w, rect.h);
      c.drawImage(s.work, lx, ly, rect.w, rect.h, lx, ly, rect.w, rect.h);
    });
  }

  /* ---------- Smudge ---------- */

  _startSmudge(layer, e) {
    const o = this.options;
    this.s = {
      layer,
      work: cloneCanvas(layer.canvas),
      tip: getTip(o.size, o.hardness, '#ffffff', false),
      patch: createCanvas(Math.ceil(o.size), Math.ceil(o.size)),
      last: { x: e.x, y: e.y },
      since: 0,
      bounds: null,
    };
  }

  _smudgeTo(e) {
    const s = this.s;
    const step = Math.max(1, this.options.size * 0.1);
    let { x: lx, y: ly } = s.last;
    let dist = Math.hypot(e.x - lx, e.y - ly);
    while (dist >= step) {
      const t = step / dist;
      const nx = lx + (e.x - lx) * t;
      const ny = ly + (e.y - ly) * t;
      this._smudgeDab(lx, ly, nx, ny);
      lx = nx;
      ly = ny;
      dist = Math.hypot(e.x - lx, e.y - ly);
    }
    s.last = { x: lx, y: ly };
  }

  /** Carry the paint under the brush at (fx, fy) to (tx, ty). */
  _smudgeDab(fx, fy, tx, ty) {
    const s = this.s;
    const { layer, patch, tip } = s;
    const d = patch.width;
    const pc = patch.getContext('2d');
    pc.globalCompositeOperation = 'copy';
    pc.drawImage(s.work, -(fx - d / 2 - layer.x), -(fy - d / 2 - layer.y));
    pc.globalCompositeOperation = 'destination-in';
    pc.drawImage(tip, 0, 0, d, d);
    const sel = this.doc.selection;
    if (!sel.isEmpty()) pc.drawImage(sel.mask, -(tx - d / 2), -(ty - d / 2));
    pc.globalCompositeOperation = 'source-over';
    const wc = s.work.getContext('2d');
    wc.globalAlpha = this.options.strength;
    wc.drawImage(patch, tx - d / 2 - layer.x, ty - d / 2 - layer.y);
    wc.globalAlpha = 1;
    const r = { x: Math.floor(tx - d / 2) - 1, y: Math.floor(ty - d / 2) - 1, w: d + 3, h: d + 3 };
    s.bounds = rectUnion(s.bounds, r);
    this.app.renderer.request(true, r);
  }

  /* ---------- UI ---------- */

  drawOverlay(ctx, view) {
    const hover = this.app.hover;
    brushCursor(ctx, view, hover, this.options.size);
    if (!this.usesSource || !this.source || this.source.docId !== this.doc?.id) return;
    let p;
    if (this.s && this.offset && hover) p = view.docToScreen(hover.x + this.offset.x, hover.y + this.offset.y);
    else if (this.options.aligned && this.offset && hover) p = view.docToScreen(hover.x + this.offset.x, hover.y + this.offset.y);
    else p = view.docToScreen(this.source.x, this.source.y);
    strokeOutline(ctx, (c) => {
      c.moveTo(p.x - 7, p.y);
      c.lineTo(p.x + 7, p.y);
      c.moveTo(p.x, p.y - 7);
      c.lineTo(p.x, p.y + 7);
    });
  }

  onKeyDown(e) {
    return brushKeys(this, e, { amountKey: AMOUNT_KEY[this.kind] || null });
  }

  buildOptions(bar) {
    const o = this.options;
    const pct = (key, label) => bar.slider({ label, min: 1, max: 100, value: Math.round(o[key] * 100), unit: '%',
      onInput: (v) => this.setOption(key, v / 100) });
    bar.slider({ label: 'Size', min: 1, max: 1000, value: o.size, unit: 'px', curve: 'log', onInput: (v) => this.setOption('size', v) });
    bar.slider({ label: 'Hardness', min: 0, max: 100, value: Math.round(o.hardness * 100), unit: '%',
      onInput: (v) => this.setOption('hardness', v / 100) });
    bar.sep();
    if (this.kind === 'clone') pct('opacity', 'Opacity');
    if (this.usesSource) {
      bar.checkbox({ label: 'Aligned', title: 'Keep the same offset between strokes', checked: o.aligned,
        onChange: (v) => { this.setOption('aligned', v); this.offset = null; } });
      bar.select({ label: 'Sample', value: o.sample, onChange: (v) => this.setOption('sample', v),
        options: [{ value: 'current', label: 'Current Layer' }, { value: 'all', label: 'All Layers' }] });
      bar.hint('Alt-click to set the source');
    }
    if (this.kind === 'dodge' || this.kind === 'burn') {
      bar.select({ label: 'Range', value: o.range, onChange: (v) => this.setOption('range', v),
        options: [{ value: 'shadows', label: 'Shadows' }, { value: 'midtones', label: 'Midtones' }, { value: 'highlights', label: 'Highlights' }] });
      pct('exposure', 'Exposure');
    }
    if (this.kind === 'sponge') {
      bar.select({ label: 'Mode', value: o.mode, onChange: (v) => this.setOption('mode', v),
        options: [{ value: 'desaturate', label: 'Desaturate' }, { value: 'saturate', label: 'Saturate' }] });
      pct('flow', 'Flow');
    }
    if ('strength' in o) pct('strength', 'Strength');
    if (this.kind === 'spot') bar.hint('Paint over a blemish; it is replaced with matching texture from nearby');
  }
}
