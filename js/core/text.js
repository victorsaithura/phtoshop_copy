import { createCanvas } from './utils.js';

export const FONTS = [
  'Arial', 'Helvetica', 'Verdana', 'Tahoma', 'Trebuchet MS', 'Segoe UI', 'Georgia', 'Times New Roman',
  'Garamond', 'Courier New', 'Impact', 'Comic Sans MS', 'system-ui', 'serif', 'sans-serif', 'monospace',
];

export const TEXT_DEFAULTS = {
  content: '',
  font: 'Arial',
  size: 48,
  color: '#000000',
  bold: false,
  italic: false,
  align: 'left',
};

const GENERIC = new Set(['serif', 'sans-serif', 'monospace', 'cursive', 'fantasy', 'system-ui']);

/** CSS / canvas font shorthand for text settings (sizes in document pixels × scale). */
export function cssFont(t, scale = 1) {
  const family = GENERIC.has(t.font) ? t.font : `"${t.font}", sans-serif`;
  return `${t.italic ? 'italic ' : ''}${t.bold ? 'bold ' : ''}${Math.max(1, t.size * scale)}px ${family}`;
}

export const lineHeight = (t) => Math.round(t.size * 1.25);
export const textPadding = (t) => Math.ceil(t.size * 0.25);

/**
 * Render a text layer's canvas from layer.text. Keeps the text box anchored:
 * left-aligned text keeps its left edge, centred text its centre and
 * right-aligned text its right edge.
 */
export function renderText(layer, keepAnchor = true) {
  const t = layer.text;
  const lines = (t.content || '').split('\n');
  const measure = createCanvas(1, 1).getContext('2d');
  measure.font = cssFont(t);
  const widths = lines.map((l) => measure.measureText(l).width);
  const maxW = Math.max(1, ...widths);
  const pad = textPadding(t);
  const lh = lineHeight(t);
  const w = Math.ceil(maxW) + pad * 2;
  const h = lh * lines.length + pad * 2;

  const c = createCanvas(w, h);
  const ctx = c.getContext('2d');
  ctx.font = cssFont(t);
  ctx.fillStyle = t.color;
  ctx.textBaseline = 'middle';
  ctx.textAlign = t.align;
  const x = t.align === 'center' ? pad + maxW / 2 : t.align === 'right' ? pad + maxW : pad;
  lines.forEach((line, i) => ctx.fillText(line, x, pad + i * lh + lh / 2));

  if (keepAnchor && layer.canvas) {
    const oldW = layer.canvas.width;
    if (t.align === 'center') layer.x = Math.round(layer.x + (oldW - w) / 2);
    else if (t.align === 'right') layer.x = Math.round(layer.x + oldW - w);
  }
  layer.canvas = c;
  layer.touch();
}
