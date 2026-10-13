import { h, clear } from './dom.js';
import { icon } from './icons.js';

/** One tab per open document. */
export class Tabs {
  constructor(app, el) {
    this.app = app;
    this.el = el;
    this.activeTitle = null;
    app.on('document', () => this.render());
    app.on('history', () => this.render());
    app.on('view', () => this._updateActiveTitle());
  }

  _title(session) {
    const zoom = session === this.app.session ? ` @ ${Math.round(this.app.view.zoom * 1000) / 10}%` : '';
    return `${session.doc.name}${zoom}${session.history.dirty ? ' *' : ''}`;
  }

  _updateActiveTitle() {
    if (this.activeTitle && this.app.session) this.activeTitle.textContent = this._title(this.app.session);
  }

  render() {
    clear(this.el);
    this.activeTitle = null;
    for (const session of this.app.sessions) {
      const active = session === this.app.session;
      const title = h('span', { class: 'tab-title' }, this._title(session));
      if (active) this.activeTitle = title;
      const close = h('span', { class: 'tab-close', role: 'button', title: 'Close', 'aria-label': `Close ${session.doc.name}` }, icon('close', 11));
      close.addEventListener('click', async (e) => {
        e.stopPropagation();
        if (await this.app.confirmDiscard(session)) this.app.closeDocument(session);
      });
      const tab = h('div', {
        class: 'tab' + (active ? ' active' : ''), role: 'tab', 'aria-selected': String(active), title: session.doc.name,
      }, title, close);
      tab.addEventListener('click', () => this.app.switchTo(session));
      this.el.append(tab);
    }
  }
}
