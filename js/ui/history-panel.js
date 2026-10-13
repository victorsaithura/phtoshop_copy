import { h, clear, revealInList } from './dom.js';

/** History panel: every undoable step; click one to jump to that state. */
export class HistoryPanel {
  constructor(app) {
    this.app = app;
    this.el = h('div', { class: 'history-list', role: 'listbox', 'aria-label': 'History' });
    app.on('history', () => this.render());
    app.on('document', () => this.render());
    this.render();
  }

  render() {
    clear(this.el);
    if (!this.app.doc) return;
    const hist = this.app.history;
    let current = null;
    hist.entries.forEach((entry, i) => {
      const state = i === hist.index ? ' current' : i > hist.index ? ' future' : '';
      const item = h('button', {
        type: 'button', class: 'history-item' + state, role: 'option', 'aria-selected': String(i === hist.index),
        onClick: () => hist.goTo(i),
      }, h('span', { class: 'h-dot' }), entry.label);
      if (i === hist.index) current = item;
      this.el.append(item);
    });
    revealInList(this.el, current);
  }
}
