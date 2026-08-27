const CACHE = 'joogle-maps-v2';
const SHELL = [
  './',
  './index.html',
  './style.css',
  './app.js',
  './manifest.json'
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then(cache => cache.addAll(SHELL)));
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then(keys => Promise.all(
      keys.filter(k => k !== CACHE).map(k => caches.delete(k))
    ))
  );
  self.clients.claim();
});

// App shell: cache-first. Everything else (tiles, Firebase, Nominatim, OSRM): network-first, no caching.
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  const isShell = SHELL.some(p => url.pathname.endsWith(p.replace('./', '/')));
  if (isShell) {
    e.respondWith(caches.match(e.request).then(cached => cached || fetch(e.request)));
  }
  // else: let it hit the network normally (map tiles must always be fresh)
});
