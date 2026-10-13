import { h, clear, selectInput, iconButton, revealInList } from './dom.js';
import { icon } from './icons.js';
import { BLEND_MODES, GROUP_BLEND_MODES } from '../core/layer.js';
import { depthOf, isAncestor } from '../core/document.js';
import { ADJUSTMENTS, ADJUSTMENT_LAYER_TYPES } from '../core/adjustments.js';
import { hasStyles } from '../core/effects.js';
import { clamp, debounce } from '../core/utils.js';

const THUMB_W = 80;
const THUMB_H = 64;

/** Shown as a row: not inside a closed group. */
function shown(layer) {
  for (let p = layer.parent; p; p = p.parent) if (p.collapsed) return false;
  return true;
}

/** Layers panel: blend mode, opacity, lock, the layer stack and its buttons. */
export class LayersPanel {
  constructor(app) {
    this.app = app;
    this.thumbs = new Map(); // layer id -> canvas
    this.maskThumbs = new Map(); // layer id -> mask thumbnail canvas
    this.drawn = new Map(); // thumbnail key -> layer.version last drawn
    this.dragId = null;
    this.blendForGroup = null;

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
    this.adjustBtn = iconButton('adjust', 'Create a new adjustment layer', () => this._adjustMenu());
    const footer = h('div', { class: 'layers-footer' },
      iconButton('fx', 'Add a layer style', () => app.runAction('layer.style.open')),
      iconButton('mask', 'Add a layer mask (Alt-click to start hidden)', (e) => {
        const sel = app.doc && !app.doc.selection.isEmpty();
        app.runAction(e.altKey ? (sel ? 'mask.hideSelection' : 'mask.hideAll') : 'mask.add');
      }),
      this.adjustBtn,
      iconButton('folder', 'Create a new group', () => app.runAction('layer.newGroup')),
      iconButton('layer-new', 'Create a new layer', () => app.runAction('layer.new')),
      iconButton('duplicate', 'Duplicate layer', () => app.runAction('layer.duplicate')),
      iconButton('trash', 'Delete layer', () => app.runAction('layer.delete')));

    this.el = h('div', { style: { display: 'flex', flexDirection: 'column', flex: '1', minHeight: '0', position: 'relative' } },
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
    // Enter applies the value and hands the keyboard back to the shortcuts.
    this.opacityNum.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') this.opacityNum.blur();
    });
  }

  _syncControls() {
    const layer = this.layer;
    const disabled = !layer;
    for (const el of [this.blend, this.opacityRange, this.opacityNum, this.lockBtn]) el.disabled = disabled;
    if (!layer) return;
    // Groups also offer Pass Through.
    if (this.blendForGroup !== layer.isGroup) {
      this.blendForGroup = layer.isGroup;
      const fresh = selectInput({
        title: 'Blend mode', value: layer.blendMode, options: layer.isGroup ? GROUP_BLEND_MODES : BLEND_MODES,
        onChange: (v) => this._setProp('blendMode', v, 'Blending Change'),
      });
      this.blend.replaceWith(fresh);
      this.blend = fresh;
    }
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
    this.maskThumbs.clear();
    const doc = this.app.doc;
    this._syncControls();
    if (!doc) return;
    // When another layer becomes active, open the groups around it so its row shows.
    if (doc.activeId !== this.shownActive) {
      this.shownActive = doc.activeId;
      for (let p = doc.activeLayer?.parent; p; p = p.parent) p.collapsed = false;
    }
    for (let i = doc.layers.length - 1; i >= 0; i--) {
      if (shown(doc.layers[i])) this.list.append(this._row(doc, doc.layers[i]));
    }
    this.updateThumbs(true);
    revealInList(this.list, this.list.querySelector('.layer-row.active'));
  }

  _select(doc, layer) {
    if (doc.activeId === layer.id) return;
    doc.setActive(layer);
    this.app.emit('layers');
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
    const depth = depthOf(layer);
    // Indented past the group's own disclosure arrow and folder.
    const indent = depth ? h('span', { class: 'layer-indent', style: { width: `${depth * 24 - 6}px` } }) : null;

    let twist = null;
    let thumb;
    if (layer.isGroup) {
      twist = h('button', {
        type: 'button', class: 'layer-twist', title: layer.collapsed ? 'Expand group' : 'Collapse group',
        'aria-label': layer.collapsed ? 'Expand group' : 'Collapse group', 'aria-expanded': String(!layer.collapsed),
        onClick: (e) => {
          e.stopPropagation();
          layer.collapsed = !layer.collapsed;
          this.render();
        },
      }, layer.collapsed ? '▸' : '▾');
      thumb = h('div', { class: 'layer-thumb layer-icon', title: 'Group' }, icon('folder', 20));
    } else if (layer.isAdjustment) {
      const title = ADJUSTMENTS[layer.adjustment?.type]?.title || 'Adjustment';
      thumb = h('div', { class: 'layer-thumb layer-icon', title: `${title} — double-click to change the settings` }, icon('adjust', 18));
      thumb.addEventListener('dblclick', (e) => {
        e.stopPropagation();
        doc.setActive(layer);
        app.runAction('layer.adjustmentOptions');
      });
    } else {
      thumb = h('canvas', { class: 'layer-thumb', width: THUMB_W, height: THUMB_H, title: 'Ctrl-click to select the layer’s pixels' });
      this.thumbs.set(layer.id, thumb);
      thumb.addEventListener('dblclick', (e) => {
        if (!layer.text) return;
        e.stopPropagation();
        doc.setActive(layer);
        app.setTool('text');
        app.tools.get('text').edit(layer);
      });
    }
    thumb.addEventListener('click', (e) => {
      if ((e.ctrlKey || e.metaKey) && layer.isPixel) {
        e.stopPropagation();
        doc.setActive(layer);
        app.runAction('select.layerPixels');
        app.emit('layers');
      } else if (layer.maskSelected && layer.isPixel) {
        // Back to editing the layer's pixels.
        e.stopPropagation();
        layer.maskSelected = false;
        doc.setActive(layer);
        app.emit('layers');
      }
    });

    let maskThumb = null;
    if (layer.mask) {
      maskThumb = h('canvas', {
        class: 'layer-thumb mask-thumb', width: THUMB_W, height: THUMB_H,
        title: 'Layer mask — click to edit it, Shift-click to disable it',
      });
      maskThumb.addEventListener('click', (e) => {
        e.stopPropagation();
        doc.setActive(layer);
        if (e.shiftKey) {
          app.runAction('mask.toggle');
          return;
        }
        layer.maskSelected = true;
        app.emit('layers');
      });
      this.maskThumbs.set(layer.id, maskThumb);
    }
    if (active && layer.mask) (layer.maskSelected ? maskThumb : thumb).classList.add('target');

    const name = h('div', { class: 'layer-name', title: 'Double-click to rename' }, layer.name);
    name.addEventListener('dblclick', (e) => {
      e.stopPropagation();
      this._rename(layer, name);
    });
    const fx = hasStyles(layer)
      ? h('button', {
        type: 'button', class: 'layer-kind layer-fx', title: 'Layer style — click to edit',
        onClick: (e) => {
          e.stopPropagation();
          doc.setActive(layer);
          app.runAction('layer.style.open');
        },
      }, 'fx')
      : null;
    const row = h('div', {
      class: 'layer-row' + (active ? ' active' : '') + (layer.isGroup ? ' group' : ''),
      draggable: 'true', role: 'option', 'aria-selected': String(active), dataset: { id: String(layer.id) },
    }, eye, indent, twist, thumb, maskThumb, name,
    layer.text ? h('span', { class: 'layer-kind', title: 'Type layer — double-click the thumbnail to edit' }, 'T') : null,
    fx,
    layer.locked ? h('span', { class: 'layer-lock', title: 'Locked' }, icon('lock', 13)) : null);

    row.addEventListener('click', () => this._select(doc, layer));
    // Double-click beside the name opens Layer Style, as in Photoshop.
    row.addEventListener('dblclick', (e) => {
      if (e.target !== row || !layer.isPixel) return;
      doc.setActive(layer);
      app.runAction('layer.style.open');
    });
    this._bindDrag(doc, row, layer);
    return row;
  }

  /** Where a drop on this row would put the dragged layer. */
  _dropZone(row, layer, clientY) {
    const r = row.getBoundingClientRect();
    const t = (clientY - r.top) / r.height;
    if (layer.isGroup) {
      if (t < 0.25) return 'above';
      if (t > 0.75 && layer.collapsed) return 'below';
      return 'into';
    }
    return t < 0.5 ? 'above' : 'below';
  }

  _bindDrag(doc, row, layer) {
    const app = this.app;
    const clearMarks = (el) => el.classList.remove('drop-above', 'drop-below', 'drop-into');
    row.addEventListener('dragstart', (e) => {
      this.dragId = layer.id;
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', layer.name);
    });
    row.addEventListener('dragover', (e) => {
      if (this.dragId == null) return;
      e.preventDefault();
      const where = this._dropZone(row, layer, e.clientY);
      clearMarks(row);
      row.classList.add(`drop-${where}`);
    });
    row.addEventListener('dragleave', () => clearMarks(row));
    row.addEventListener('drop', (e) => {
      if (this.dragId == null) return;
      e.preventDefault();
      e.stopPropagation();
      const where = this._dropZone(row, layer, e.clientY);
      clearMarks(row);
      const dragged = doc.layers.find((l) => l.id === this.dragId);
      this.dragId = null;
      if (!dragged || dragged === layer || isAncestor(dragged, layer)) return;
      // Skip drops that would leave everything where it is.
      const before = doc.layers.slice();
      const parent = dragged.parent;
      doc.place(dragged, layer, where);
      const moved = dragged.parent !== parent || before.some((l, i) => l !== doc.layers[i]);
      doc.layers = before;
      dragged.parent = parent;
      if (moved) app.transact('Layer Order', { structure: true }, () => doc.place(dragged, layer, where));
    });
    row.addEventListener('dragend', () => {
      this.dragId = null;
      for (const r of this.list.children) clearMarks(r);
    });
  }

  /** Pop-up list of adjustment layers to create. */
  _adjustMenu() {
    if (this.popup) {
      this.popup.remove();
      this.popup = null;
      return;
    }
    const close = () => {
      this.popup?.remove();
      this.popup = null;
      document.removeEventListener('pointerdown', outside, true);
    };
    const outside = (e) => {
      if (!this.popup?.contains(e.target) && e.target !== this.adjustBtn && !this.adjustBtn.contains(e.target)) close();
    };
    const items = ADJUSTMENT_LAYER_TYPES.map((type) => h('button', {
      type: 'button', class: 'menu-item', role: 'menuitem', disabled: !this.app.doc,
      onClick: () => {
        close();
        this.app.runAction(`layer.adjust.${type}`);
      },
    }, h('span', {}, this.app.actions[`layer.adjust.${type}`]?.label || ADJUSTMENTS[type].title)));
    this.popup = h('div', { class: 'menu-dropdown layers-popup', role: 'menu' }, items);
    this.el.append(this.popup);
    document.addEventListener('pointerdown', outside, true);
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
    const s = Math.min(THUMB_W / doc.width, THUMB_H / doc.height);
    const w = doc.width * s;
    const hh = doc.height * s;
    const ox = (THUMB_W - w) / 2;
    const oy = (THUMB_H - hh) / 2;
    for (const layer of doc.layers) {
      const canvas = this.thumbs.get(layer.id);
      if (canvas && (force || this.drawn.get(layer.id) !== layer.version)) {
        this.drawn.set(layer.id, layer.version);
        const ctx = canvas.getContext('2d');
        ctx.clearRect(0, 0, THUMB_W, THUMB_H);
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
      const mc = this.maskThumbs.get(layer.id);
      const key = `m${layer.id}`;
      if (mc && layer.mask && (force || this.drawn.get(key) !== layer.version)) {
        this.drawn.set(key, layer.version);
        const m = layer.mask;
        const b = m.bounds(layer);
        const ctx = mc.getContext('2d');
        ctx.fillStyle = '#000000';
        ctx.fillRect(0, 0, THUMB_W, THUMB_H);
        ctx.save();
        ctx.beginPath();
        ctx.rect(ox, oy, w, hh);
        ctx.clip();
        ctx.fillStyle = `rgba(255,255,255,${m.outside / 255})`;
        ctx.fillRect(ox, oy, w, hh);
        ctx.fillStyle = '#000000';
        ctx.fillRect(ox + b.x * s, oy + b.y * s, b.w * s, b.h * s);
        ctx.drawImage(m.canvas, ox + b.x * s, oy + b.y * s, b.w * s, b.h * s);
        ctx.restore();
        if (!m.enabled) {
          ctx.strokeStyle = '#e34850';
          ctx.lineWidth = 4;
          ctx.beginPath();
          ctx.moveTo(4, 4);
          ctx.lineTo(THUMB_W - 4, THUMB_H - 4);
          ctx.moveTo(THUMB_W - 4, 4);
          ctx.lineTo(4, THUMB_H - 4);
          ctx.stroke();
        }
      }
    }
  }
}
