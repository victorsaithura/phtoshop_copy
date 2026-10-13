import { h } from './dom.js';

const HINTS = {
  move: 'Drag to move the layer, or the selected pixels. Alt-drag moves a copy. Ctrl-click picks a layer.',
  'marquee-rect': 'Drag to select. Shift adds, Alt subtracts. Shift while dragging = square, Alt = from centre.',
  'marquee-ellipse': 'Drag to select. Shift adds, Alt subtracts. Shift while dragging = circle, Alt = from centre.',
  lasso: 'Drag to draw a freehand selection. Shift adds, Alt subtracts.',
  'polygon-lasso': 'Click to add corners; click the first corner, double-click or press Enter to close. Backspace removes a corner.',
  wand: 'Click to select similar colours. Shift adds, Alt subtracts. Adjust Tolerance in the options bar.',
  'spot-heal': 'Paint over a blemish; it is replaced with matching texture from nearby.',
  heal: 'Alt-click to set a source, then paint: texture is copied and blended into the surroundings.',
  clone: 'Alt-click to set a source, then paint to copy it. [ ] change size.',
  blur: 'Paint to soften detail.',
  sharpen: 'Paint to sharpen detail.',
  smudge: 'Drag to smear colours like wet paint.',
  dodge: 'Paint to lighten. Choose shadows, midtones or highlights in the options bar.',
  burn: 'Paint to darken. Choose shadows, midtones or highlights in the options bar.',
  sponge: 'Paint to desaturate or saturate colours.',
  text: 'Click to add text, or click a text layer to edit it. Ctrl+Enter or click away to commit, Esc cancels.',
  'shape-rect': 'Drag to draw a rectangle on a new layer. Shift = square, Alt = from centre.',
  'shape-ellipse': 'Drag to draw an ellipse on a new layer. Shift = circle, Alt = from centre.',
  'shape-polygon': 'Drag to draw a polygon on a new layer. Set the number of sides in the options bar.',
  'shape-line': 'Drag to draw a line on a new layer. Shift keeps it at 45° steps.',
  transform: 'Drag a handle to scale (Shift: free), inside to move, outside to rotate. Enter applies, Esc cancels.',
  crop: 'Drag the handles to set the crop or drag outside it for a new box. Enter or double-click crops, Esc resets.',
  eyedropper: 'Click to pick the foreground colour. Alt-click picks the background colour.',
  brush: 'Paint with the foreground colour. [ ] change size, Shift-click draws a straight line, Alt picks a colour.',
  pencil: 'Hard-edged painting. [ ] change size, Shift-click draws a straight line.',
  eraser: 'Erase to transparency. [ ] change size.',
  gradient: 'Drag to draw a gradient. Shift constrains the angle.',
  bucket: 'Click to fill similar colours with the foreground colour.',
  hand: 'Drag to scroll. Hold Space with any tool to pan.',
  zoom: 'Click to zoom in, Alt-click to zoom out. Ctrl + scroll also zooms.',
};

export class StatusBar {
  constructor(app, el) {
    this.app = app;
    this.zoom = h('input', { type: 'text', 'aria-label': 'Zoom level', title: 'Zoom level — type a percentage' });
    this.size = h('span', { class: 'status-size' });
    this.pos = h('span', { class: 'status-pos' });
    this.hint = h('span', { class: 'status-hint' });
    el.append(h('span', { class: 'status-zoom' }, this.zoom), this.size, this.pos, this.hint);

    this.zoom.addEventListener('change', () => {
      const z = parseFloat(this.zoom.value);
      if (app.doc && z > 0) {
        app.view.setZoom(z / 100);
        app.viewChanged();
      } else {
        this._sync();
      }
    });
    this.zoom.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') this.zoom.blur();
    });
    app.on('view', () => this._sync());
    app.on('document', () => this._sync());
    app.on('layers', () => this._sync());
    app.on('cursor', (ev) => {
      this.pos.textContent = ev && app.doc ? `X: ${Math.floor(ev.x)}  Y: ${Math.floor(ev.y)}` : '';
    });
    app.on('tool', (tool) => { this.hint.textContent = HINTS[tool.id] || ''; });
    this._sync();
  }

  _sync() {
    const doc = this.app.doc;
    this.zoom.disabled = !doc;
    if (document.activeElement !== this.zoom) {
      this.zoom.value = doc ? `${Math.round(this.app.view.zoom * 1000) / 10}%` : '';
    }
    this.size.textContent = doc ? `${doc.width} × ${doc.height} px` : '';
  }
}
