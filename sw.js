/**
 * Service worker — THE HOOK, not the offline project.
 *
 * Copied in shape from the reference project's sw.js, which solved the one
 * conflict the roadmap blocked installed-PWA on: a worker must key its cache
 * off the build token or it serves stale modules and defeats the badge. The
 * cache name IS the token; scripts/bust.sh rewrites the constant below on
 * every bump, and test/pwa.mjs fails the suite if it ever stops matching
 * index.html. There is exactly one version number in this project.
 *
 * What is deliberately NOT here: a precache list. The sibling precaches ~70
 * known files for a cold offline boot; this game's runtime is GLBs, audio,
 * fonts and minigames, and the roadmap calls true-offline "a small dedicated
 * project — not bolted onto TD work". So this is a runtime cache only:
 * whatever a session has fetched is there for the next one, and an installed
 * shell boots from cache when the network is gone, but nothing is fetched
 * ahead of time. Precaching is the dedicated item.
 *
 * Update policy: NO unconditional skipWaiting(). A new worker sits in
 * `waiting` until every client is gone; reloading a WebGL game out from under
 * someone mid-wave is exactly what makes PWAs feel broken.
 */
const CB_TOKEN = '2b5e6f89';
const CACHE = `karyoku-${CB_TOKEN}`;

self.addEventListener('install', () => {
  // nothing to precache — see the header. Deliberately no skipWaiting().
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    if (self.registration.navigationPreload) {
      await self.registration.navigationPreload.enable();
    }
    // every cache that is not THIS token's is a previous build's
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
  if (event.data && event.data.type === 'GET_TOKEN' && event.source) {
    event.source.postMessage({ type: 'TOKEN', token: CB_TOKEN });
  }
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;   // never cache cross-origin opaques

  // Navigations: network-first with a short timeout, then the cache. The
  // HTML carries the fingerprints, so a stale copy of it pins everything else.
  if (request.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        const preload = await event.preloadResponse;
        if (preload) { void cachePut(request, preload.clone()); return preload; }
        const fresh = await withTimeout(fetch(request), 3000);
        void cachePut(request, fresh.clone());
        return fresh;
      } catch {
        return (await caches.match(request))
          || (await caches.match('./index.html'))
          || (await caches.match('./'))
          || Response.error();
      }
    })());
    return;
  }

  // Fingerprinted assets are immutable by construction: a changed file is a
  // changed URL, so cache-first is safe and there is nothing to revalidate.
  if (url.searchParams.has('v')) {
    event.respondWith(cacheFirst(request));
    return;
  }

  // Everything else — the vendored three build, GLBs, audio, fonts, the
  // minigames — is stale-while-revalidate: instant from cache, refreshed in
  // the background so the next load has the new copy.
  event.respondWith(staleWhileRevalidate(request));
});

async function cacheFirst(request) {
  const hit = await caches.match(request);
  if (hit) return hit;
  const res = await fetch(request);
  void cachePut(request, res.clone());
  return res;
}

async function staleWhileRevalidate(request) {
  const hit = await caches.match(request);
  const network = fetch(request)
    .then((res) => { void cachePut(request, res.clone()); return res; })
    .catch(() => hit || Response.error());
  return hit || network;
}

async function cachePut(request, response) {
  if (!response || !(response.status === 200 || response.status === 0)) return;
  const cache = await caches.open(CACHE);
  try { await cache.put(request, response); } catch { /* quota or opaque; not fatal */ }
}

function withTimeout(promise, ms) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), ms)),
  ]);
}
