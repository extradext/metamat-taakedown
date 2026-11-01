/* sw.js — cached read access: My Wrestler, next bout, bracket view work from
   cache when the network drops. Stale data is labelled stale, never live. */
const CACHE = 'arena-v5';
const CORE = ['index.html', 'styles.css', 'app.js', 'studio.js', 'bracket.js'];
self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(CORE)).then(() => self.skipWaiting()));
});
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET') return;
  if (url.pathname.startsWith('/api/') && !url.pathname.startsWith('/api/public/') && !url.pathname.startsWith('/api/wrestler/')) return;
  e.respondWith(
    fetch(e.request).then((res) => {
      const copy = res.clone();
      caches.open(CACHE).then((c) => c.put(e.request, copy));
      return res;
    }).catch(() => caches.match(e.request).then((hit) => hit || Response.error())),
  );
});
