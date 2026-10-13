import { Tool } from './tool.js';
import { Layer } from '../core/layer.js';
import { FONTS, cssFont, lineHeight, renderText, textPadding } from '../core/text.js';
import { createCanvas } from '../core/utils.js';

const STYLES = [
  { value: 'regular', label: 'Regular' },
  { value: 'bold', label: 'Bold' },
  { value: 'italic', label: 'Italic' },
  { value: 'bold-italic', label: 'Bold Italic' },
];
const ALIGNS = [
  { value: 'left', icon: 'align-left', title: 'Left align text' },
  { value: 'center', icon: 'align-center', title: 'Center text' },
  { value: 'right', icon: 'align-right', title: 'Right align text' },
];

const inside = (b, x, y) => x >= b.x && y >= b.y && x < b.x + b.w && y < b.y + b.h;
const styleOf = (t) => (t.bold && t.italic ? 'bold-italic' : t.bold ? 'bold' : t.italic ? 'italic' : 'regular');

/** Doc-space anchor of a type layer: where its alignment edge and first line sit. */
function anchorOf(layer) {
  const t = layer.text;
  const pad = textPadding(t);
  const w = layer.width;
  const ax = t.align === 'center' ? layer.x + w / 2 : t.align === 'right' ? layer.x + w - pad : layer.x + pad;
  return { x: ax, y: layer.y + pad + lineHeight(t) / 2 };
}

function placeAtAnchor(layer, anchor) {
  const t = layer.text;
  const pad = textPadding(t);
  const w = layer.width;
  layer.x = Math.round(t.align === 'center' ? anchor.x - w / 2 : t.align === 'right' ? anchor.x - w + pad : anchor.x - pad);
  layer.y = Math.round(anchor.y - pad - lineHeight(t) / 2);
}

/**
 * Horizontal Type Tool. Click to start typing (or click a type layer to edit
 * it); click elsewhere or press Ctrl+Enter to commit, Esc to cancel.
 */
export class TextTool extends Tool {
  constructor(app) {
    super(app, { id: 'text', name: 'Horizontal Type Tool', key: 'T', icon: 'text', cursor: 'text' });
    this.options = { font: 'Arial', size: 48, bold: false, italic: false, align: 'left' };
    this.rebuildOnColors = true;
    this.editing = null; // { layer, text, anchor, textarea }
    this.blank = createCanvas(1, 1);
    app.on('view', () => this._place());
    app.on('colors', () => {
      if (!this.editing) return;
      this.editing.text.color = app.colors.fg;
      this._style();
    });
  }

  onPointerDown(e) {
    if (this.editing) {
      this.commit();
      return;
    }
    const doc = this.doc;
    const hit = [...doc.layers].reverse().find((l) => l.text && doc.isVisible(l) && inside(l.bounds, e.x, e.y));
    if (hit) {
      doc.setActive(hit);
      this.app.emit('layers');
      this.edit(hit);
      return;
    }
    const o = this.options;
    this._open(null, {
      content: '', font: o.font, size: o.size, color: this.app.colors.fg, bold: o.bold, italic: o.italic, align: o.align,
    }, { x: e.x, y: e.y });
  }

  /** Start editing an existing type layer. */
  edit(layer) {
    if (this.editing) this.commit();
    if (layer.locked) {
      this.app.toast('Could not edit the text because the layer is locked.');
      return;
    }
    this._open(layer, { ...layer.text }, anchorOf(layer));
  }

  _open(layer, text, anchor) {
    const ta = document.createElement('textarea');
    ta.className = 'text-editor';
    ta.spellcheck = false;
    ta.value = text.content;
    ta.setAttribute('aria-label', 'Text');
    ta.addEventListener('input', () => this._place());
    ta.addEventListener('keydown', (ev) => {
      if (ev.key === 'Escape') {
        ev.preventDefault();
        ev.stopPropagation();
        this.cancel();
      } else if (ev.key === 'Enter' && (ev.ctrlKey || ev.metaKey)) {
        ev.preventDefault();
        this.commit();
      }
    });
    document.getElementById('workspace').append(ta);
    this.editing = { layer, text, anchor, textarea: ta };
    this._style();
    this.app.renderer.request(true);
    // Focus at once so the very first keystroke goes into the text.
    const focus = () => {
      if (this.editing?.textarea !== ta || document.activeElement === ta) return;
      ta.focus();
      ta.setSelectionRange(ta.value.length, ta.value.length);
    };
    focus();
    setTimeout(focus);
  }

  _style() {
    const ed = this.editing;
    if (!ed) return;
    const z = this.app.view.zoom;
    const t = ed.text;
    Object.assign(ed.textarea.style, {
      font: cssFont(t, z),
      lineHeight: `${lineHeight(t) * z}px`,
      color: t.color,
      textAlign: t.align,
    });
    this._place();
  }

  /** Size and position the editor over the canvas. */
  _place() {
    const ed = this.editing;
    if (!ed) return;
    const z = this.app.view.zoom;
    const t = ed.text;
    const ta = ed.textarea;
    const lines = ta.value.split('\n');
    const m = this.blank.getContext('2d');
    m.font = cssFont(t, z);
    const w = Math.ceil(Math.max(t.size * z * 0.6, ...lines.map((l) => m.measureText(l).width))) + 4;
    const lh = lineHeight(t) * z;
    const p = this.app.view.docToScreen(ed.anchor.x, ed.anchor.y);
    const left = t.align === 'center' ? p.x - w / 2 : t.align === 'right' ? p.x - w : p.x;
    Object.assign(ta.style, {
      left: `${Math.round(left)}px`,
      top: `${Math.round(p.y - lh / 2)}px`,
      width: `${w + 2}px`,
      height: `${Math.ceil(lh * lines.length) + 2}px`,
    });
  }

  layerOverride(layer) {
    // Hide the layer being edited; the editor shows its text instead.
    return this.editing && this.editing.layer === layer ? { canvas: this.blank, x: 0, y: 0 } : null;
  }

  _close() {
    const ed = this.editing;
    this.editing = null;
    ed?.textarea.remove();
    this.app.canvas.focus?.();
    this.app.renderer.request(true);
    return ed;
  }

  commit() {
    const ed = this._close();
    if (!ed) return;
    const doc = this.doc;
    const text = { ...ed.text, content: ed.textarea.value.replace(/\s+$/, '') };
    if (!text.content.trim()) {
      // Emptying a type layer removes it, as in Photoshop.
      if (ed.layer) this.app.transact('Delete Layer', { structure: true }, () => doc.removeLayer(ed.layer));
      return;
    }
    if (ed.layer) {
      const same = JSON.stringify(ed.layer.text) === JSON.stringify(text);
      if (same) return;
      this.app.transact('Edit Type Layer', { layers: [ed.layer] }, () => {
        ed.layer.text = text;
        renderText(ed.layer, false);
        placeAtAnchor(ed.layer, ed.anchor);
      });
      return;
    }
    const layer = new Layer({ name: text.content.split('\n')[0].slice(0, 40) });
    layer.text = text;
    renderText(layer, false);
    placeAtAnchor(layer, ed.anchor);
    this.app.transact('Type Layer', { structure: true }, () => doc.addLayer(layer));
  }

  cancel() {
    this._close();
  }

  onDeactivate() {
    this.commit();
  }

  /** Options apply to the text being edited, or to the selected type layer. */
  _apply(changes) {
    for (const [k, v] of Object.entries(changes)) if (k in this.options) this.setOption(k, v);
    if (this.editing) {
      Object.assign(this.editing.text, changes);
      this._style();
      return;
    }
    const layer = this.doc?.activeLayer;
    if (!layer?.text || layer.locked) return;
    const anchor = anchorOf(layer);
    this.app.transact('Edit Type Layer', { layers: [layer] }, () => {
      layer.text = { ...layer.text, ...changes };
      renderText(layer, false);
      placeAtAnchor(layer, anchor);
    });
  }

  buildOptions(bar) {
    const layer = this.doc?.activeLayer;
    const t = this.editing?.text || (layer?.text ? layer.text : { ...this.options, color: this.app.colors.fg });
    bar.select({
      title: 'Font family', value: t.font,
      options: FONTS.map((f) => ({ value: f, label: f })),
      onChange: (v) => this._apply({ font: v }),
    });
    bar.select({
      title: 'Font style', value: styleOf(t), options: STYLES,
      onChange: (v) => this._apply({ bold: v.includes('bold'), italic: v.includes('italic') }),
    });
    bar.number({ label: 'Size', min: 1, max: 1000, value: t.size, unit: 'px', onInput: (v) => this._apply({ size: v }) });
    bar.segmented({ value: t.align, options: ALIGNS, onChange: (v) => this._apply({ align: v }) });
    bar.button({
      label: 'Color', title: 'Apply the foreground colour to the text',
      onClick: () => this._apply({ color: this.app.colors.fg }),
    });
    bar.hint('Click to type · Ctrl+Enter or click away to commit · Esc cancels');
  }
}
