/*
 * Service worker: makes PhotoForge work offline once it has been opened.
 * Network first (so updates arrive as soon as you are online), falling back
 * to the cached copy when offline or when the network is too slow.
 * PRECACHE must list every file the app needs (tests/offline.spec.js checks it).
 */
const CACHE = 'photoforge-v1';
const PRECACHE = [
  './',
  './index.html',
  './manifest.webmanifest',
  './css/base.css',
  './css/components.css',
  './js/actions-image.js',
  './js/actions-layers.js',
  './js/actions-mask.js',
  './js/actions.js',
  './js/app.js',
  './js/autosave.js',
  './js/core/adjustments.js',
  './js/core/blend.js',
  './js/core/document.js',
  './js/core/effects.js',
  './js/core/emitter.js',
  './js/core/filters.js',
  './js/core/heal.js',
  './js/core/history.js',
  './js/core/layer.js',
  './js/core/live-edit.js',
  './js/core/mask.js',
  './js/core/pixels.js',
  './js/core/renderer.js',
  './js/core/selection.js',
  './js/core/text.js',
  './js/core/transform.js',
  './js/core/utils.js',
  './js/core/viewport.js',
  './js/io.js',
  './js/main.js',
  './js/project.js',
  './js/psd.js',
  './js/shortcuts.js',
  './js/tools/brush.js',
  './js/tools/bucket.js',
  './js/tools/crop.js',
  './js/tools/free-transform.js',
  './js/tools/gradient.js',
  './js/tools/lasso.js',
  './js/tools/marquee.js',
  './js/tools/move.js',
  './js/tools/navigation.js',
  './js/tools/retouch.js',
  './js/tools/shape.js',
  './js/tools/text.js',
  './js/tools/tool.js',
  './js/ui/adjust-dialog.js',
  './js/ui/adjust-layer-dialog.js',
  './js/ui/color-panel.js',
  './js/ui/dialogs.js',
  './js/ui/doc-dialogs.js',
  './js/ui/dom.js',
  './js/ui/history-panel.js',
  './js/ui/icons.js',
  './js/ui/image-dialogs.js',
  './js/ui/layer-style-dialog.js',
  './js/ui/layers-panel.js',
  './js/ui/levels-curves.js',
  './js/ui/menubar.js',
  './js/ui/optionsbar.js',
  './js/ui/statusbar.js',
  './js/ui/tabs.js',
  './js/ui/toolbar.js',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
];
const NETWORK_TIMEOUT = 4000;

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(PRECACHE)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

function fromNetwork(request) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timeout')), NETWORK_TIMEOUT);
    fetch(request).then((res) => {
      clearTimeout(timer);
      resolve(res);
    }, (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

async function respond(request) {
  const cache = await caches.open(CACHE);
  try {
    const res = await fromNetwork(request);
    if (res.ok && res.type === 'basic') cache.put(request, res.clone());
    return res;
  } catch {
    const hit = await cache.match(request, { ignoreSearch: true });
    if (hit) return hit;
    if (request.mode === 'navigate') {
      const shell = await cache.match('./index.html');
      if (shell) return shell;
    }
    return Response.error();
  }
}

self.addEventListener('fetch', (e) => {
  const { request } = e;
  if (request.method !== 'GET' || new URL(request.url).origin !== self.location.origin) return;
  e.respondWith(respond(request));
});
