const CACHE_NAME = 'saraya-elonda-v2.0.1';
const STATIC_ASSETS = [
  './',
  './index.html',
  './manifest.json',
  './icon-512.png',
  './icon.svg',
  './pwa-192x192.png',
  './pwa-512x512.png',
  './apple-touch-icon.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(STATIC_ASSETS)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  // Network-Only for all non-GET requests (POST/PUT/DELETE)
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  const lowerPath = url.pathname.toLowerCase();
  const lowerHost = url.hostname.toLowerCase();

  // Strictly exclude admin panel and all Google Apps Script endpoints from Service Worker cache
  if (
    lowerPath.includes('admin.html') ||
    lowerPath.includes('/admin') ||
    lowerPath.includes('admin') ||
    lowerHost === 'script.google.com' ||
    lowerHost.endsWith('.script.google.com') ||
    lowerHost === 'script.googleusercontent.com' ||
    lowerHost.endsWith('.script.googleusercontent.com')
  ) {
    return;
  }

  // Stale-while-revalidate for fast instant menu loading & offline support
  event.respondWith(
    caches.open(CACHE_NAME).then(async (cache) => {
      const cachedResponse = await cache.match(request);
      const networkFetch = fetch(request)
        .then((networkResponse) => {
          if (networkResponse && (networkResponse.status === 200 || networkResponse.type === 'opaque')) {
            cache.put(request, networkResponse.clone()).catch(() => {});
          }
          return networkResponse;
        })
        .catch(() => cachedResponse);

      return cachedResponse || networkFetch;
    })
  );
});
