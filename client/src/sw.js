/* sw.js — cached read access: My Wrestler, next match, bracket view, and the
   Tournament hub (info/stats) work from cache when the network drops. Stale
   data is labelled via X-Arena-Stale, never presented as live. */
const CACHE = 'arena-v7';
const CORE = ['index.html', 'styles.css', 'app.js', 'studio.js', 'bracket.js'];
const API_PREFIXES = ['/api/public/', '/api/wrestler/', '/api/tournaments/'];
self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(CORE)).then(() => self.skipWaiting()));
});
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET') return;
  if (url.pathname.startsWith('/api/') && !API_PREFIXES.some((p) => url.pathname.startsWith(p))) return;
  e.respondWith(
    fetch(e.request).then((res) => {
      const copy = res.clone();
      caches.open(CACHE).then((c) => c.put(e.request, copy));
      return res;
    }).catch(() => caches.match(e.request).then((hit) => {
      if (!hit) return Response.error();
      const headers = new Headers(hit.headers);
      headers.set('X-Arena-Stale', '1');
      return new Response(hit.body, { status: hit.status, statusText: hit.statusText, headers });
    })),
  );
});
