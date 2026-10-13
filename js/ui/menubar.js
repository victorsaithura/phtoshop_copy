import { h } from './dom.js';
import { icon } from './icons.js';
import { formatShortcut } from '../core/utils.js';

export const MENUS = [
  { label: 'File', items: ['file.new', 'file.open', 'file.place', '-', 'file.export', 'file.quickExport', '-', 'file.close'] },
  {
    label: 'Edit',
    items: ['edit.undo', 'edit.redo', '-', 'edit.cut', 'edit.copy', 'edit.copyMerged', 'edit.paste', 'edit.clear', '-',
      'edit.fill', 'edit.fillFg', 'edit.fillBg'],
  },
  {
    label: 'Layer',
    items: ['layer.new', 'layer.duplicate', 'layer.delete', 'layer.rename', '-', 'layer.viaCopy', 'layer.viaCut', '-',
      'layer.lock', 'layer.hide', '-', 'layer.front', 'layer.forward', 'layer.backward', 'layer.back', '-',
      'layer.selectUp', 'layer.selectDown', '-', 'layer.mergeDown', 'layer.mergeVisible', 'layer.flatten'],
  },
  { label: 'Select', items: ['select.all', 'select.deselect', 'select.reselect', 'select.inverse', '-', 'select.layerPixels'] },
  { label: 'View', items: ['view.zoomIn', 'view.zoomOut', 'view.fit', 'view.actual', 'view.fill', '-', 'view.panels'] },
  { label: 'Help', items: ['help.shortcuts', 'help.about'] },
];

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
    const dropdown = h('div', { class: 'menu-dropdown', role: 'menu' });
    for (const id of menu.items) {
      if (id === '-') {
        dropdown.append(h('div', { class: 'menu-sep' }));
        continue;
      }
      const a = this.app.actions[id];
      if (!a) continue;
      const enabled = !a.enabled || a.enabled();
      dropdown.append(h('button', {
        type: 'button', class: 'menu-item', role: 'menuitem', disabled: !enabled,
        onClick: () => {
          this.close();
          a.run();
        },
      }, h('span', {}, a.dynamicLabel ? a.dynamicLabel() : a.label),
      h('span', { class: 'menu-shortcut' }, formatShortcut(a.shortcut))));
    }
    btn.classList.add('open');
    btn.parentElement.append(dropdown);
    // Keep the dropdown on screen on narrow windows.
    const r = dropdown.getBoundingClientRect();
    if (r.right > window.innerWidth - 4) dropdown.style.left = `${Math.min(0, window.innerWidth - 4 - r.right)}px`;
    this.open = { btn, dropdown };
    document.addEventListener('pointerdown', this._outside, true);
    document.addEventListener('keydown', this._key, true);
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

