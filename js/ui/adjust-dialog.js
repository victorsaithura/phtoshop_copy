import { h, checkbox } from './dom.js';
import { openModal } from './dialogs.js';
import { levelsUI, curvesUI } from './levels-curves.js';
import { LiveEdit } from '../core/live-edit.js';
import { defaultParams } from '../core/adjustments.js';
import { clamp } from '../core/utils.js';

const lastParams = new Map(); // remembered settings per command for this session

/** Margin for the largest values a dialog can reach, so the read area never needs to grow. */
function maxMargin(def) {
  if (!def.margin) return 0;
  const p = {};
  for (const c of def.params || []) if (c.key) p[c.key] = c.max ?? c.value;
  return def.margin(p);
}

/** Build slider / checkbox / select / colour rows bound to `p`. */
export function paramControls(controls, p, onChange) {
  const wrap = h('div', { class: 'adjust-controls' });
  for (const c of controls) {
    if (c.type === 'heading') {
      wrap.append(h('div', { class: 'adjust-heading' }, c.label));
    } else if (c.type === 'checkbox') {
      wrap.append(checkbox({ label: c.label, checked: p[c.key], onChange: (v) => { p[c.key] = v; onChange(); } }));
    } else if (c.type === 'select') {
      const sel = h('select', { value: p[c.key] }, c.options.map((o) => h('option', { value: o.value }, o.label)));
      sel.addEventListener('change', () => { p[c.key] = sel.value; onChange(); });
      wrap.append(h('label', { class: 'adjust-inline' }, c.label, sel));
    } else if (c.type === 'color') {
      const input = h('input', { type: 'color', value: p[c.key] });
      input.addEventListener('input', () => { p[c.key] = input.value; onChange(); });
      wrap.append(h('label', { class: 'adjust-inline' }, c.label, input));
    } else {
      const step = c.step || 1;
      const num = h('input', { type: 'number', class: 'num-input', min: c.min, max: c.max, step, value: p[c.key], 'aria-label': c.label });
      const range = h('input', { type: 'range', class: 'range', min: c.min, max: c.max, step, value: p[c.key], 'aria-label': c.label });
      range.addEventListener('input', () => {
        num.value = range.value;
        p[c.key] = Number(range.value);
        onChange();
      });
      num.addEventListener('change', () => {
        const v = clamp(Number(num.value) || 0, c.min, c.max);
        num.value = v;
        range.value = v;
        p[c.key] = v;
        onChange();
      });
      wrap.append(h('div', { class: 'adjust-row' },
        h('div', { class: 'adjust-label' }, h('span', {}, c.label),
          h('span', { class: 'adjust-value' }, num, c.unit ? h('span', { class: 'opt-unit' }, c.unit) : null)),
        range));
    }
  }
  return wrap;
}

/**
 * Run an adjustment or filter on the active layer. Commands without settings
 * (or called with `params`, e.g. Last Filter) apply at once; the rest open a
 * dialog with a live preview.
 */
export function runPixelCommand(app, def, { id, params = null, onApplied } = {}) {
  const label = def.title;
  const interactive = !params && (def.custom || def.params?.length);
  if (!interactive) {
    const p = params || defaultParams(def);
    const edit = LiveEdit.start(app, label.toLowerCase(), def.margin ? def.margin(p) : 0);
    if (!edit) return;
    edit.compute((img, ctx) => def.apply(img, p, ctx));
    edit.commit(label);
    onApplied?.(p);
    return;
  }

  const edit = LiveEdit.start(app, label.toLowerCase(), maxMargin(def));
  if (!edit) return;
  const p = structuredClone(lastParams.get(id) || defaultParams(def));
  let previewOn = true;
  let frame = 0;
  const render = () => {
    frame = 0;
    edit.compute((img, ctx) => def.apply(img, p, ctx));
    if (previewOn) edit.show();
  };
  const update = () => {
    if (!frame) frame = requestAnimationFrame(render);
  };

  let controls;
  if (def.custom === 'levels') controls = levelsUI(edit, p, update);
  else if (def.custom === 'curves') controls = curvesUI(edit, p, update);
  else controls = paramControls(def.params, p, update);

  const preview = checkbox({
    label: 'Preview',
    checked: true,
    onChange: (v) => {
      previewOn = v;
      if (v) update();
      else edit.hide();
    },
  });

  openModal({
    title: def.title,
    width: def.custom === 'curves' ? 340 : 320,
    side: true,
    body: h('div', {}, controls, h('div', { class: 'adjust-footer' }, preview)),
    buttons: [
      { label: 'Cancel' },
      {
        label: 'OK',
        primary: true,
        onClick: () => {
          cancelAnimationFrame(frame);
          frame = 0;
          edit.compute((img, ctx) => def.apply(img, p, ctx));
          edit.commit(label);
          lastParams.set(id, structuredClone(p));
          onApplied?.(p);
        },
      },
    ],
    onClose: () => {
      cancelAnimationFrame(frame);
      edit.hide();
    },
  });
  update();
}
