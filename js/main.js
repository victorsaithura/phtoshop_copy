import { App } from './app.js';
import { createActions } from './actions.js';
import { setupShortcuts } from './shortcuts.js';
import { setupDropAndPaste } from './io.js';
import { MoveTool } from './tools/move.js';
import { MarqueeTool } from './tools/marquee.js';
import { BrushTool } from './tools/brush.js';
import { PaintBucketTool } from './tools/bucket.js';
import { GradientTool } from './tools/gradient.js';
import { EyedropperTool, HandTool, ZoomTool } from './tools/navigation.js';
import { MenuBar, MENUS } from './ui/menubar.js';
import { OptionsBar } from './ui/optionsbar.js';
import { Toolbar } from './ui/toolbar.js';
import { Tabs } from './ui/tabs.js';
import { StatusBar } from './ui/statusbar.js';
import { LayersPanel } from './ui/layers-panel.js';
import { HistoryPanel } from './ui/history-panel.js';
import { ColorPanel } from './ui/color-panel.js';
import { h } from './ui/dom.js';
import { icon } from './ui/icons.js';

const $ = (sel) => document.querySelector(sel);

const app = new App();
app.init($('#view'));

for (const tool of [
  new MoveTool(app),
  new MarqueeTool(app, 'rect'),
  new MarqueeTool(app, 'ellipse'),
  new EyedropperTool(app),
  new BrushTool(app, 'brush'),
  new BrushTool(app, 'pencil'),
  new BrushTool(app, 'eraser'),
  new GradientTool(app),
  new PaintBucketTool(app),
  new HandTool(app),
  new ZoomTool(app),
]) {
  app.registerTool(tool);
}

app.actions = createActions(app, () => MENUS);

new MenuBar(app, $('#menubar'));
new OptionsBar(app, $('#optionsbar'));
const toolbar = new Toolbar(app, $('#toolbar'));
new Tabs(app, $('#tabs'));
new StatusBar(app, $('#statusbar'));

/* ---------- Panels ---------- */

function panel(title, content, { grow = false, collapsed = false } = {}) {
  const header = h('button', { type: 'button', class: 'panel-header', 'aria-expanded': String(!collapsed) },
    title, icon('chevron', 12));
  const section = h('section', { class: 'panel' + (grow ? ' grow' : '') + (collapsed ? ' collapsed' : '') },
    header, h('div', { class: 'panel-body' }, content));
  header.addEventListener('click', () => {
    section.classList.toggle('collapsed');
    header.setAttribute('aria-expanded', String(!section.classList.contains('collapsed')));
  });
  return section;
}

$('#panels').append(
  panel('Color', new ColorPanel(app).el),
  panel('History', new HistoryPanel(app).el),
  panel('Layers', new LayersPanel(app).el, { grow: true }),
);

/* ---------- Input ---------- */

setupShortcuts(app, toolbar);
setupDropAndPaste(app);
app.setTool('move');

for (const btn of document.querySelectorAll('[data-action]')) {
  btn.addEventListener('click', () => app.runAction(btn.dataset.action));
}

// Mouse clicks shouldn't leave buttons focused, so Space/Enter keep working as
// shortcuts. Keyboard activation (detail === 0) keeps focus for accessibility.
document.addEventListener('click', (e) => {
  if (e.detail === 0) return;
  const el = e.target instanceof Element && e.target.closest('button, input[type=range], input[type=checkbox]');
  if (el && !el.closest('.modal')) el.blur();
});

// Tapping the workspace closes the panel drawer on small screens.
$('#workspace').addEventListener('pointerdown', () => $('#app').classList.remove('panels-open'));

/* ---------- Document state ---------- */

const welcome = $('#welcome');
app.on('document', () => {
  welcome.hidden = !!app.doc;
  document.title = app.doc ? `${app.doc.name} — PhotoForge` : 'PhotoForge';
});
welcome.hidden = false;

window.addEventListener('beforeunload', (e) => {
  if (app.sessions.some((s) => s.history.dirty)) {
    e.preventDefault();
    e.returnValue = '';
  }
});

/* ---------- Toasts ---------- */

const toast = $('#toast');
let toastTimer = 0;
app.on('toast', (message) => {
  toast.textContent = message;
  toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('show'), 3200);
});

// Handy for debugging from the console.
window.photoforge = app;
