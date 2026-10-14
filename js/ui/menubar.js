import { h } from './dom.js';
import { icon } from './icons.js';
import { formatShortcut } from '../core/utils.js';

// Items are action ids, '-' separators, or { label, items } submenus.
export const MENUS = [
  { label: 'File', items: ['file.new', 'file.open', 'file.place', '-', 'file.save', 'file.saveAs', 'file.savePSD', '-', 'file.export', 'file.quickExport', '-', 'file.install', '-', 'file.close'] },
  {
    label: 'Edit',
    items: ['edit.undo', 'edit.redo', '-', 'edit.cut', 'edit.copy', 'edit.copyMerged', 'edit.paste', 'edit.clear', '-',
      'edit.fill', 'edit.contentAwareFill', 'edit.fillFg', 'edit.fillBg', '-', 'edit.freeTransform',
      { label: 'Transform', items: ['transform.skew', 'transform.distort', 'transform.perspective', 'transform.warp', '-',
        'transform.rot180', 'transform.rot90cw', 'transform.rot90ccw', '-', 'transform.flipH', 'transform.flipV'] }],
  },
  {
    label: 'Image',
    items: [
      {
        label: 'Adjustments',
        items: ['adjust.brightnessContrast', 'adjust.levels', 'adjust.curves', 'adjust.exposure', '-',
          'adjust.vibrance', 'adjust.hueSaturation', 'adjust.colorBalance', 'adjust.blackWhite', 'adjust.photoFilter', '-',
          'adjust.invert', 'adjust.posterize', 'adjust.threshold', 'adjust.gradientMap', '-', 'adjust.desaturate'],
      },
      '-', 'image.autoTone', 'image.autoContrast', '-', 'image.size', 'image.canvasSize',
      {
        label: 'Image Rotation',
        items: ['image.rotate180', 'image.rotateCW', 'image.rotateCCW', 'image.rotateArbitrary', '-', 'image.flipH', 'image.flipV'],
      },
      'image.crop', '-', 'image.duplicate',
    ],
  },
  {
    label: 'Layer',
    items: ['layer.new', 'layer.newGroup', 'layer.duplicate', 'layer.delete', 'layer.rename', '-',
      'layer.viaCopy', 'layer.viaCut', 'layer.rasterize', '-',
      { label: 'Layer Style', items: ['layer.style.open', '-', 'layer.style.bevel', 'layer.style.stroke', 'layer.style.innerShadow',
        'layer.style.innerGlow', 'layer.style.colorOverlay', 'layer.style.outerGlow', 'layer.style.dropShadow', '-',
        'layer.style.copy', 'layer.style.paste', 'layer.style.clear'] },
      { label: 'New Adjustment Layer', items: ['layer.adjust.brightnessContrast', 'layer.adjust.levels', 'layer.adjust.curves',
        'layer.adjust.exposure', '-', 'layer.adjust.vibrance', 'layer.adjust.hueSaturation', 'layer.adjust.colorBalance',
        'layer.adjust.blackWhite', 'layer.adjust.photoFilter', '-', 'layer.adjust.invert', 'layer.adjust.posterize',
        'layer.adjust.threshold', 'layer.adjust.gradientMap'] },
      'layer.adjustmentOptions',
      { label: 'Layer Mask', items: ['mask.revealAll', 'mask.hideAll', 'mask.revealSelection', 'mask.hideSelection', '-',
        'mask.toggle', 'mask.apply', 'mask.delete'] },
      '-', 'layer.group', 'layer.ungroup', '-',
      'layer.lock', 'layer.hide', '-', 'layer.front', 'layer.forward', 'layer.backward', 'layer.back', '-',
      'layer.selectUp', 'layer.selectDown', '-', 'layer.mergeDown', 'layer.mergeVisible', 'layer.flatten'],
  },
  {
    label: 'Select',
    items: ['select.all', 'select.deselect', 'select.reselect', 'select.inverse', '-', 'select.colorRange', '-',
      { label: 'Modify', items: ['select.border', 'select.smooth', 'select.expand', 'select.contract', 'select.feather'] },
      '-', 'select.layerPixels', '-', 'select.quickMask'],
  },
  {
    label: 'Filter',
    items: ['filter.last', '-', 'filter.liquify', '-',
      { label: 'Blur', items: ['filter.gaussianBlur', 'filter.motionBlur', 'filter.boxBlur'] },
      { label: 'Distort', items: ['filter.pinch', 'filter.polarCoordinates', 'filter.ripple', 'filter.spherize',
        'filter.twirl', 'filter.wave', 'filter.zigzag'] },
      { label: 'Noise', items: ['filter.addNoise'] },
      { label: 'Pixelate', items: ['filter.mosaic'] },
      { label: 'Render', items: ['filter.vignette'] },
      { label: 'Sharpen', items: ['filter.sharpen', 'filter.unsharpMask'] },
      { label: 'Stylize', items: ['filter.emboss', 'filter.findEdges'] },
      { label: 'Other', items: ['filter.highPass'] }],
  },
  {
    label: 'View',
    items: ['view.zoomIn', 'view.zoomOut', 'view.fit', 'view.actual', 'view.fill', '-',
      { label: 'Show', items: ['view.grid', 'view.guides'] }, 'view.rulers', '-',
      'view.snap', { label: 'Snap To', items: ['view.snapGuides', 'view.snapGrid', 'view.snapDocument'] }, '-',
      'view.lockGuides', 'view.clearGuides', 'view.newGuide', 'view.gridSettings', '-', 'view.panels'],
  },
  { label: 'Help', items: ['help.shortcuts', 'help.about'] },
];

const flatten = (items) => items.flatMap((it) => (typeof it === 'object' ? flatten(it.items) : [it]));

/** Photoshop-style menu bar: click to open, hover to switch, Esc to close. */
export class MenuBar {
  constructor(app, el) {
    this.app = app;
    this.el = el;
    this.open = null;
    el.append(h('div', { class: 'menu-brand', title: 'PhotoForge' }, 'Pf'));
    this.roots = MENUS.map((menu) => {
      const btn = h('button', { type: 'button', class: 'menu-root', 'aria-haspopup': 'true' }, menu.label);
      btn.addEventListener('click', () => (this.open?.btn === btn ? this.close() : this.show(menu, btn)));
      btn.addEventListener('pointerenter', () => {
        if (this.open && this.open.btn !== btn) this.show(menu, btn);
      });
      el.append(h('div', { class: 'menu-wrap' }, btn));
      return btn;
    });
    el.append(h('button', {
      type: 'button', class: 'icon-btn panels-toggle', title: 'Show/hide panels', 'aria-label': 'Show or hide panels',
      onClick: () => app.runAction('view.panels'),
    }, icon('panels', 18)));

    this._outside = (e) => {
      if (this.open && !this.el.contains(e.target)) this.close();
    };
    this._key = (e) => {
      if (e.key === 'Escape' && this.open) {
        e.stopPropagation();
        this.close();
      }
    };
  }

  show(menu, btn) {
    this.close();
    const dropdown = this._list(menu.items);
    btn.classList.add('open');
    btn.parentElement.append(dropdown);
    // Keep the dropdown on screen on narrow windows.
    const r = dropdown.getBoundingClientRect();
    if (r.right > window.innerWidth - 4) dropdown.style.left = `${Math.min(0, window.innerWidth - 4 - r.right)}px`;
    this.open = { btn, dropdown };
    document.addEventListener('pointerdown', this._outside, true);
    document.addEventListener('keydown', this._key, true);
  }

  _list(items) {
    const list = h('div', { class: 'menu-dropdown', role: 'menu' });
    // Menus with checkable items keep a check-mark column on every row, so labels line up.
    const checks = items.some((it) => typeof it === 'string' && this.app.actions[it]?.checked);
    for (const item of items) {
      if (item === '-') list.append(h('div', { class: 'menu-sep' }));
      else if (typeof item === 'object') list.append(this._submenu(item, list, checks));
      else {
        const a = this.app.actions[item];
        if (!a) continue;
        const checked = a.checked ? a.checked() : null;
        list.append(h('button', {
          type: 'button', class: 'menu-item', role: a.checked ? 'menuitemcheckbox' : 'menuitem',
          'aria-checked': a.checked ? String(checked) : null, disabled: !!(a.enabled && !a.enabled()),
          onClick: () => {
            this.close();
            a.run();
          },
        }, h('span', {}, checks ? h('span', { class: 'menu-check' }, checked ? '✓' : '') : null,
          a.dynamicLabel ? a.dynamicLabel() : a.label),
        h('span', { class: 'menu-shortcut' }, formatShortcut(a.shortcut))));
      }
    }
    return list;
  }

  _submenu(item, parentList, checks = false) {
    const sub = this._list(item.items);
    sub.classList.add('sub');
    const enabled = flatten(item.items).some((id) => {
      const a = this.app.actions[id];
      return a && (!a.enabled || a.enabled());
    });
    const trigger = h('button', { type: 'button', class: 'menu-item', role: 'menuitem', 'aria-haspopup': 'true', disabled: !enabled },
      h('span', {}, checks ? h('span', { class: 'menu-check' }) : null, item.label), h('span', { class: 'menu-arrow' }, '▸'));
    const wrap = h('div', { class: 'menu-sub' }, trigger, sub);
    const open = (on) => {
      for (const other of parentList.querySelectorAll(':scope > .menu-sub.open')) if (other !== wrap) other.classList.remove('open');
      wrap.classList.toggle('open', on);
      sub.classList.remove('flip');
      if (on && sub.getBoundingClientRect().right > window.innerWidth - 4) sub.classList.add('flip');
    };
    trigger.addEventListener('click', () => open(!wrap.classList.contains('open')));
    wrap.addEventListener('pointerenter', (e) => { if (e.pointerType === 'mouse' && enabled) open(true); });
    wrap.addEventListener('pointerleave', (e) => { if (e.pointerType === 'mouse') wrap.classList.remove('open'); });
    return wrap;
  }

  close() {
    if (!this.open) return;
    this.open.dropdown.remove();
    this.open.btn.classList.remove('open');
    this.open = null;
    document.removeEventListener('pointerdown', this._outside, true);
    document.removeEventListener('keydown', this._key, true);
  }
}

