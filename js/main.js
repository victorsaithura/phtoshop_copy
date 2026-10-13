import { App } from './app.js';
import { createActions } from './actions.js';
import { registerImageActions } from './actions-image.js';
import { registerMaskActions } from './actions-mask.js';
import { registerLayerActions } from './actions-layers.js';
import { registerPrecisionActions } from './actions-precision.js';
import { setupShortcuts } from './shortcuts.js';
import { setupDropAndPaste, openFiles } from './io.js';
import { setupAutosave } from './autosave.js';
import { MoveTool } from './tools/move.js';
import { MarqueeTool } from './tools/marquee.js';
import { CropTool } from './tools/crop.js';
import { LassoTool, PolygonLassoTool, MagicWandTool } from './tools/lasso.js';
import { RetouchTool } from './tools/retouch.js';
import { TextTool } from './tools/text.js';
import { ShapeTool } from './tools/shape.js';
import { FreeTransformTool } from './tools/free-transform.js';
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
import { NavigatorPanel, InfoPanel, HistogramPanel } from './ui/info-panels.js';
import { h } from './ui/dom.js';
import { icon } from './ui/icons.js';

const $ = (sel) => document.querySelector(sel);

const app = new App();
app.init($('#view'));

for (const tool of [
  new MoveTool(app),
  new MarqueeTool(app, 'rect'),
  new MarqueeTool(app, 'ellipse'),
  new LassoTool(app),
  new PolygonLassoTool(app),
  new MagicWandTool(app),
  new CropTool(app),
  new EyedropperTool(app),
  new BrushTool(app, 'brush'),
  new BrushTool(app, 'pencil'),
  new BrushTool(app, 'eraser'),
  new GradientTool(app),
  new PaintBucketTool(app),
  ...['spot', 'heal', 'clone', 'blur', 'sharpen', 'smudge', 'dodge', 'burn', 'sponge'].map((k) => new RetouchTool(app, k)),
  new TextTool(app),
  ...['rect', 'ellipse', 'polygon', 'line'].map((k) => new ShapeTool(app, k)),
  new FreeTransformTool(app),
  new HandTool(app),
  new ZoomTool(app),
]) {
  app.registerTool(tool);
}

app.actions = createActions(app, () => MENUS);
registerImageActions(app, app.actions);
registerLayerActions(app, app.actions);
registerPrecisionActions(app, app.actions);
registerMaskActions(app, app.actions);

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

/** Panels sharing one slot, switched by tabs (like Photoshop's panel groups). */
function tabbedPanel(tabs) {
  const bodies = tabs.map(({ el }, i) => h('div', { class: 'tab-body', hidden: i > 0 }, el));
  const buttons = tabs.map(({ title }, i) => h('button', {
    type: 'button', class: 'panel-tab' + (i ? '' : ' active'), role: 'tab', 'aria-selected': String(!i),
    onClick: () => {
      section.classList.remove('collapsed');
      buttons.forEach((b, j) => {
        b.classList.toggle('active', i === j);
        b.setAttribute('aria-selected', String(i === j));
        bodies[j].hidden = i !== j;
      });
      tabs[i].panel?.onShow?.();
    },
  }, title));
  const collapse = h('button', { type: 'button', class: 'panel-collapse', 'aria-label': 'Collapse panel', onClick: () => section.classList.toggle('collapsed') },
    icon('chevron', 12));
  const section = h('section', { class: 'panel' },
    h('div', { class: 'panel-header panel-tabbar' }, h('div', { class: 'panel-tabs', role: 'tablist' }, buttons), collapse),
    h('div', { class: 'panel-body' }, bodies));
  return section;
}

const navigatorPanel = new NavigatorPanel(app);
const histogramPanel = new HistogramPanel(app);
$('#panels').append(
  tabbedPanel([
    { title: 'Color', el: new ColorPanel(app).el },
    { title: 'Navigator', el: navigatorPanel.el, panel: navigatorPanel },
    { title: 'Info', el: new InfoPanel(app).el },
  ]),
  tabbedPanel([
    { title: 'History', el: new HistoryPanel(app).el },
    { title: 'Histogram', el: histogramPanel.el, panel: histogramPanel },
  ]),
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

/* ---------- Autosave, offline use and installing ---------- */

setupAutosave(app);

if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
  navigator.serviceWorker.register('./sw.js').catch(() => { /* offline use is optional */ });
}

let installPrompt = null;
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  installPrompt = e;
});
app.actions['file.install'] = {
  id: 'file.install',
  label: 'Install PhotoForge…',
  keys: [],
  run: async () => {
    if (window.matchMedia('(display-mode: standalone)').matches) {
      app.toast('PhotoForge is already installed and running as an app.');
    } else if (installPrompt) {
      const prompt = installPrompt;
      installPrompt = null;
      await prompt.prompt();
    } else {
      app.toast('Use your browser’s install option: “Install app” in Chrome or Edge, or Share ▸ Add to Dock / Home Screen in Safari.');
    }
  },
};

// Files opened from the operating system with the installed app.
if ('launchQueue' in window) {
  window.launchQueue.setConsumer(async (params) => {
    if (params.files?.length) openFiles(app, await Promise.all(params.files.map((f) => f.getFile())));
  });
}

// Handy for debugging from the console.
window.photoforge = app;
