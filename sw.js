/*
 * WhereTo service worker: makes the app installable and usable on patchy
 * mobile signal.
 *  - App files (hashed /assets/*): cache-first (they never change once built).
 *  - Place data (/data/*): network-first, cached copy only when offline - so places that closed
 *    disappear as soon as the data is updated.
 *  - Pages: network-first, falling back to the cached app when offline.
 *  - Map tiles: cache-first with a size cap, so areas you've looked at still show offline.
 * Live services (directions, photos, search) always go to the network.
 */
// Bumping the version clears every older cache (including stale place data) on the next visit.
const VERSION = "whereto-v3";
const APP = `${VERSION}-app`;
const DATA = `${VERSION}-data`;
const TILES = `${VERSION}-tiles`;
const MAX_TILES = 3000;

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(APP).then((c) => c.addAll(["./", "./index.html", "./manifest.webmanifest", "./icon-192.png", "./favicon.svg", "./brand/logo.svg", "./brand/wordmark.svg", "./brand/wordmark-dark.svg"])));
  self.skipWaiting();
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => !k.startsWith(VERSION)).map((k) => caches.delete(k)))),
  );
  self.clients.claim();
});

async function trimTiles() {
  const c = await caches.open(TILES);
  const keys = await c.keys();
  for (let i = 0; i < keys.length - MAX_TILES; i++) await c.delete(keys[i]);
}

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);

  // Same-origin app
  if (url.origin === self.location.origin) {
    if (url.pathname.includes("/__whereto")) return; // launcher keep-alive
    if (url.pathname.includes("/assets/")) {
      e.respondWith(caches.match(req).then((hit) => hit || fetch(req).then((res) => (caches.open(APP).then((c) => c.put(req, res.clone())), res))));
      return;
    }
    // World data tiles are read with range requests - the browser's own HTTP cache handles those.
    if (req.headers.has("range")) return;
    if (url.pathname.includes("/data/")) {
      e.respondWith(
        caches.open(DATA).then(async (c) => {
          try {
            const res = await fetch(req, { cache: "no-cache" });
            if (res.ok) c.put(req, res.clone());
            return res;
          } catch {
            // Offline: last downloaded copy (any version).
            return (await c.match(req, { ignoreSearch: true })) ?? Response.error();
          }
        }),
      );
      return;
    }
    if (url.pathname.includes("/brand/")) {
      e.respondWith(caches.match(req).then((hit) => hit || fetch(req)));
      return;
    }
    if (req.mode === "navigate") {
      e.respondWith(fetch(req).catch(() => caches.match("./index.html")));
      return;
    }
    return;
  }

  // Basemap tiles, styles, fonts and sprites
  if (url.hostname === "tiles.openfreemap.org") {
    e.respondWith(
      caches.open(TILES).then(async (c) => {
        const hit = await c.match(req);
        if (hit) return hit;
        const res = await fetch(req);
        if (res.ok) {
          c.put(req, res.clone());
          if (Math.random() < 0.02) trimTiles();
        }
        return res;
      }),
    );
  }
});
