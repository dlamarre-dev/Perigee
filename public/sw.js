/*
 * Périgée service worker — offline support (CLAUDE.md §8, M5).
 *
 * Same-origin requests only; third parties (e.g. the SoundCloud player) are never intercepted.
 * - page navigations: network first, cached copy when offline;
 * - hashed build assets (assets/*) and versioned data (data/*?v=<sha256>): cache first, they never change;
 * - data/manifest.json: network first (freshness), cached copy when offline;
 * - textures and other static files: stale-while-revalidate.
 * Versioned data keep only the latest version of each file; build assets are evicted least-recently-used first
 * (a cache hit refreshes the entry), so the scripts of the running build are never the ones evicted.
 */
const VERSION = 'v2';
const SHELL = `perigee-shell-${VERSION}`;
/** Hashed build assets (assets/*). */
const IMMUTABLE = `perigee-immutable-${VERSION}`;
/** Versioned data (data/*?v=<sha256>): one version per file. */
const DATA = `perigee-data-${VERSION}`;
const RUNTIME = `perigee-runtime-${VERSION}`;
// Module scripts carry an Origin header; responses may say "Vary: Origin". Same-origin only, so ignore it.
const MATCH = { ignoreVary: true };
const LIMITS = { [IMMUTABLE]: 200, [RUNTIME]: 80 };

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(SHELL)
      .then((cache) => cache.addAll(['./', './manifest.webmanifest', './icons/favicon.svg']))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  const keep = new Set([SHELL, IMMUTABLE, DATA, RUNTIME]);
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys.filter((k) => k.startsWith('perigee-') && !keep.has(k)).map((k) => caches.delete(k)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

async function trim(cacheName) {
  const limit = LIMITS[cacheName];
  if (!limit) return;
  const cache = await caches.open(cacheName);
  const keys = await cache.keys();
  for (let i = 0; i < keys.length - limit; i++) await cache.delete(keys[i]);
}

async function put(cacheName, request, response) {
  if (!response || response.status !== 200 || response.type !== 'basic') return;
  const cache = await caches.open(cacheName);
  if (cacheName === DATA) {
    // A new version of a data file replaces the older ones (same path, other ?v=).
    const path = new URL(request.url).pathname;
    for (const key of await cache.keys()) {
      if (new URL(key.url).pathname === path && key.url !== request.url) await cache.delete(key);
    }
  }
  await cache.put(request, response);
  await trim(cacheName);
}

async function networkFirst(request, cacheName) {
  try {
    const response = await fetch(request);
    void put(cacheName, request, response.clone());
    return response;
  } catch (err) {
    const cached =
      (await caches.match(request, MATCH)) ??
      (request.mode === 'navigate' ? await caches.match('./', MATCH) : undefined);
    if (cached) return cached;
    throw err;
  }
}

async function cacheFirst(request, cacheName) {
  const cached = await caches.match(request, MATCH);
  if (cached) {
    if (cacheName === IMMUTABLE) void touch(cacheName, request, cached.clone());
    return cached;
  }
  const response = await fetch(request);
  void put(cacheName, request, response.clone());
  return response;
}

/** Moves an entry to the most-recently-used end (cache keys keep insertion order). */
async function touch(cacheName, request, response) {
  const cache = await caches.open(cacheName);
  await cache.delete(request, MATCH);
  await cache.put(request, response);
}

async function staleWhileRevalidate(request, cacheName) {
  const cached = await caches.match(request, MATCH);
  const refresh = fetch(request)
    .then((response) => {
      void put(cacheName, request, response.clone());
      return response;
    })
    .catch(() => undefined);
  return cached ?? (await refresh) ?? Response.error();
}

/** Cache for a same-origin URL, or undefined when it must not be cached (other origins, the worker itself). */
function cacheFor(url) {
  if (url.origin !== self.location.origin) return undefined;
  const path = url.pathname.slice(new URL(self.registration.scope).pathname.length);
  if (path === 'sw.js') return undefined;
  if (path.startsWith('assets/')) return IMMUTABLE;
  if (path.startsWith('data/') && url.searchParams.has('v')) return DATA;
  return RUNTIME;
}

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  const cacheName = cacheFor(url);
  if (!cacheName) return;
  const path = url.pathname.slice(new URL(self.registration.scope).pathname.length);

  if (request.mode === 'navigate') {
    event.respondWith(networkFirst(request, SHELL));
  } else if (cacheName === IMMUTABLE || cacheName === DATA) {
    event.respondWith(cacheFirst(request, cacheName));
  } else if (path === 'data/manifest.json') {
    event.respondWith(networkFirst(request, RUNTIME));
  } else {
    event.respondWith(staleWhileRevalidate(request, RUNTIME));
  }
});

/**
 * The first visit loads the page before this worker controls it: the page then sends the same-origin URLs it
 * already fetched (scripts, data, textures) so they are cached too. Replies "cached" when done.
 */
self.addEventListener('message', (event) => {
  const data = event.data;
  if (!data || data.type !== 'cache-urls' || !Array.isArray(data.urls)) return;
  const work = Promise.all(
    data.urls.map(async (href) => {
      const url = new URL(href, self.registration.scope);
      const cacheName = cacheFor(url);
      if (!cacheName || (await caches.match(url.href, MATCH))) return;
      try {
        await put(cacheName, new Request(url.href), await fetch(url.href));
      } catch {
        // Network hiccup: the next visit will cache it through the fetch handler.
      }
    }),
  ).then(() => event.source?.postMessage({ type: 'cached' }));
  event.waitUntil(work);
});
