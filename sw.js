// APMG Quote Calculator service worker
// Bump CACHE version whenever you deploy a new build so clients refresh cleanly.
const CACHE = 'apmg-quote-calc-v20';
const ASSETS = [
  './canopy_quote_calculator.html',
  './manifest.json',
  './icon-192.png',
  './icon-512.png'
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  // Only ever cache same-origin GET requests (the app's own assets). Cross-origin
  // calls like api.airtable.com — and any non-GET — must always hit the live network,
  // never the cache, so auth/results are never served stale.
  let sameOrigin = false;
  try { sameOrigin = new URL(req.url).origin === self.location.origin; } catch (_) {}
  if (req.method !== 'GET' || !sameOrigin) return; // browser handles it directly
  e.respondWith(
    caches.match(req).then((cached) => {
      const network = fetch(req).then((res) => {
        if (res && res.status === 200) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy));
        }
        return res;
      }).catch(() => cached);
      return cached || network;
    })
  );
});
