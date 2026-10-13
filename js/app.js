import { Emitter } from './core/emitter.js';
import { History } from './core/history.js';
import { Viewport, MIN_ZOOM, MAX_ZOOM } from './core/viewport.js';
import { Renderer } from './core/renderer.js';
import { clamp, debounce, normalizeHex, rectUnion, storageGet, storageSet } from './core/utils.js';

const TOOL_STORAGE_KEY = 'photoforge.toolOptions';

/**
 * Central application state. Emits:
 *  document, layers, pixels, selection, history, tool, tool-options,
 *  colors, view, cursor, toast
 */
export class App extends Emitter {
  constructor() {
    super();
    this.sessions = []; // open documents: { doc, history, view }
    this.session = null;
    this.view = new Viewport();
    this.colors = { fg: '#000000', bg: '#ffffff' };
    this.tools = new Map();
    this.tool = null;
    this.hover = null;
    this.selectionOffset = null; // live offset while dragging a selection
    this.preview = null; // { layer, canvas, x, y } shown instead of a layer (adjustment previews)
    this.clipboard = null;
    this.spaceDown = false;
    this.panning = false;
    this.activePointer = null;
    this._emptyHistory = new History(1);
    this._saveToolOptions = debounce(() => this._persistToolOptions(), 400);
  }

  get doc() { return this.session ? this.session.doc : null; }
  get history() { return this.session ? this.session.history : this._emptyHistory; }

  init(canvas) {
    this.canvas = canvas;
    this.renderer = new Renderer(this, canvas);
    this._bindPointer(canvas);
  }

  /* ---------- Documents ---------- */

  addDocument(doc, label = 'New') {
    if (this.session) this.session.view = this.view.save();
    const session = { doc, history: null, view: null };
    session.history = new History(60, () => {
      if (this.session === session) this.emit('history');
    });
    session.history.reset(label);
    this.sessions.push(session);
    this.session = session;
    this.view.fit(doc.width, doc.height);
    this._documentChanged();
    return session;
  }

  switchTo(session) {
    if (!session || session === this.session) return;
    this.tool?.cancel?.();
    if (this.session) this.session.view = this.view.save();
    this.session = session;
    if (session.view) this.view.load(session.view);
    else this.view.fit(session.doc.width, session.doc.height);
    this._documentChanged();
  }

  closeDocument(session = this.session) {
    const i = this.sessions.indexOf(session);
    if (i < 0) return;
    this.tool?.cancel?.();
    this.sessions.splice(i, 1);
    if (session === this.session) {
      this.session = null;
      const next = this.sessions[Math.min(i, this.sessions.length - 1)];
      if (next) {
        this.session = next;
        if (next.view) this.view.load(next.view);
      }
    }
    this._documentChanged();
  }

  _documentChanged() {
    this.selectionOffset = null;
    this.preview = null;
    this.activePointer = null;
    for (const evt of ['document', 'layers', 'selection', 'history', 'view', 'pixels']) this.emit(evt);
    this.renderer.request(true);
  }

  /* ---------- History ---------- */

  /**
   * Run fn() as one undoable step. spec says what fn may change:
   * { structure?, selection?, layers?: [Layer | { layer, rect }] }
   */
  transact(label, spec, fn) {
    const doc = this.doc;
    if (!doc) return undefined;
    const before = doc.capture(spec);
    const result = fn();
    const after = doc.capture(spec);
    this.history.push(
      label,
      () => { doc.restore(before); this.changed(spec); },
      () => { doc.restore(after); this.changed(spec); },
    );
    this.changed(spec);
    return result;
  }

  /** Record a change that was already applied, with custom undo/redo. */
  record(label, undo, redo, spec = { structure: true }) {
    this.history.push(
      label,
      () => { undo(); this.changed(spec); },
      () => { redo(); this.changed(spec); },
    );
    this.changed(spec);
  }

  /** Notify UI + renderer after document changes. */
  changed(spec = {}) {
    const doc = this.doc;
    let full = !!spec.structure;
    let rect = null;
    if (spec.layers) {
      for (const it of spec.layers) {
        (it.layer || it).touch();
        if (it.rect) rect = rectUnion(rect, it.rect);
        else full = true;
      }
    }
    if (spec.structure && doc) {
      // Redraw every thumbnail; pixels themselves are unchanged (no contentVersion bump).
      for (const l of doc.layers) l.version++;
      this.emit('layers');
    }
    if (spec.selection) this.emit('selection');
    this.emit('pixels');
    // Recomposite only what changed; a pure selection change just redraws overlays.
    if (full || (!rect && !spec.selection)) this.renderer.request(true);
    else if (rect) this.renderer.request(true, rect);
    else this.renderer.request(false);
  }

  undo() { this.history.undo(); }
  redo() { this.history.redo(); }

  /* ---------- Tools ---------- */

  registerTool(tool) {
    this.tools.set(tool.id, tool);
    const saved = storageGet(TOOL_STORAGE_KEY, {})[tool.id];
    if (saved && typeof saved === 'object') {
      for (const k of Object.keys(tool.options)) if (k in saved) tool.options[k] = saved[k];
    }
  }

  setTool(id) {
    const tool = this.tools.get(id);
    if (!tool || tool === this.tool) return;
    if (this.tool) {
      this.tool.cancel?.();
      this.tool.onDeactivate?.();
    }
    this.tool = tool;
    tool.onActivate?.();
    this.updateCursor();
    this.emit('tool', tool);
    this.renderer.request(true);
  }

  setToolOption(tool, key, value, notify = false) {
    tool.options[key] = value;
    this._saveToolOptions();
    if (notify) this.emit('tool-options', tool);
    this.renderer.request(false);
  }

  _persistToolOptions() {
    const all = {};
    for (const [id, t] of this.tools) all[id] = t.options;
    storageSet(TOOL_STORAGE_KEY, all);
  }

  updateCursor() {
    if (!this.canvas) return;
    let cursor = this.tool?.cursor || 'default';
    if (this.panning) cursor = 'grabbing';
    else if (this.spaceDown) cursor = 'grab';
    this.canvas.style.cursor = cursor;
  }

  /**
   * The active layer if it can be edited; otherwise explains why not.
   * Type layers must be rasterized before their pixels can change; groups and
   * adjustment layers have no pixels (only their masks can be painted), but
   * the Move tool can move them (allowGroup).
   */
  editableLayer(toolName = 'tool', { allowText = false, allowMask = false, allowGroup = false } = {}) {
    const doc = this.doc;
    const layer = doc?.activeLayer;
    if (!layer) return null;
    const onMask = !!(layer.mask && layer.maskSelected);
    if (onMask && !allowMask) {
      this.toast(`Could not use the ${toolName} on a layer mask. Click the layer thumbnail to edit its pixels.`);
      return null;
    }
    if (!layer.isPixel && !onMask && !allowGroup) {
      const what = layer.isGroup ? 'a group' : 'an adjustment layer';
      const hint = layer.mask ? ' Select a pixel layer, or click the mask thumbnail to paint on the mask.' : ' Select a pixel layer.';
      this.toast(`Could not use the ${toolName} because the target is ${what}.${hint}`);
      return null;
    }
    if (layer.text && !allowText && !onMask) {
      this.toast(`Could not use the ${toolName} because the type layer must be rasterized first (Layer ▸ Rasterize Type).`);
      return null;
    }
    if (!doc.isVisible(layer)) {
      this.toast(`Could not use the ${toolName} because the target layer is hidden.`);
      return null;
    }
    if (doc.isLocked(layer)) {
      this.toast(`Could not use the ${toolName} because the layer is locked.`);
      return null;
    }
    return layer;
  }

  /* ---------- Colors & messages ---------- */

  setColor(which, hex) {
    const n = normalizeHex(hex);
    if (!n || this.colors[which] === n) return;
    this.colors[which] = n;
    this.emit('colors');
  }

  swapColors() {
    this.colors = { fg: this.colors.bg, bg: this.colors.fg };
    this.emit('colors');
  }

  resetColors() {
    this.colors = { fg: '#000000', bg: '#ffffff' };
    this.emit('colors');
  }

  toast(message) { this.emit('toast', message); }

  /** Run a registered menu/keyboard action by id (see actions.js). */
  runAction(id) {
    const action = this.actions?.[id];
    if (!action || (action.enabled && !action.enabled())) return false;
    action.run();
    return true;
  }

  viewChanged() {
    this.emit('view');
    this.renderer.request(false);
  }

  /* ---------- Pointer input ---------- */

  _bindPointer(canvas) {
    const pointers = new Map();
    let pinch = null;
    let pan = null;
    let altPick = false;

    const local = (cx, cy) => {
      const r = canvas.getBoundingClientRect();
      return { x: cx - r.left, y: cy - r.top };
    };
    const toEvent = (e) => {
      const { x: sx, y: sy } = local(e.clientX, e.clientY);
      const p = this.view.screenToDoc(sx, sy);
      const pen = e.pointerType === 'pen';
      return {
        x: p.x, y: p.y, sx, sy, pen,
        pressure: pen ? Math.max(0.01, e.pressure || 0) : 1,
        button: e.button, shift: e.shiftKey, alt: e.altKey, ctrl: e.ctrlKey || e.metaKey,
      };
    };
    const pinchInfo = () => {
      const [a, b] = [...pointers.values()];
      const c = local((a.x + b.x) / 2, (a.y + b.y) / 2);
      return { dist: Math.hypot(a.x - b.x, a.y - b.y) || 1, cx: c.x, cy: c.y };
    };

    canvas.addEventListener('pointerdown', (e) => {
      if (!this.doc) return;
      if (document.activeElement && document.activeElement !== document.body) document.activeElement.blur();
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      canvas.setPointerCapture(e.pointerId);

      if (pointers.size === 2) {
        // Second finger: cancel whatever the first one started and pinch-zoom.
        if (this.activePointer != null) {
          this.tool?.cancel?.();
          this.activePointer = null;
          this.renderer.request(true);
        }
        const info = pinchInfo();
        pinch = { ...info, zoom: this.view.zoom, docPt: this.view.screenToDoc(info.cx, info.cy) };
        return;
      }
      if (pointers.size > 2) return;

      if (e.button === 1 || this.spaceDown) {
        e.preventDefault();
        pan = { sx: e.clientX, sy: e.clientY, panX: this.view.panX, panY: this.view.panY };
        this.panning = true;
        this.updateCursor();
        return;
      }
      if (e.button !== 0) return;
      const ev = toEvent(e);
      if (e.altKey && this.tool?.altEyedropper) {
        altPick = true;
        this.tools.get('eyedropper')?.pick(ev, 'fg');
        return;
      }
      this.activePointer = e.pointerId;
      this.tool?.onPointerDown(ev);
      this.renderer.request(false);
    });

    canvas.addEventListener('pointermove', (e) => {
      if (pointers.has(e.pointerId)) pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pinch) {
        if (pointers.size < 2) return;
        const info = pinchInfo();
        const z = clamp(pinch.zoom * (info.dist / pinch.dist), MIN_ZOOM, MAX_ZOOM);
        this.view.zoom = z;
        this.view.panX = info.cx - pinch.docPt.x * z;
        this.view.panY = info.cy - pinch.docPt.y * z;
        this.viewChanged();
        return;
      }
      if (pan) {
        this.view.panX = pan.panX + (e.clientX - pan.sx);
        this.view.panY = pan.panY + (e.clientY - pan.sy);
        this.viewChanged();
        return;
      }
      if (!this.doc) return;
      const ev = toEvent(e);
      this.hover = ev;
      this.emit('cursor', ev);
      if (altPick) {
        this.tools.get('eyedropper')?.pick(ev, 'fg');
        return;
      }
      if (this.activePointer === e.pointerId) {
        const list = this.tool?.wantsCoalesced && e.getCoalescedEvents ? e.getCoalescedEvents() : [];
        if (list.length > 1) for (const ce of list) this.tool.onPointerMove(toEvent(ce));
        else this.tool?.onPointerMove(ev);
      } else {
        this.tool?.onHover?.(ev);
      }
      this.renderer.request(false);
    });

    const end = (e) => {
      pointers.delete(e.pointerId);
      if (pinch) {
        if (pointers.size < 2) pinch = null;
        return;
      }
      if (pan) {
        pan = null;
        this.panning = false;
        this.updateCursor();
        return;
      }
      if (altPick) {
        altPick = false;
        return;
      }
      if (this.activePointer === e.pointerId) {
        this.activePointer = null;
        if (e.type === 'pointercancel') this.tool?.cancel?.();
        else this.tool?.onPointerUp(toEvent(e));
        this.renderer.request(true);
      }
    };
    canvas.addEventListener('pointerup', end);
    canvas.addEventListener('pointercancel', end);
    canvas.addEventListener('pointerleave', () => {
      if (this.activePointer != null) return;
      this.hover = null;
      this.emit('cursor', null);
      this.renderer.request(false);
    });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    // The canvas never takes focus, so stop mousedown from moving focus away
    // (keeps the Type tool's editor focused when it opens on click).
    canvas.addEventListener('mousedown', (e) => e.preventDefault());

    canvas.addEventListener('wheel', (e) => {
      if (!this.doc) return;
      e.preventDefault();
      const { x: ax, y: ay } = local(e.clientX, e.clientY);
      if (e.ctrlKey || e.metaKey || e.altKey) {
        const factor = Math.exp(-e.deltaY * (e.deltaMode === 1 ? 0.05 : 0.0025));
        this.view.setZoom(this.view.zoom * factor, ax, ay);
      } else {
        const k = e.deltaMode === 1 ? 16 : 1;
        let dx = e.deltaX * k;
        let dy = e.deltaY * k;
        if (e.shiftKey && !dx) [dx, dy] = [dy, 0];
        this.view.panX -= dx;
        this.view.panY -= dy;
      }
      this.viewChanged();
    }, { passive: false });
  }
}
