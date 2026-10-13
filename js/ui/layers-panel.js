import { h, clear, selectInput, iconButton, revealInList } from './dom.js';
import { icon } from './icons.js';
import { BLEND_MODES } from '../core/layer.js';
import { clamp, debounce } from '../core/utils.js';

const THUMB_W = 80;
const THUMB_H = 64;

/** Layers panel: blend mode, opacity, lock, the layer stack and its buttons. */
export class LayersPanel {
  constructor(app) {
    this.app = app;
    this.thumbs = new Map(); // layer id -> canvas
    this.drawn = new Map(); // layer id -> layer.version last drawn
    this.dragId = null;

    this.blend = selectInput({
      title: 'Blend mode', value: 'source-over', options: BLEND_MODES,
      onChange: (v) => this._setProp('blendMode', v, 'Blending Change'),
    });
    this.opacityRange = h('input', { type: 'range', class: 'range', min: 0, max: 100, style: { width: '64px' }, 'aria-label': 'Layer opacity' });
    this.opacityNum = h('input', { type: 'number', class: 'num-input', min: 0, max: 100, 'aria-label': 'Layer opacity percent' });
    this._bindOpacity();
    this.lockBtn = h('button', {
      type: 'button', class: 'icon-btn', title: 'Lock all (Ctrl+/)', 'aria-label': 'Lock layer',
      onClick: () => app.runAction('layer.lock'),
    }, icon('lock', 15));

    this.list = h('div', { class: 'layers-list', role: 'listbox', 'aria-label': 'Layers' });
    const footer = h('div', { class: 'layers-footer' },
      iconButton('layer-new', 'Create a new layer', () => app.runAction('layer.new')),
      iconButton('duplicate', 'Duplicate layer', () => app.runAction('layer.duplicate')),
      iconButton('merge', 'Merge down (Ctrl+E)', () => app.runAction('layer.mergeDown')),
      iconButton('trash', 'Delete layer', () => app.runAction('layer.delete')));

    this.el = h('div', { style: { display: 'flex', flexDirection: 'column', flex: '1', minHeight: '0' } },
      h('div', { class: 'layers-controls' }, this.blend,
        h('div', { class: 'layers-opacity', title: 'Opacity' }, this.opacityRange, this.opacityNum)),
      h('div', { class: 'layers-lockrow' }, 'Lock:', this.lockBtn),
      this.list,
      footer);

    app.on('layers', () => this.render());
    app.on('document', () => this.render());
    app.on('pixels', debounce(() => this.updateThumbs(), 120));
    this.render();
  }

  get layer() { return this.app.doc?.activeLayer || null; }

  _setProp(prop, value, label) {
    const layer = this.layer;
    if (!layer || layer[prop] === value) return;
    this.app.transact(label, { structure: true }, () => { layer[prop] = value; });
  }

  _bindOpacity() {
    let start = null;
    const begin = () => {
      if (start == null && this.layer) start = this.layer.opacity;
    };
    const live = (v) => {
      begin();
      if (!this.layer) return;
      this.layer.opacity = v;
      this.app.renderer.request(true);
    };
    const commit = (v) => {
      const layer = this.layer;
      if (!layer) return;
      const old = start ?? layer.opacity;
      start = null;
      layer.opacity = old;
      if (old === v) return this._syncControls();
      this.app.transact('Opacity Change', { structure: true }, () => { layer.opacity = v; });
    };
    this.opacityRange.addEventListener('pointerdown', begin);
    this.opacityRange.addEventListener('input', () => {
      this.opacityNum.value = this.opacityRange.value;
      live(Number(this.opacityRange.value) / 100);
    });
    this.opacityRange.addEventListener('change', () => commit(Number(this.opacityRange.value) / 100));
    this.opacityNum.addEventListener('change', () => {
      const v = clamp(Math.round(Number(this.opacityNum.value) || 0), 0, 100);
      commit(v / 100);
    });
  }

  _syncControls() {
    const layer = this.layer;
    const disabled = !layer;
    for (const el of [this.blend, this.opacityRange, this.opacityNum, this.lockBtn]) el.disabled = disabled;
    if (!layer) return;
    this.blend.value = layer.blendMode;
    const pct = Math.round(layer.opacity * 100);
    this.opacityRange.value = pct;
    this.opacityNum.value = pct;
    this.lockBtn.classList.toggle('active', layer.locked);
    this.lockBtn.title = layer.locked ? 'Unlock layer (Ctrl+/)' : 'Lock all (Ctrl+/)';
  }

  render() {
    clear(this.list);
    this.thumbs.clear();
    const doc = this.app.doc;
    this._syncControls();
    if (!doc) return;
    for (let i = doc.layers.length - 1; i >= 0; i--) this.list.append(this._row(doc, doc.layers[i]));
    this.updateThumbs(true);
    revealInList(this.list, this.list.querySelector('.layer-row.active'));
  }

  _row(doc, layer) {
    const app = this.app;
    const active = layer.id === doc.activeId;
    const eye = h('button', {
      type: 'button', class: 'icon-btn layer-eye' + (layer.visible ? '' : ' off'),
      title: layer.visible ? 'Hide layer' : 'Show layer', 'aria-label': layer.visible ? 'Hide layer' : 'Show layer',
      onClick: (e) => {
        e.stopPropagation();
        app.transact(layer.visible ? 'Hide Layer' : 'Show Layer', { structure: true }, () => { layer.visible = !layer.visible; });
      },
    }, icon('eye', 15));
    const thumb = h('canvas', { class: 'layer-thumb', width: THUMB_W, height: THUMB_H, title: 'Ctrl-click to select the layer’s pixels' });
    thumb.addEventListener('click', (e) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      e.stopPropagation();
      doc.setActive(layer);
      app.runAction('select.layerPixels');
      app.emit('layers');
    });
    this.thumbs.set(layer.id, thumb);
    const name = h('div', { class: 'layer-name', title: 'Double-click to rename' }, layer.name);
    name.addEventListener('dblclick', (e) => {
      e.stopPropagation();
      this._rename(layer, name);
    });
    const row = h('div', {
      class: 'layer-row' + (active ? ' active' : ''), draggable: 'true', role: 'option', 'aria-selected': String(active),
    }, eye, thumb, name, layer.locked ? h('span', { class: 'layer-lock', title: 'Locked' }, icon('lock', 13)) : null);

    row.addEventListener('click', () => {
      if (doc.activeId === layer.id) return;
      doc.setActive(layer);
      app.emit('layers');
    });
    row.addEventListener('dragstart', (e) => {
      this.dragId = layer.id;
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', layer.name);
    });
    row.addEventListener('dragover', (e) => {
      if (this.dragId == null) return;
      e.preventDefault();
      const r = row.getBoundingClientRect();
      const above = e.clientY < r.top + r.height / 2;
      row.classList.toggle('drop-above', above);
      row.classList.toggle('drop-below', !above);
    });
    row.addEventListener('dragleave', () => row.classList.remove('drop-above', 'drop-below'));
    row.addEventListener('drop', (e) => {
      if (this.dragId == null) return;
      e.preventDefault();
      e.stopPropagation();
      const above = row.classList.contains('drop-above');
      row.classList.remove('drop-above', 'drop-below');
      const dragged = doc.layers.find((l) => l.id === this.dragId);
      this.dragId = null;
      if (!dragged || dragged === layer) return;
      const without = doc.layers.filter((l) => l !== dragged);
      const t = without.indexOf(layer);
      const to = above ? t + 1 : t;
      if (to === doc.layers.indexOf(dragged)) return;
      app.transact('Layer Order', { structure: true }, () => doc.moveLayer(dragged, to));
    });
    row.addEventListener('dragend', () => {
      this.dragId = null;
      for (const r of this.list.children) r.classList.remove('drop-above', 'drop-below');
    });
    return row;
  }

  _rename(layer, nameEl) {
    const input = h('input', { type: 'text', class: 'layer-name-input', value: layer.name, 'aria-label': 'Layer name' });
    clear(nameEl).append(input);
    input.focus();
    input.select();
    let done = false;
    const finish = (save) => {
      if (done) return;
      done = true;
      const value = input.value.trim();
      if (save && value && value !== layer.name) {
        this.app.transact('Rename Layer', { structure: true }, () => { layer.name = value; });
      } else {
        this.render();
      }
    };
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') finish(true);
      else if (e.key === 'Escape') finish(false);
      e.stopPropagation();
    });
    input.addEventListener('blur', () => finish(true));
    input.addEventListener('click', (e) => e.stopPropagation());
  }

  updateThumbs(force = false) {
    const doc = this.app.doc;
    if (!doc) return;
    for (const layer of doc.layers) {
      const canvas = this.thumbs.get(layer.id);
      if (!canvas) continue;
      if (!force && this.drawn.get(layer.id) === layer.version) continue;
      this.drawn.set(layer.id, layer.version);
      const ctx = canvas.getContext('2d');
      ctx.clearRect(0, 0, THUMB_W, THUMB_H);
      const s = Math.min(THUMB_W / doc.width, THUMB_H / doc.height);
      const w = doc.width * s;
      const hh = doc.height * s;
      const ox = (THUMB_W - w) / 2;
      const oy = (THUMB_H - hh) / 2;
      ctx.save();
      ctx.beginPath();
      ctx.rect(ox, oy, w, hh);
      ctx.clip();
      for (let y = 0; y < hh; y += 8) {
        for (let x = 0; x < w; x += 8) {
          ctx.fillStyle = ((x + y) / 8) % 2 ? '#cccccc' : '#ffffff';
          ctx.fillRect(ox + x, oy + y, 8, 8);
        }
      }
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(layer.canvas, ox + layer.x * s, oy + layer.y * s, layer.width * s, layer.height * s);
      ctx.restore();
    }
  }
}
