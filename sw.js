// Service worker for the My World PWA.
// Goal: the app *shell* loads offline so the iPad opens even with no network.
// Tile content is already handled by the app's own IndexedDB blob cache, and
// taps are queued offline by the app — so this SW deliberately stays out of
// the way of /api/* (always network) and only caches the static shell + fonts.

const CACHE = 'myworld-shell-v4';
const SHELL = [
  '/app.html',
  '/manifest.webmanifest',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/icons/apple-touch-icon.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE)
      // allSettled so one flaky asset (e.g. an auth hiccup) can't abort install.
      .then((c) => Promise.allSettled(SHELL.map((u) => c.add(u))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;                          // never touch writes
  const url = new URL(req.url);
  if (url.origin === location.origin && url.pathname.startsWith('/api/')) return; // data + media: always network

  // App navigations: try the network, fall back to the cached shell offline.
  if (req.mode === 'navigate') {
    event.respondWith(fetch(req).catch(() => caches.match('/app.html')));
    return;
  }

  // Everything else (static assets, fonts): cache-first, then network + cache.
  event.respondWith(
    caches.match(req).then((hit) => {
      if (hit) return hit;
      return fetch(req).then((res) => {
        if (res && (res.ok || res.type === 'opaque')) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy));
        }
        return res;
      });
    })
  );
});
