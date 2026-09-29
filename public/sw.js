// Roots & Branches service worker: app shell offline, automatic update.
// The version comes from the registration URL (sw.js?v=<app version>), so every deploy installs
// a fresh worker and old caches are dropped.
const VERSION = new URL(self.location.href).searchParams.get("v") || "dev";
const CACHE = `rb-${VERSION}`;
const SCOPE = self.registration.scope;

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE).then((c) => c.addAll([SCOPE, `${SCOPE}manifest.webmanifest`, `${SCOPE}icons/icon-192.png`]).catch(() => {})),
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith("rb-") && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin || url.pathname.includes("/api/")) return;

  // Immutable build assets and icons: cache first.
  if (url.pathname.includes("/_next/static/") || url.pathname.includes("/icons/")) {
    event.respondWith(
      caches.match(req).then((hit) => hit || fetch(req).then((res) => {
        if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); }
        return res;
      })),
    );
    return;
  }

  // Pages: network first, cached copy when offline (query string ignored: /tree?id=…).
  if (req.mode === "navigate") {
    event.respondWith(
      fetch(req)
        .then((res) => {
          if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(new Request(url.origin + url.pathname), copy)); }
          return res;
        })
        .catch(async () => (await caches.match(url.origin + url.pathname, { ignoreSearch: true })) || (await caches.match(SCOPE)) || Response.error()),
    );
  }
});
