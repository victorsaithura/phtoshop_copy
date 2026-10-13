import { Layer, copyJSON } from './core/layer.js';
import { ADJUSTMENTS, ADJUSTMENT_LAYER_TYPES } from './core/adjustments.js';
import { EFFECTS, hasStyles } from './core/effects.js';
import { newAdjustmentLayer, adjustmentLayerDialog } from './ui/adjust-layer-dialog.js';
import { layerStyleDialog } from './ui/layer-style-dialog.js';

/** Layer groups, adjustment layers and layer styles, added to the action map `A`. */
export function registerLayerActions(app, A) {
  const def = (id, label, run, opts = {}) => {
    A[id] = { id, label, run, ...opts, keys: opts.keys || (opts.shortcut ? [opts.shortcut] : []) };
  };
  const doc = () => app.doc;
  const hasDoc = () => !!app.doc;
  const active = () => app.doc?.activeLayer || null;
  const isGroup = () => !!active()?.isGroup;
  const isPixel = () => !!active()?.isPixel;

  /* ---------- Groups ---------- */

  def('layer.newGroup', 'New Group', () => {
    const d = doc();
    app.transact('New Group', { structure: true }, () => d.addLayer(Layer.group(d.nextGroupName())));
  }, { enabled: hasDoc });

  def('layer.group', 'Group Layers', () => {
    const d = doc();
    const item = d.activeLayer;
    app.transact('Group Layers', { structure: true }, () => {
      const g = Layer.group(d.nextGroupName());
      g.parent = item.parent;
      d.layers.splice(d.span(item)[1] + 1, 0, g);
      item.parent = g;
      d.setActive(g);
    });
  }, { enabled: () => !!active(), shortcut: 'Ctrl+G' });

  def('layer.ungroup', 'Ungroup Layers', () => {
    const d = doc();
    const g = d.activeLayer;
    app.transact('Ungroup Layers', { structure: true }, () => {
      const kids = d.childrenOf(g);
      if (!kids.length) {
        d.removeLayer(g);
        return;
      }
      for (const k of kids) k.parent = g.parent;
      d.layers.splice(d.layers.indexOf(g), 1);
      d.setActive(kids[kids.length - 1]);
    });
  }, { enabled: isGroup, shortcut: 'Ctrl+Shift+G' });

  /* ---------- Adjustment layers ---------- */

  for (const type of ADJUSTMENT_LAYER_TYPES) {
    const a = ADJUSTMENTS[type];
    def(`layer.adjust.${type}`, a.title + (a.custom || a.params?.length ? '…' : ''), () => newAdjustmentLayer(app, type),
      { enabled: hasDoc });
  }
  def('layer.adjustmentOptions', 'Adjustment Layer Options…', () => adjustmentLayerDialog(app, active()),
    { enabled: () => !!active()?.isAdjustment });

  /* ---------- Layer styles ---------- */

  const openStyle = (focus) => () => layerStyleDialog(app, active(), focus);
  def('layer.style.open', 'Layer Style…', openStyle(null), { enabled: isPixel });
  for (const key of Object.keys(EFFECTS)) {
    def(`layer.style.${key}`, `${EFFECTS[key].title}…`, openStyle(key), { enabled: isPixel });
  }
  def('layer.style.copy', 'Copy Layer Style', () => { app.styleClipboard = copyJSON(active().styles); },
    { enabled: () => !!active() && hasStyles(active()) });
  def('layer.style.paste', 'Paste Layer Style', () => {
    const l = active();
    const styles = copyJSON(app.styleClipboard);
    app.transact('Paste Layer Style', { structure: true }, () => { l.styles = styles; });
  }, { enabled: () => isPixel() && !!app.styleClipboard });
  def('layer.style.clear', 'Clear Layer Style', () => {
    const l = active();
    app.transact('Clear Layer Style', { structure: true }, () => { l.styles = null; });
  }, { enabled: () => !!active() && hasStyles(active()) });
}
