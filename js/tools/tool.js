/**
 * Base class for tools. Pointer events carry document coordinates (x, y),
 * screen coordinates (sx, sy), pressure and modifier flags.
 */
export class Tool {
  constructor(app, { id, name, key = '', icon = id, cursor = 'default' } = {}) {
    this.app = app;
    this.id = id;
    this.name = name;
    this.key = key;
    this.icon = icon;
    this.cursor = cursor;
    this.options = {};
    this.altEyedropper = false; // Alt-click samples a colour (painting tools)
    this.wantsCoalesced = false; // receive every pointer sample (smooth strokes)
  }

  get doc() { return this.app.doc; }

  setOption(key, value, notify = false) {
    this.app.setToolOption(this, key, value, notify);
  }

  onActivate() {}
  onDeactivate() {}
  onPointerDown() {}
  onPointerMove() {}
  onPointerUp() {}
  onHover() {}
  /** Return true if the key was handled. */
  onKeyDown() { return false; }
  /** Abort an in-progress operation without committing it. */
  cancel() {}
  /** Draw on-canvas overlays (screen coordinates, CSS pixels). */
  drawOverlay() {}
  /** Return { canvas, x, y } to draw in place of a layer (live preview). */
  layerOverride() { return null; }
  /** Populate the options bar. */
  buildOptions() {}
}

/** Two-tone outline that stays visible on any background. */
export function strokeOutline(ctx, buildPath, dashed = false) {
  ctx.save();
  ctx.beginPath();
  buildPath(ctx);
  if (dashed) {
    ctx.lineWidth = 1;
    ctx.strokeStyle = '#ffffff';
    ctx.stroke();
    ctx.setLineDash([4, 4]);
    ctx.strokeStyle = '#000000';
    ctx.stroke();
  } else {
    ctx.lineWidth = 3;
    ctx.strokeStyle = 'rgba(0,0,0,0.45)';
    ctx.stroke();
    ctx.lineWidth = 1;
    ctx.strokeStyle = 'rgba(255,255,255,0.95)';
    ctx.stroke();
  }
  ctx.restore();
}

/**
 * Double-click detection for tools: two quick presses on the same spot with
 * no drag in between (a handle drag followed by a quick press is not one).
 */
export class DoubleClick {
  constructor(ms = 350, px = 5) {
    this.ms = ms;
    this.px = px;
    this.last = null;
  }

  /** Call on pointerdown; returns true when this press completes a double-click. */
  down(e) {
    const now = performance.now();
    const l = this.last;
    const hit = !!l && !l.moved && now - l.t < this.ms && Math.hypot(e.sx - l.sx, e.sy - l.sy) <= this.px;
    this.last = hit ? null : { t: now, sx: e.sx, sy: e.sy, moved: false };
    return hit;
  }

  /** Call on pointermove while pressed. */
  move(e) {
    const l = this.last;
    if (l && !l.moved && Math.hypot(e.sx - l.sx, e.sy - l.sy) > this.px) l.moved = true;
  }
}
