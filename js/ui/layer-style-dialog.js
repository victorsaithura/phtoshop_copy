import { h, clear } from './dom.js';
import { openModal } from './dialogs.js';
import { paramControls } from './adjust-dialog.js';
import { EFFECTS, effectDefaults } from '../core/effects.js';
import { copyJSON } from '../core/layer.js';

/**
 * Layer ▸ Layer Style: tick effects on the left, adjust the selected one,
 * with a live preview. `focus` opens (and switches on) one effect.
 */
export function layerStyleDialog(app, layer, focus = null) {
  const original = copyJSON(layer.styles);
  const styles = copyJSON(layer.styles) || {};
  if (focus) styles[focus] = { ...effectDefaults(focus), ...styles[focus], enabled: true };
  let frame = 0;
  const update = () => {
    if (!frame) {
      frame = requestAnimationFrame(() => {
        frame = 0;
        app.renderer.request(true);
      });
    }
  };
  layer.styles = styles; // previewed while the dialog is open

  const boxes = {};
  const rows = {};
  const pane = h('div', { class: 'fx-pane' });
  const select = (key) => {
    for (const k in rows) rows[k].classList.toggle('active', k === key);
    if (!styles[key]) styles[key] = { ...effectDefaults(key), enabled: false };
    clear(pane).append(paramControls(EFFECTS[key].params, styles[key], () => {
      // Changing a setting switches the effect on.
      if (!styles[key].enabled) {
        styles[key].enabled = true;
        boxes[key].checked = true;
      }
      update();
    }));
  };
  const list = h('div', { class: 'fx-list', role: 'list' });
  for (const key of Object.keys(EFFECTS)) {
    const box = h('input', { type: 'checkbox', checked: !!styles[key]?.enabled, 'aria-label': EFFECTS[key].title });
    box.addEventListener('change', () => {
      if (!styles[key]) styles[key] = effectDefaults(key);
      styles[key].enabled = box.checked;
      if (box.checked) select(key);
      update();
    });
    boxes[key] = box;
    rows[key] = h('div', { class: 'fx-row', role: 'listitem' }, box,
      h('button', { type: 'button', class: 'fx-name', onClick: () => select(key) }, EFFECTS[key].title));
    list.append(rows[key]);
  }
  select(focus || Object.keys(EFFECTS).find((k) => styles[k]?.enabled) || 'dropShadow');

  let ok = false;
  openModal({
    title: 'Layer Style',
    width: 340,
    side: true,
    body: h('div', { class: 'fx-dialog' }, list, pane),
    buttons: [{ label: 'Cancel' }, { label: 'OK', primary: true, onClick: () => { ok = true; } }],
    onClose: () => {
      cancelAnimationFrame(frame);
      layer.styles = original;
      const kept = Object.fromEntries(Object.entries(styles).filter(([, v]) => v.enabled));
      const final = Object.keys(kept).length ? kept : null;
      if (ok && JSON.stringify(final) !== JSON.stringify(original)) {
        app.transact('Layer Style', { structure: true }, () => { layer.styles = final; });
      } else {
        app.renderer.request(true);
        app.emit('layers');
      }
    },
  });
  update();
}
