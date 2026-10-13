import { clamp } from './utils.js';

// Photoshop's zoom presets.
export const ZOOM_STEPS = [
  0.01, 0.02, 0.03, 0.04, 0.05, 0.0625, 0.0833, 0.125, 0.1667, 0.25, 0.3333, 0.5, 0.6667,
  1, 1.5, 2, 3, 4, 5, 6, 7, 8, 12, 16, 24, 32,
];
export const MIN_ZOOM = 0.01;
export const MAX_ZOOM = 32;

/** Maps document coordinates to screen (CSS pixel) coordinates. */
export class Viewport {
  constructor() {
    this.zoom = 1;
    this.panX = 0;
    this.panY = 0;
    this.width = 0;
    this.height = 0;
  }

  docToScreen(x, y) {
    return { x: this.panX + x * this.zoom, y: this.panY + y * this.zoom };
  }

  screenToDoc(sx, sy) {
    return { x: (sx - this.panX) / this.zoom, y: (sy - this.panY) / this.zoom };
  }

  /** Zoom keeping the document point under (ax, ay) fixed on screen. */
  setZoom(z, ax = this.width / 2, ay = this.height / 2) {
    const d = this.screenToDoc(ax, ay);
    this.zoom = clamp(z, MIN_ZOOM, MAX_ZOOM);
    this.panX = ax - d.x * this.zoom;
    this.panY = ay - d.y * this.zoom;
  }

  zoomStep(dir, ax, ay) {
    const z = this.zoom;
    let next;
    if (dir > 0) next = ZOOM_STEPS.find((s) => s > z * 1.001) ?? MAX_ZOOM;
    else next = [...ZOOM_STEPS].reverse().find((s) => s < z * 0.999) ?? MIN_ZOOM;
    this.setZoom(next, ax, ay);
  }

  center(docW, docH) {
    this.panX = Math.round((this.width - docW * this.zoom) / 2);
    this.panY = Math.round((this.height - docH * this.zoom) / 2);
  }

  /** Fit the document in the view. Never upscales unless allowUpscale. */
  fit(docW, docH, allowUpscale = false, margin = 24) {
    const availW = Math.max(40, this.width - margin * 2);
    const availH = Math.max(40, this.height - margin * 2);
    let z = Math.min(availW / docW, availH / docH);
    if (!allowUpscale) z = Math.min(z, 1);
    this.zoom = clamp(z, MIN_ZOOM, MAX_ZOOM);
    this.center(docW, docH);
  }

  /** Fill the view with the document (may crop edges). */
  fill(docW, docH) {
    this.zoom = clamp(Math.max(this.width / docW, this.height / docH), MIN_ZOOM, MAX_ZOOM);
    this.center(docW, docH);
  }

  /** Called when the workspace changes size; keeps the view centred on the same point. */
  resize(w, h) {
    if (this.width && this.height) {
      const c = this.screenToDoc(this.width / 2, this.height / 2);
      this.panX = w / 2 - c.x * this.zoom;
      this.panY = h / 2 - c.y * this.zoom;
    }
    this.width = w;
    this.height = h;
  }

  save() {
    return { zoom: this.zoom, panX: this.panX, panY: this.panY };
  }

  load(state) {
    Object.assign(this, state);
  }
}
