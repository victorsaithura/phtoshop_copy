import { h, checkbox } from './dom.js';
import { openModal } from './dialogs.js';
import { COLOR_RANGES, colorRangeAlpha } from '../core/select-ops.js';
import { createCanvas, hexToRgb } from '../core/utils.js';

/**
 * Select ▸ Color Range: pick colours (click the preview; Shift-click adds
 * more) or a colour family or tone range, adjust Fuzziness, and see the
 * selection as a black-and-white preview before applying it.
 */
export function colorRangeDialog(app) {
  const doc = app.doc;
  const full = doc.composite();
  const fullData = full.getContext('2d').getImageData(0, 0, doc.width, doc.height).data;
  const s = Math.min(1, 260 / doc.width, 190 / doc.height);
  const pw = Math.max(1, Math.round(doc.width * s));
  const ph = Math.max(1, Math.round(doc.height * s));
  const small = createCanvas(pw, ph);
  const sctx = small.getContext('2d');
  sctx.imageSmoothingQuality = 'high';
  sctx.drawImage(full, 0, 0, pw, ph);
  const smallData = sctx.getImageData(0, 0, pw, ph).data;

  const fg = hexToRgb(app.colors.fg);
  const settings = { range: 'sampled', samples: [[fg.r, fg.g, fg.b]], fuzziness: 40, invert: false };
  let show = 'selection';

  const preview = h('canvas', { class: 'cr-preview', width: pw, height: ph, title: 'Click to pick a colour; Shift-click adds one' });
  const render = () => {
    const ctx = preview.getContext('2d');
    if (show === 'image') {
      ctx.drawImage(small, 0, 0);
      return;
    }
    const a = colorRangeAlpha(smallData, settings);
    const img = ctx.createImageData(pw, ph);
    for (let p = 0; p < a.length; p++) {
      const i = p * 4;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = a[p];
      img.data[i + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
  };

  const rangeSel = h('select', { 'aria-label': 'Select', value: settings.range },
    COLOR_RANGES.map((c) => h('option', { value: c.value }, c.label)));
  const fuzzNum = h('input', { type: 'number', class: 'num-input', min: 0, max: 200, value: settings.fuzziness, 'aria-label': 'Fuzziness' });
  const fuzzRange = h('input', { type: 'range', class: 'range', min: 0, max: 200, value: settings.fuzziness, 'aria-label': 'Fuzziness' });
  const fuzzRow = h('div', { class: 'adjust-row' },
    h('div', { class: 'adjust-label' }, h('span', {}, 'Fuzziness'), fuzzNum), fuzzRange);
  const syncRange = () => { fuzzRow.hidden = settings.range !== 'sampled'; };
  rangeSel.addEventListener('change', () => {
    settings.range = rangeSel.value;
    syncRange();
    render();
  });
  const setFuzz = (v) => {
    settings.fuzziness = Math.min(200, Math.max(0, Number(v) || 0));
    fuzzNum.value = settings.fuzziness;
    fuzzRange.value = settings.fuzziness;
    render();
  };
  fuzzRange.addEventListener('input', () => setFuzz(fuzzRange.value));
  fuzzNum.addEventListener('change', () => setFuzz(fuzzNum.value));

  preview.addEventListener('click', (e) => {
    const r = preview.getBoundingClientRect();
    const x = Math.min(doc.width - 1, Math.max(0, Math.floor(((e.clientX - r.left) / r.width) * doc.width)));
    const y = Math.min(doc.height - 1, Math.max(0, Math.floor(((e.clientY - r.top) / r.height) * doc.height)));
    const i = (y * doc.width + x) * 4;
    const color = [fullData[i], fullData[i + 1], fullData[i + 2]];
    settings.samples = e.shiftKey && settings.range === 'sampled' ? [...settings.samples, color] : [color];
    settings.range = 'sampled';
    rangeSel.value = 'sampled';
    syncRange();
    render();
  });

  const showSel = h('select', { 'aria-label': 'Preview', value: show },
    h('option', { value: 'selection' }, 'Selection'), h('option', { value: 'image' }, 'Image'));
  showSel.addEventListener('change', () => {
    show = showSel.value;
    render();
  });

  let ok = false;
  openModal({
    title: 'Color Range',
    width: 320,
    body: h('div', { class: 'adjust-controls' },
      h('label', { class: 'adjust-inline' }, 'Select', rangeSel),
      fuzzRow,
      h('div', { class: 'cr-preview-wrap' }, preview),
      h('label', { class: 'adjust-inline' }, 'Preview', showSel),
      checkbox({ label: 'Invert', checked: false, onChange: (v) => { settings.invert = v; render(); } }),
      h('p', { class: 'recover-hint' }, 'Click the preview to pick a colour; Shift-click adds more.')),
    buttons: [{ label: 'Cancel' }, { label: 'OK', primary: true, onClick: () => { ok = true; } }],
    onClose: () => {
      if (!ok) return;
      const alpha = colorRangeAlpha(fullData, settings);
      app.transact('Color Range', { selection: true }, () => doc.selection.fromAlpha(alpha));
      if (doc.selection.isEmpty()) app.toast('No pixels matched, so nothing is selected.');
    },
  });
  syncRange();
  render();
}
