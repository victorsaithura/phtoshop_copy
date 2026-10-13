import { Layer, PASS_THROUGH } from './core/layer.js';
import { cloneLayers } from './core/document.js';
import { applyAdjustmentLayer } from './core/adjustments.js';
import { hasStyles, rasterizeStyled } from './core/effects.js';
import { createCanvas, downloadBlob } from './core/utils.js';
import {
  openFiles, pickFiles, placeFiles, pasteImage, pasteInternal, copyToSystemClipboard, exportDocument, loadImage,
} from './io.js';
import { newDocumentDialog, exportDialog, fillDialog } from './ui/doc-dialogs.js';
import { confirmDialog, promptDialog, shortcutsDialog, aboutDialog } from './ui/dialogs.js';
import { editMask, editingMask, maskValue } from './actions-mask.js';
import { maskedPixels } from './core/mask.js';
import { saveProject } from './project.js';
import { writePSD } from './psd.js';

/**
 * Every menu command, keyed by id. Each action has a label, run(), optional
 * enabled(), a displayed shortcut and the key combos that trigger it.
 */
export function createActions(app, getMenus) {
  const A = {};
  const def = (id, label, run, opts = {}) => {
    A[id] = { id, label, run, ...opts, keys: opts.keys || (opts.shortcut ? [opts.shortcut] : []) };
  };

  const doc = () => app.doc;
  const hasDoc = () => !!app.doc;
  const hasSel = () => !!app.doc && !app.doc.selection.isEmpty();
  const multiLayer = () => !!app.doc && app.doc.layers.length > 1;
  const pixelLayer = () => !!app.doc?.activeLayer?.isPixel;
  // Deleting must leave at least one layer.
  const canDelete = () => {
    const d = app.doc;
    if (!d?.activeLayer) return false;
    const [s, e] = d.span(d.activeLayer);
    return d.layers.length - (e - s + 1) >= 1;
  };
  const notPixels = (what) => app.toast(`Could not ${what} because the target is not a pixel layer.`);

  /* ---------- Pixel helpers ---------- */

  /** Selected pixels of the active layer (or the merged image), clipped to the canvas. */
  function copyPixels(merged) {
    const d = doc();
    const sel = d.selection;
    const area = sel.isEmpty() ? d.bounds : sel.bounds;
    let src;
    if (merged) src = { canvas: d.composite(), x: 0, y: 0 };
    else src = d.activeLayer;
    const out = createCanvas(area.w, area.h);
    const c = out.getContext('2d');
    c.drawImage(src.canvas, src.x - area.x, src.y - area.y);
    if (!sel.isEmpty()) {
      c.globalCompositeOperation = 'destination-in';
      c.drawImage(sel.mask, -area.x, -area.y);
    }
    return { canvas: out, x: area.x, y: area.y };
  }

  function copy(merged) {
    if (!merged && !doc().activeLayer?.isPixel) return notPixels('copy');
    const data = copyPixels(merged);
    const entry = { ...data, docId: doc().id, systemCopied: false };
    app.clipboard = entry;
    copyToSystemClipboard(data.canvas).then((ok) => { entry.systemCopied = ok; });
  }

  function clearSelected(layer, label = 'Clear') {
    const sel = doc().selection;
    app.transact(label, { layers: [{ layer, rect: sel.bounds }] }, () => {
      const c = layer.ctx;
      c.save();
      c.globalCompositeOperation = 'destination-out';
      c.drawImage(sel.mask, -layer.x, -layer.y);
      c.restore();
    });
  }

  function fill(color, opacity = 1, mode = 'source-over', label = 'Fill') {
    const d = doc();
    const layer = app.editableLayer('fill command', { allowMask: true });
    if (!layer) return;
    const sel = d.selection;
    if (editingMask(app)) {
      const v = maskValue(color);
      editMask(app, label, sel.isEmpty() ? d.bounds : sel.bounds, (old) => old + (v - old) * opacity);
      return;
    }
    const rect = sel.isEmpty() ? d.bounds : sel.bounds;
    const f = createCanvas(rect.w, rect.h);
    const c = f.getContext('2d');
    c.fillStyle = color;
    c.fillRect(0, 0, rect.w, rect.h);
    if (!sel.isEmpty()) {
      c.globalCompositeOperation = 'destination-in';
      c.drawImage(sel.mask, -rect.x, -rect.y);
    }
    layer.ensureCovers(rect);
    app.transact(label, { layers: [{ layer, rect }] }, () => {
      const lc = layer.ctx;
      lc.save();
      lc.globalAlpha = opacity;
      lc.globalCompositeOperation = mode;
      lc.drawImage(f, rect.x - layer.x, rect.y - layer.y);
      lc.restore();
    });
  }

  async function confirmDiscard(session = app.session) {
    if (!session || !session.history.dirty) return true;
    return confirmDialog({
      title: 'Close document',
      message: `Discard your changes to “${session.doc.name}”? Save it first (Ctrl+S) if you want to keep them.`,
      okLabel: 'Discard changes',
    });
  }

  /* ---------- File ---------- */

  def('file.new', 'New…', () => newDocumentDialog(app), { shortcut: 'Ctrl+Alt+N' });
  def('file.open', 'Open…', async () => openFiles(app, await pickFiles({ multiple: true })), { shortcut: 'Ctrl+O' });
  def('file.place', 'Place Image as Layer…', async () => placeFiles(app, await pickFiles({ multiple: true })),
    { enabled: hasDoc });
  const baseName = () => doc().name.replace(/\.[a-z0-9]+$/i, '');
  const save = (name) => {
    try {
      saveProject(doc(), name);
      app.history.markSaved();
      app.toast(`Saved ${name}.pfp — open it again with File ▸ Open.`);
    } catch (err) {
      app.toast(`Could not save: ${err.message}`);
    }
  };
  def('file.save', 'Save', () => save(baseName()), { enabled: hasDoc, shortcut: 'Ctrl+S' });
  def('file.saveAs', 'Save As…', async () => {
    const name = await promptDialog({ title: 'Save As', label: 'File name', value: baseName() });
    if (!name) return;
    doc().name = `${name}.pfp`;
    app.emit('document');
    save(name);
  }, { enabled: hasDoc, shortcut: 'Ctrl+Shift+S' });
  def('file.savePSD', 'Save as Photoshop (.psd)…', async () => {
    const name = await promptDialog({ title: 'Save as Photoshop document', label: 'File name', value: baseName() });
    if (!name) return;
    try {
      const d = doc();
      downloadBlob(new Blob([writePSD(d)], { type: 'image/vnd.adobe.photoshop' }), `${name}.psd`);
      const baked = [];
      if (d.layers.some((l) => l.text)) baked.push('type is rasterized');
      if (d.layers.some((l) => hasStyles(l))) baked.push('layer styles are merged into their layers');
      if (d.layers.some((l) => l.isAdjustment)) baked.push('adjustment layers are saved as merged pixels');
      app.toast(`Saved ${name}.psd${baked.length ? ` (${baked.join('; ')}). Save as .pfp to keep everything editable` : ''}.`);
    } catch (err) {
      app.toast(`Could not save: ${err.message}`);
    }
  }, { enabled: hasDoc });
  def('file.export', 'Export As…', () => exportDialog(app),
    { enabled: hasDoc, shortcut: 'Ctrl+Alt+Shift+W' });
  def('file.quickExport', 'Quick Export as PNG', () => {
    exportDocument(doc(), { format: 'png', filename: doc().name.replace(/\.[a-z0-9]+$/i, '') })
      .catch((err) => app.toast(`Export failed: ${err.message}`));
  }, { enabled: hasDoc });
  def('file.close', 'Close', async () => {
    if (await confirmDiscard()) app.closeDocument();
  }, { enabled: hasDoc });
  app.confirmDiscard = confirmDiscard;

  /* ---------- Edit ---------- */

  def('edit.undo', 'Undo', () => app.undo(), {
    enabled: () => app.history.canUndo,
    dynamicLabel: () => (app.history.canUndo ? `Undo ${app.history.undoLabel}` : 'Undo'),
    shortcut: 'Ctrl+Z',
  });
  def('edit.redo', 'Redo', () => app.redo(), {
    enabled: () => app.history.canRedo,
    dynamicLabel: () => (app.history.canRedo ? `Redo ${app.history.redoLabel}` : 'Redo'),
    shortcut: 'Ctrl+Shift+Z', keys: ['Ctrl+Shift+Z', 'Ctrl+Y'],
  });
  def('edit.cut', 'Cut', () => {
    const layer = app.editableLayer('cut command');
    if (!layer) return;
    copy(false);
    clearSelected(layer, 'Cut');
  }, { enabled: hasSel, shortcut: 'Ctrl+X' });
  def('edit.copy', 'Copy', () => copy(false), { enabled: hasDoc, shortcut: 'Ctrl+C' });
  def('edit.copyMerged', 'Copy Merged', () => copy(true), { enabled: hasDoc, shortcut: 'Ctrl+Shift+C' });
  // Ctrl+V is left to the browser so the paste event can read system images (see io.js).
  // From the menu, our own clipboard wins; otherwise try the system clipboard briefly
  // (some browsers ask the user first, so don't wait forever).
  def('edit.paste', 'Paste', async () => {
    if (app.clipboard) {
      pasteInternal(app);
      return;
    }
    try {
      const timeout = new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 1500));
      const items = await Promise.race([navigator.clipboard.read(), timeout]);
      for (const item of items) {
        const type = item.types.find((t) => t.startsWith('image/'));
        if (!type) continue;
        const canvas = await loadImage(await item.getType(type));
        if (app.doc) pasteImage(app, canvas);
        return;
      }
    } catch {
      /* clipboard unavailable or not permitted */
    }
    app.toast('Nothing to paste. Copy something first, or press Ctrl+V to paste an image from another app.');
  }, { enabled: hasDoc, shortcut: 'Ctrl+V', keys: [] });
  def('edit.clear', 'Clear', () => {
    if (editingMask(app)) {
      // On a mask: hide the selected area, or remove the mask when nothing is selected.
      if (hasSel()) editMask(app, 'Clear', doc().selection.bounds, () => 0);
      else A['mask.delete'].run();
      return;
    }
    if (!hasSel()) {
      if (canDelete()) A['layer.delete'].run();
      return;
    }
    const layer = app.editableLayer('clear command');
    if (layer) clearSelected(layer);
  }, { enabled: hasDoc, shortcut: 'Delete', keys: ['Delete', 'Backspace'] });
  def('edit.freeTransform', 'Free Transform', () => {
    const tool = app.tools.get('transform');
    if (app.tool === tool) return;
    if (tool.start(app.tool?.id)) app.setTool('transform');
  }, { enabled: hasDoc, shortcut: 'Ctrl+T', keys: ['Ctrl+T', 'Ctrl+Alt+T'] });
  def('edit.fill', 'Fill…', () => fillDialog(app, (color, opacity, mode) => fill(color, opacity, mode)),
    { enabled: hasDoc, shortcut: 'Shift+F5', keys: ['Shift+F5', 'Shift+Backspace'] });
  def('edit.fillFg', 'Fill with Foreground Color', () => fill(app.colors.fg),
    { enabled: hasDoc, shortcut: 'Alt+Backspace', keys: ['Alt+Backspace', 'Alt+Delete'] });
  def('edit.fillBg', 'Fill with Background Color', () => fill(app.colors.bg),
    { enabled: hasDoc, shortcut: 'Ctrl+Backspace', keys: ['Ctrl+Backspace', 'Ctrl+Delete'] });

  /* ---------- Layer ---------- */

  def('layer.new', 'New Layer', () => app.transact('New Layer', { structure: true }, () => doc().newLayer()),
    { enabled: hasDoc, shortcut: 'Ctrl+Alt+Shift+N' });
  def('layer.duplicate', 'Duplicate Layer', () => {
    const d = doc();
    const layer = d.activeLayer;
    if (!layer.isGroup) {
      app.transact('Duplicate Layer', { structure: true }, () => d.addLayer(layer.clone()));
      return;
    }
    // A group is copied with everything in it, just above the original.
    app.transact('Duplicate Group', { structure: true }, () => {
      const [s, e] = d.span(layer);
      const copies = cloneLayers(d.layers.slice(s, e + 1), (l) => (l === layer ? `${l.name} copy` : l.name));
      const top = copies[copies.length - 1];
      top.parent = layer.parent;
      d.layers.splice(e + 1, 0, ...copies);
      d.setActive(top);
    });
  }, { enabled: hasDoc, dynamicLabel: () => (doc()?.activeLayer?.isGroup ? 'Duplicate Group' : 'Duplicate Layer') });

  const layerVia = (cut) => {
    const d = doc();
    if (!hasSel()) {
      if (!cut) A['layer.duplicate'].run();
      return;
    }
    const layer = d.activeLayer;
    if (!layer.isPixel) return notPixels(cut ? 'cut' : 'copy');
    if (cut && !app.editableLayer('cut command')) return;
    const data = copyPixels(false);
    const spec = { structure: true };
    if (cut) spec.layers = [{ layer, rect: d.selection.bounds }];
    app.transact(cut ? 'Layer via Cut' : 'Layer via Copy', spec, () => {
      if (cut) {
        const c = layer.ctx;
        c.save();
        c.globalCompositeOperation = 'destination-out';
        c.drawImage(d.selection.mask, -layer.x, -layer.y);
        c.restore();
      }
      d.addLayer(new Layer({ name: d.nextLayerName(), canvas: data.canvas, x: data.x, y: data.y }));
    });
  };
  def('layer.viaCopy', 'Layer via Copy', () => layerVia(false), { enabled: hasDoc, shortcut: 'Ctrl+J' });
  def('layer.viaCut', 'Layer via Cut', () => layerVia(true), { enabled: hasSel, shortcut: 'Ctrl+Shift+J' });
  def('layer.delete', 'Delete Layer', () => {
    const d = doc();
    const label = d.activeLayer.isGroup ? 'Delete Group' : 'Delete Layer';
    app.transact(label, { structure: true }, () => d.removeLayer(d.activeLayer));
  }, { enabled: canDelete, dynamicLabel: () => (doc()?.activeLayer?.isGroup ? 'Delete Group' : 'Delete Layer') });
  def('layer.rename', 'Rename Layer…', async () => {
    const layer = doc().activeLayer;
    const name = await promptDialog({ title: 'Rename Layer', label: 'Name', value: layer.name });
    if (name && name !== layer.name) {
      app.transact('Rename Layer', { structure: true }, () => { layer.name = name; });
    }
  }, { enabled: hasDoc });
  def('layer.lock', 'Lock Layer', () => {
    const layer = doc().activeLayer;
    app.transact(layer.locked ? 'Unlock Layer' : 'Lock Layer', { structure: true }, () => { layer.locked = !layer.locked; });
  }, {
    enabled: hasDoc, shortcut: 'Ctrl+/',
    dynamicLabel: () => (doc()?.activeLayer?.locked ? 'Unlock Layer' : 'Lock Layer'),
  });
  def('layer.hide', 'Hide Layer', () => {
    const layer = doc().activeLayer;
    app.transact(layer.visible ? 'Hide Layer' : 'Show Layer', { structure: true }, () => { layer.visible = !layer.visible; });
  }, {
    enabled: hasDoc, shortcut: 'Ctrl+,',
    dynamicLabel: () => (doc()?.activeLayer?.visible === false ? 'Show Layer' : 'Hide Layer'),
  });

  def('layer.rasterize', 'Rasterize Type', () => {
    const layer = doc().activeLayer;
    app.transact('Rasterize Type', { layers: [layer] }, () => { layer.text = null; });
  }, { enabled: () => !!app.doc?.activeLayer?.text });

  // Arranging moves a layer among the others in its group.
  const arrange = (label, step) => () => {
    const d = doc();
    const layer = d.activeLayer;
    const sibs = d.childrenOf(layer.parent);
    const i = sibs.indexOf(layer);
    if ((step > 0 && i === sibs.length - 1) || (step < 0 && i === 0)) return;
    app.transact(label, { structure: true }, () => d.arrange(layer, step));
  };
  const hasSiblings = () => !!app.doc?.activeLayer && app.doc.childrenOf(app.doc.activeLayer.parent).length > 1;
  def('layer.front', 'Bring to Front', arrange('Bring to Front', Infinity), { enabled: hasSiblings, shortcut: 'Ctrl+Shift+]' });
  def('layer.forward', 'Bring Forward', arrange('Bring Forward', 1), { enabled: hasSiblings, shortcut: 'Ctrl+]' });
  def('layer.backward', 'Send Backward', arrange('Send Backward', -1), { enabled: hasSiblings, shortcut: 'Ctrl+[' });
  def('layer.back', 'Send to Back', arrange('Send to Back', -Infinity), { enabled: hasSiblings, shortcut: 'Ctrl+Shift+[' });

  // Steps through the rows shown in the Layers panel (contents of closed groups are skipped).
  const selectNeighbour = (dir) => () => {
    const d = doc();
    const shown = d.layers.filter((l) => {
      for (let p = l.parent; p; p = p.parent) if (p.collapsed) return false;
      return true;
    });
    const next = shown[shown.indexOf(d.activeLayer) + dir];
    if (next) {
      d.setActive(next);
      app.emit('layers');
    }
  };
  def('layer.selectUp', 'Select Layer Above', selectNeighbour(1), { enabled: multiLayer, shortcut: 'Alt+]' });
  def('layer.selectDown', 'Select Layer Below', selectNeighbour(-1), { enabled: multiLayer, shortcut: 'Alt+[' });

  /** Bake a layer's mask and effects into its pixels. */
  const bake = (layer) => {
    if (hasStyles(layer)) {
      const r = rasterizeStyled(layer);
      Object.assign(layer, { canvas: r.canvas, x: r.x, y: r.y, styles: null, mask: null, maskSelected: false });
    } else if (layer.mask) {
      if (layer.mask.enabled) layer.canvas = maskedPixels(layer);
      layer.mask = null;
      layer.maskSelected = false;
    }
    layer.styles = null;
    layer.text = null;
  };

  const mergeGroup = (d, group) => {
    app.transact('Merge Group', { structure: true }, () => {
      const merged = new Layer({ name: group.name, canvas: d.renderGroup(group) });
      merged.opacity = group.opacity;
      merged.blendMode = group.blendMode === PASS_THROUGH ? 'source-over' : group.blendMode;
      const [s] = d.span(group);
      const parent = group.parent;
      d.removeLayer(group);
      d.addLayer(merged, s, parent);
    });
  };

  def('layer.mergeDown', 'Merge Down', () => {
    const d = doc();
    const upper = d.activeLayer;
    if (upper.isGroup) return mergeGroup(d, upper);
    const lower = d.layers[d.activeIndex - 1];
    if (!lower || lower.parent !== upper.parent) return app.toast('Could not merge because there is no layer below in the same group.');
    if (!lower.isPixel) return app.toast(`Could not merge because the layer below is ${lower.isGroup ? 'a group' : 'an adjustment layer'}.`);
    if (lower.locked) return app.toast('Could not merge because the layer below is locked.');
    if (!upper.visible || !lower.visible) return app.toast('Could not merge because one of the layers is hidden.');
    app.transact('Merge Down', { structure: true, layers: [lower] }, () => {
      bake(lower);
      if (upper.isAdjustment) {
        // Merging an adjustment layer applies it to the pixels below.
        const img = lower.ctx.getImageData(0, 0, lower.width, lower.height);
        const m = upper.mask && upper.mask.enabled ? upper.mask : null;
        const weights = m ? m.read(upper, lower.bounds) : null;
        applyAdjustmentLayer(img, upper.adjustment, weights, upper.opacity, upper.blendMode);
        lower.ctx.putImageData(img, 0, 0);
      } else {
        const src = hasStyles(upper) ? rasterizeStyled(upper) : { canvas: maskedPixels(upper), x: upper.x, y: upper.y };
        lower.ensureCovers({ x: src.x, y: src.y, w: src.canvas.width, h: src.canvas.height });
        const c = lower.ctx;
        c.save();
        c.globalAlpha = upper.opacity;
        c.globalCompositeOperation = upper.blendMode;
        c.drawImage(src.canvas, src.x - lower.x, src.y - lower.y);
        c.restore();
      }
      d.removeLayer(upper);
      d.setActive(lower);
    });
  }, {
    enabled: () => !!app.doc && (app.doc.activeLayer?.isGroup || app.doc.activeIndex > 0),
    shortcut: 'Ctrl+E',
    dynamicLabel: () => (doc()?.activeLayer?.isGroup ? 'Merge Group' : 'Merge Down'),
  });
  def('layer.mergeVisible', 'Merge Visible', () => {
    const d = doc();
    const visible = d.layers.filter((l) => !l.isGroup && d.isVisible(l));
    if (visible.length < 2) return;
    app.transact('Merge Visible', { structure: true }, () => {
      const merged = new Layer({ name: visible[0].name, canvas: d.composite() });
      const index = d.layers.indexOf(visible[0]);
      let parent = visible[0].parent;
      for (const l of visible) d.removeLayer(l);
      // Groups left empty go too; the merged layer stays in the nearest group that remains.
      for (const g of d.layers.filter((l) => l.isGroup && d.isVisible(l))) {
        if (!d.descendants(g).length) d.removeLayer(g);
      }
      while (parent && !d.layers.includes(parent)) parent = parent.parent;
      d.addLayer(merged, index, parent);
    });
  }, { enabled: multiLayer, shortcut: 'Ctrl+Shift+E' });
  def('layer.flatten', 'Flatten Image', () => {
    const d = doc();
    app.transact('Flatten Image', { structure: true }, () => {
      const c = createCanvas(d.width, d.height);
      const ctx = c.getContext('2d');
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, d.width, d.height);
      ctx.drawImage(d.composite(), 0, 0);
      for (const l of d.layers.slice()) d.removeLayer(l);
      d.addLayer(new Layer({ name: 'Background', canvas: c }), 0);
    });
  }, { enabled: hasDoc });

  /* ---------- Select ---------- */

  const selOp = (label, fn) => () => app.transact(label, { selection: true }, () => fn(doc().selection));
  def('select.all', 'All', selOp('Select All', (s) => s.selectAll()), { enabled: hasDoc, shortcut: 'Ctrl+A' });
  def('select.deselect', 'Deselect', selOp('Deselect', (s) => s.clear()), { enabled: hasSel, shortcut: 'Ctrl+D' });
  def('select.reselect', 'Reselect', selOp('Reselect', (s) => s.reselect()),
    { enabled: () => !!app.doc?.selection.lastMask, shortcut: 'Ctrl+Shift+D' });
  def('select.inverse', 'Inverse', selOp('Select Inverse', (s) => s.invert()),
    { enabled: hasDoc, shortcut: 'Ctrl+Shift+I', keys: ['Ctrl+Shift+I', 'Shift+F7'] });
  def('select.layerPixels', 'Select Layer Pixels', () => {
    const layer = doc().activeLayer;
    if (!layer.isPixel) return notPixels('load the selection');
    app.transact('Load Selection', { selection: true }, () => {
      doc().selection.combine((ctx) => ctx.drawImage(layer.canvas, layer.x, layer.y), 'new', 0, layer.bounds);
    });
  }, { enabled: pixelLayer });

  /* ---------- View ---------- */

  const zoom = (fn) => () => {
    fn(app.view, doc());
    app.viewChanged();
  };
  def('view.zoomIn', 'Zoom In', zoom((v) => v.zoomStep(1)),
    { enabled: hasDoc, shortcut: 'Ctrl+=', keys: ['Ctrl+=', 'Ctrl+Shift+=', 'Ctrl+NumpadAdd'] });
  def('view.zoomOut', 'Zoom Out', zoom((v) => v.zoomStep(-1)),
    { enabled: hasDoc, shortcut: 'Ctrl+-', keys: ['Ctrl+-', 'Ctrl+NumpadSubtract'] });
  def('view.fit', 'Fit on Screen', zoom((v, d) => v.fit(d.width, d.height, true)), { enabled: hasDoc, shortcut: 'Ctrl+0' });
  def('view.actual', '100%', zoom((v, d) => {
    v.zoom = 1;
    v.center(d.width, d.height);
  }), { enabled: hasDoc, shortcut: 'Ctrl+1', keys: ['Ctrl+1', 'Ctrl+Alt+0'] });
  def('view.fill', 'Fill Screen', zoom((v, d) => v.fill(d.width, d.height)), { enabled: hasDoc });
  def('view.panels', 'Show/Hide Panels', () => {
    const el = document.getElementById('app');
    if (window.matchMedia('(max-width: 900px)').matches) el.classList.toggle('panels-open');
    else el.classList.toggle('panels-hidden');
  }, { shortcut: 'Tab' });

  /* ---------- Help ---------- */

  def('help.shortcuts', 'Keyboard Shortcuts', () => shortcutsDialog(app, getMenus()), { shortcut: 'Shift+/' });
  def('help.about', 'About PhotoForge', () => aboutDialog());

  return A;
}
