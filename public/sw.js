/* Service worker: caches static assets only. API calls and personal data are never cached. */
const CACHE = 'fairshift-static-v2';
const STATIC_PATH = /^\/(shared|worker|admin|passport|i18n)\/|^\/(landing\.(js|css)|icon\.svg|manifest\.webmanifest)$/;

self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((names) => Promise.all(names.filter((n) => n !== CACHE).map((n) => caches.delete(n))))
      .then(() => self.clients.claim()),
  );
});

// Network first, cache as the offline fallback: a new release is never hidden behind stale scripts.
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin || !STATIC_PATH.test(url.pathname)) return;
  event.respondWith(
    caches.open(CACHE).then((cache) =>
      fetch(request)
        .then((response) => {
          if (response.ok) cache.put(request, response.clone());
          return response;
        })
        .catch(() => cache.match(request)),
    ),
  );
});
