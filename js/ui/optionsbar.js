import { h, clear, slider, numberInput, selectInput, checkbox, segmented, button } from './dom.js';
import { icon } from './icons.js';

/** The context-sensitive bar under the menus; each tool fills it via buildOptions(bar). */
export class OptionsBar {
  constructor(app, el) {
    this.app = app;
    this.el = el;
    app.on('tool', () => this.render());
    app.on('tool-options', () => this.render());
    app.on('colors', () => {
      if (app.tool?.rebuildOnColors) this.render();
    });
  }

  render() {
    clear(this.el);
    const tool = this.app.tool;
    if (!tool) return;
    this.el.append(
      h('div', { class: 'opt-tool', title: tool.name }, icon(tool.icon, 18), tool.name.replace(' Tool', '')),
      h('div', { class: 'opt-sep' }),
    );
    tool.buildOptions(this);
  }

  add(el) {
    this.el.append(el);
    return el;
  }

  slider(o) { return this.add(slider(o)); }
  number(o) { return this.add(numberInput(o)); }
  select(o) { return this.add(selectInput(o)); }
  checkbox(o) { return this.add(checkbox(o)); }
  segmented(o) { return this.add(segmented(o)); }
  button(o) { return this.add(button(o)); }
  sep() { return this.add(h('div', { class: 'opt-sep' })); }
  hint(text) { return this.add(h('span', { class: 'opt-label' }, text)); }

  gradientPreview(stops) {
    return this.add(h('div', {
      class: 'opt-group',
      title: 'Current gradient',
      style: {
        width: '64px', height: '20px', borderRadius: '3px', border: '1px solid #111',
        background: `linear-gradient(90deg, ${stops.join(', ')}), repeating-conic-gradient(#ccc 0 25%, #fff 0 50%) 0 0 / 8px 8px`,
      },
    }));
  }
}
