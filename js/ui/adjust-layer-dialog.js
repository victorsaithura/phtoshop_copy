import { h } from './dom.js';
import { openModal } from './dialogs.js';
import { levelsUI, curvesUI } from './levels-curves.js';
import { paramControls } from './adjust-dialog.js';
import { ADJUSTMENTS, defaultParams } from '../core/adjustments.js';
import { Layer, copyJSON } from '../core/layer.js';
import { Mask } from '../core/mask.js';

const hasSettings = (def) => !!(def.custom || def.params?.length);

/**
 * Settings dialog for an adjustment layer, previewed live on the canvas.
 * onDone(params) runs on OK; without it the change is recorded as one step.
 */
export function adjustmentLayerDialog(app, layer, { onDone, onCancel } = {}) {
  const doc = app.doc;
  const def = ADJUSTMENTS[layer.adjustment.type];
  if (!hasSettings(def)) {
    app.toast(`${def.title} has no settings.`);
    return;
  }
  const original = copyJSON(layer.adjustment.params);
  const p = layer.adjustment.params; // edited in place while the dialog is open
  let frame = 0;
  const update = () => {
    if (!frame) {
      frame = requestAnimationFrame(() => {
        frame = 0;
        app.renderer.request(true);
      });
    }
  };
  let controls;
  if (def.custom) {
    // Levels and Curves show the histogram of the image below the layer.
    const below = doc.compositeBelow(layer);
    const src = { src: below.getContext('2d').getImageData(0, 0, below.width, below.height), mask: null };
    controls = def.custom === 'levels' ? levelsUI(src, p, update) : curvesUI(src, p, update);
  } else {
    controls = paramControls(def.params, p, update);
  }
  let ok = false;
  openModal({
    title: `${def.title} (Adjustment Layer)`,
    width: def.custom === 'curves' ? 340 : 320,
    side: true,
    body: h('div', {}, controls),
    buttons: [{ label: 'Cancel' }, { label: 'OK', primary: true, onClick: () => { ok = true; } }],
    onClose: () => {
      cancelAnimationFrame(frame);
      const final = copyJSON(p);
      layer.adjustment.params = original;
      if (!ok) {
        onCancel?.();
        app.renderer.request(true);
      } else if (onDone) {
        onDone(final);
      } else if (JSON.stringify(final) !== JSON.stringify(original)) {
        app.transact(`Edit ${def.title} Layer`, { structure: true }, () => { layer.adjustment.params = final; });
      } else {
        app.renderer.request(true);
      }
    },
  });
}

/**
 * Layer ▸ New Adjustment Layer: adds it above the active layer (masked to the
 * selection, if any) and opens its settings. Cancel leaves nothing behind.
 */
export function newAdjustmentLayer(app, type) {
  const doc = app.doc;
  const def = ADJUSTMENTS[type];
  const params = defaultParams(def);
  if (type === 'gradientMap') Object.assign(params, { fg: app.colors.fg, bg: app.colors.bg });
  const n = doc.layers.filter((l) => l.adjustment?.type === type).length + 1;
  const layer = Layer.adjustmentLayer(`${def.title} ${n}`, type, params);
  const sel = doc.selection;
  layer.mask = new Mask(doc.width, doc.height, -layer.x, -layer.y, sel.isEmpty() ? 255 : 0);
  if (!sel.isEmpty()) layer.mask.write(layer, doc.bounds, sel.alpha);
  layer.maskSelected = true;
  const label = `New ${def.title} Layer`;
  if (!hasSettings(def)) {
    app.transact(label, { structure: true }, () => doc.addLayer(layer));
    return;
  }
  // Shown outside the history while the dialog is open; OK records it as one step.
  const saved = { layers: doc.layers.slice(), activeId: doc.activeId };
  doc.addLayer(layer);
  const index = doc.layers.indexOf(layer);
  const parent = layer.parent;
  const unplug = () => {
    doc.layers = saved.layers;
    doc.activeId = saved.activeId;
  };
  app.emit('layers');
  app.renderer.request(true);
  adjustmentLayerDialog(app, layer, {
    onDone: (final) => {
      unplug();
      layer.adjustment.params = final;
      app.transact(label, { structure: true }, () => doc.addLayer(layer, index, parent));
    },
    onCancel: () => {
      unplug();
      app.emit('layers');
    },
  });
}
