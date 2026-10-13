import { h, clear } from './dom.js';
import { icon } from './icons.js';
import { colorPickerDialog } from './dialogs.js';

// Tool slots in Photoshop order; tools sharing a slot appear in a flyout.
export const TOOL_GROUPS = [
  ['move'],
  ['marquee-rect', 'marquee-ellipse'],
  ['eyedropper'],
  ['brush', 'pencil'],
  ['eraser'],
  ['gradient', 'bucket'],
  null,
  ['hand'],
  ['zoom'],
];

export class Toolbar {
  constructor(app, el) {
    this.app = app;
    this.el = el;
    this.current = new Map(); // slot index -> tool id last used in that slot
    this.slots = [];
    this.flyout = null;
    this._build();
    app.on('tool', () => this._sync());
    app.on('colors', () => this._syncColors());
  }

  /** Tool shortcut letter; Shift cycles through the tools sharing a slot. */
  selectByKey(key, cycle) {
    for (let i = 0; i < TOOL_GROUPS.length; i++) {
      const group = TOOL_GROUPS[i];
      if (!group || !group.some((id) => this.app.tools.get(id)?.key === key)) continue;
      const active = this.app.tool?.id;
      if (cycle && group.includes(active)) {
        this.app.setTool(group[(group.indexOf(active) + 1) % group.length]);
      } else {
        this.app.setTool(this.current.get(i) || group[0]);
      }
      return true;
    }
    return false;
  }

  _build() {
    TOOL_GROUPS.forEach((group, i) => {
      if (!group) {
        this.el.append(h('div', { class: 'tool-sep' }));
        return;
      }
      const btn = h('button', { type: 'button', class: 'tool-btn' });
      btn.addEventListener('click', () => {
        if (btn.dataset.longpress) {
          delete btn.dataset.longpress;
          return;
        }
        this.app.setTool(this.current.get(i) || group[0]);
      });
      if (group.length > 1) {
        btn.addEventListener('contextmenu', (e) => {
          e.preventDefault();
          this._openFlyout(i, btn);
        });
        let timer = 0;
        btn.addEventListener('pointerdown', () => {
          timer = setTimeout(() => {
            btn.dataset.longpress = '1';
            this._openFlyout(i, btn);
          }, 450);
        });
        for (const ev of ['pointerup', 'pointerleave', 'pointercancel']) {
          btn.addEventListener(ev, () => clearTimeout(timer));
        }
      }
      this.slots.push({ i, group, btn });
      this.el.append(btn);
    });

    this.fgChip = h('button', { type: 'button', class: 'color-chip fg', title: 'Set foreground color',
      onClick: () => colorPickerDialog(this.app, 'fg') });
    this.bgChip = h('button', { type: 'button', class: 'color-chip bg', title: 'Set background color',
      onClick: () => colorPickerDialog(this.app, 'bg') });
    const swap = h('button', { type: 'button', class: 'color-swap', title: 'Switch foreground and background colors (X)',
      onClick: () => this.app.swapColors() }, icon('swap', 12));
    const reset = h('button', { type: 'button', class: 'color-default', title: 'Default foreground and background colors (D)',
      onClick: () => this.app.resetColors() }, icon('reset-colors', 12));
    this.el.append(h('div', { class: 'colors' }, this.fgChip, this.bgChip, swap, reset));

    this._sync();
    this._syncColors();
  }

  _sync() {
    const active = this.app.tool?.id;
    for (const { i, group, btn } of this.slots) {
      if (group.includes(active)) this.current.set(i, active);
      const tool = this.app.tools.get(this.current.get(i) || group[0]);
      if (!tool) continue;
      clear(btn);
      btn.append(icon(tool.icon, 19));
      if (group.length > 1) btn.append(h('span', { class: 'tool-corner' }));
      const more = group.length > 1 ? ' — right-click or hold for more' : '';
      btn.title = `${tool.name} (${tool.key})${more}`;
      btn.setAttribute('aria-label', tool.name);
      btn.classList.toggle('active', group.includes(active));
    }
  }

  _syncColors() {
    this.fgChip.style.background = this.app.colors.fg;
    this.bgChip.style.background = this.app.colors.bg;
  }

  _openFlyout(i, btn) {
    this._closeFlyout();
    const group = TOOL_GROUPS[i];
    const r = btn.getBoundingClientRect();
    const menu = h('div', { class: 'tool-flyout', style: { left: `${r.right + 4}px`, top: `${r.top}px` } });
    for (const id of group) {
      const tool = this.app.tools.get(id);
      if (!tool) continue;
      menu.append(h('button', {
        type: 'button',
        class: 'flyout-item' + (id === (this.current.get(i) || group[0]) ? ' active' : ''),
        onClick: () => {
          this._closeFlyout();
          this.app.setTool(id);
        },
      }, icon(tool.icon, 17), tool.name, h('span', { class: 'flyout-key' }, tool.key)));
    }
    document.body.append(menu);
    this.flyout = menu;
    const close = (e) => {
      if (e.type === 'keydown' && e.key !== 'Escape') return;
      if (e.type === 'pointerdown' && menu.contains(e.target)) return;
      this._closeFlyout();
    };
    this._flyoutClose = close;
    setTimeout(() => {
      document.addEventListener('pointerdown', close, true);
      document.addEventListener('keydown', close, true);
    });
  }

  _closeFlyout() {
    if (!this.flyout) return;
    this.flyout.remove();
    this.flyout = null;
    document.removeEventListener('pointerdown', this._flyoutClose, true);
    document.removeEventListener('keydown', this._flyoutClose, true);
  }
}
