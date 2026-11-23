// Offline support. The build fills in VERSION and PRECACHE (see vite.config.ts):
// everything the app needs is cached on install, then served cache-first and
// refreshed in the background. A new build has a new VERSION, so old caches are dropped.
const VERSION = '__VERSION__';
const PRECACHE = __PRECACHE__;
const CACHE = `notes-${VERSION}`;
const SHELL = new URL('./', self.location).href;

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE)
      .then((c) => c.addAll(PRECACHE.map((u) => new Request(u, { cache: 'reload' }))))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('notes-') && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;

  // Every page load (including ?new) gets the same cached shell.
  const key = req.mode === 'navigate' ? SHELL : req;

  event.respondWith(
    caches.open(CACHE).then(async (cache) => {
      const cached = await cache.match(key);
      const fresh = fetch(req)
        .then((res) => {
          if (res.ok && res.type === 'basic' && !res.redirected) cache.put(key, res.clone());
          return res;
        })
        .catch(() => cached || Response.error());
      if (cached) {
        event.waitUntil(fresh.catch(() => {}));
        return cached;
      }
      return fresh;
    }),
  );
});
