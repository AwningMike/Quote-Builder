// APMG Quote Calculator service worker
// Bump CACHE version whenever you deploy a new build so clients refresh cleanly.
const CACHE = 'apmg-quote-calc-v52';
const ASSETS = [
  './canopy_quote_calculator.html',
  './drawing_builder.html',
  './price_watch.html',
  './job_costing.html',
  './manifest.json',
  './icon-192.png',
  './icon-512.png'
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(ASSETS).catch(()=>{})).then(() => self.skipWaiting())
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
  // Only handle same-origin GET. Cross-origin (api.airtable.com) and non-GET always hit the live network.
  let url;
  try { url = new URL(req.url); } catch (_) { return; }
  if (req.method !== 'GET' || url.origin !== self.location.origin) return;

  // NETWORK-FIRST for pages/HTML so a new deploy is always picked up (no stale app).
  // Cache is only the offline fallback. This prevents the "stuck on an old version" problem.
  const isPage = req.mode === 'navigate' || req.destination === 'document' || url.pathname.endsWith('.html');
  if (isPage) {
    e.respondWith(
      fetch(req).then((res) => {
        if (res && res.status === 200) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); }
        return res;
      }).catch(() => caches.match(req))
    );
    return;
  }

  // CACHE-FIRST for static assets (icons, manifest) — with background refresh.
  e.respondWith(
    caches.match(req).then((cached) => {
      const network = fetch(req).then((res) => {
        if (res && res.status === 200) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); }
        return res;
      }).catch(() => cached);
      return cached || network;
    })
  );
});
