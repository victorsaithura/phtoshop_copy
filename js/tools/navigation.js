import { Tool } from './tool.js';
import { rgbToHex } from '../core/utils.js';

/** Eyedropper: click sets the foreground colour, Alt-click the background. */
export class EyedropperTool extends Tool {
  constructor(app) {
    super(app, { id: 'eyedropper', name: 'Eyedropper Tool', key: 'I', cursor: 'crosshair' });
    this.options = { sampleSize: 1, sample: 'all' };
    this.active = false;
  }

  onPointerDown(e) {
    this.active = true;
    this.which = e.alt ? 'bg' : 'fg';
    this.pick(e, this.which);
  }

  onPointerMove(e) {
    if (this.active) this.pick(e, this.which);
  }

  onPointerUp() {
    this.active = false;
  }

  cancel() {
    this.active = false;
  }

  /** Sample the document (or current layer) around a point. */
  pick(e, which = 'fg') {
    const doc = this.doc;
    if (!doc) return;
    const cx = Math.floor(e.x);
    const cy = Math.floor(e.y);
    if (cx < 0 || cy < 0 || cx >= doc.width || cy >= doc.height) return;
    const half = Math.floor(this.options.sampleSize / 2);
    const x0 = Math.max(0, cx - half);
    const y0 = Math.max(0, cy - half);
    const x1 = Math.min(doc.width, cx + half + 1);
    const y1 = Math.min(doc.height, cy + half + 1);

    let data;
    if (this.options.sample === 'current') {
      const layer = doc.activeLayer;
      if (!layer) return;
      const lx0 = Math.max(0, x0 - layer.x);
      const ly0 = Math.max(0, y0 - layer.y);
      const lx1 = Math.min(layer.width, x1 - layer.x);
      const ly1 = Math.min(layer.height, y1 - layer.y);
      if (lx1 <= lx0 || ly1 <= ly0) return;
      data = layer.ctx.getImageData(lx0, ly0, lx1 - lx0, ly1 - ly0).data;
    } else {
      const comp = this.app.renderer.getComposite();
      data = comp.getContext('2d').getImageData(x0, y0, x1 - x0, y1 - y0).data;
    }

    // Alpha-weighted average.
    let r = 0, g = 0, b = 0, total = 0;
    for (let i = 0; i < data.length; i += 4) {
      const a = data[i + 3];
      r += data[i] * a;
      g += data[i + 1] * a;
      b += data[i + 2] * a;
      total += a;
    }
    if (!total) return;
    this.app.setColor(which, rgbToHex({ r: r / total, g: g / total, b: b / total }));
  }

  buildOptions(bar) {
    bar.select({
      label: 'Sample Size',
      value: String(this.options.sampleSize),
      options: [
        { value: '1', label: 'Point Sample' },
        { value: '3', label: '3 by 3 Average' },
        { value: '5', label: '5 by 5 Average' },
        { value: '11', label: '11 by 11 Average' },
        { value: '31', label: '31 by 31 Average' },
      ],
      onChange: (v) => this.setOption('sampleSize', Number(v)),
    });
    bar.select({
      label: 'Sample',
      value: this.options.sample,
      options: [
        { value: 'all', label: 'All Layers' },
        { value: 'current', label: 'Current Layer' },
      ],
      onChange: (v) => this.setOption('sample', v),
    });
  }
}

function viewButtons(app, bar) {
  bar.button({ label: '100%', title: 'Actual pixels', onClick: () => app.runAction('view.actual') });
  bar.button({ label: 'Fit Screen', title: 'Fit on screen', onClick: () => app.runAction('view.fit') });
  bar.button({ label: 'Fill Screen', title: 'Fill the window', onClick: () => app.runAction('view.fill') });
}

/** Hand: drag to pan (also available any time by holding Space). */
export class HandTool extends Tool {
  constructor(app) {
    super(app, { id: 'hand', name: 'Hand Tool', key: 'H', cursor: 'grab' });
    this.drag = null;
  }

  onPointerDown(e) {
    const v = this.app.view;
    this.drag = { sx: e.sx, sy: e.sy, panX: v.panX, panY: v.panY };
    this.app.canvas.style.cursor = 'grabbing';
  }

  onPointerMove(e) {
    if (!this.drag) return;
    const v = this.app.view;
    v.panX = this.drag.panX + (e.sx - this.drag.sx);
    v.panY = this.drag.panY + (e.sy - this.drag.sy);
    this.app.viewChanged();
  }

  onPointerUp() {
    this.drag = null;
    this.app.updateCursor();
  }

  cancel() {
    this.drag = null;
  }

  buildOptions(bar) {
    viewButtons(this.app, bar);
  }
}

/** Zoom: click to zoom in, Alt-click to zoom out. */
export class ZoomTool extends Tool {
  constructor(app) {
    super(app, { id: 'zoom', name: 'Zoom Tool', key: 'Z', cursor: 'zoom-in' });
    this.options = { mode: 'in' };
  }

  onActivate() {
    this.cursor = this.options.mode === 'out' ? 'zoom-out' : 'zoom-in';
  }

  onPointerDown(e) {
    const out = (this.options.mode === 'out') !== e.alt;
    this.app.view.zoomStep(out ? -1 : 1, e.sx, e.sy);
    this.app.viewChanged();
  }

  buildOptions(bar) {
    bar.segmented({
      value: this.options.mode,
      options: [
        { value: 'in', icon: 'zoom-in', title: 'Zoom in' },
        { value: 'out', icon: 'zoom-out', title: 'Zoom out (or hold Alt)' },
      ],
      onChange: (v) => {
        this.setOption('mode', v);
        this.onActivate();
        this.app.updateCursor();
      },
    });
    bar.sep();
    viewButtons(this.app, bar);
  }
}
