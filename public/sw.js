const CACHE_NAME = 'health-app-shell-v2';
const SHELL_FILES = [
  '/',
  '/index.html',
  '/style.css',
  '/app.js',
  '/manifest.json',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(SHELL_FILES))
      .catch(() => {})
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))))
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Always go to the network for API calls - this app's data changes constantly
  // and must never be served stale from cache.
  if (url.pathname.startsWith('/api/')) {
    return;
  }

  // Network-first for the static app shell: always prefer the latest file when
  // online (this app is under active development), only falling back to the
  // cached copy when there's no network at all. A cache-first strategy here
  // would silently serve stale app.js/index.html forever once cached, since
  // the browser only re-checks this worker file itself for changes.
  event.respondWith(
    fetch(event.request)
      .then((response) => {
        const copy = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
        return response;
      })
      .catch(() => caches.match(event.request))
  );
});
