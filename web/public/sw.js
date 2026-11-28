// AuctionHub service worker: installable app, offline shell, notification clicks.
// Live data (Supabase) is never cached; only the app's own static files.
// v2: the build-file cache now has a size limit; this clears v1's unlimited one.
const VERSION = "v2";
const SHELL = `shell-${VERSION}`;
const ASSETS = `assets-${VERSION}`;
// Enough for a few builds of every page's code; the oldest go first.
const MAX_ASSETS = 160;

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(SHELL).then((c) => c.addAll(["/", "/favicon.svg", "/icon-192.png"])).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== SHELL && k !== ASSETS).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

/** Drop the oldest entries beyond `max` (a cache lists its keys in the order they were added). */
async function trim(name, max) {
  const cache = await caches.open(name);
  const keys = await cache.keys();
  await Promise.all(keys.slice(0, Math.max(0, keys.length - max)).map((k) => cache.delete(k)));
}

/** Store a copy of `res`. The copy is taken now: once the page starts reading the body it can't be cloned. */
function keep(name, key, res, max) {
  const copy = res.clone();
  return caches
    .open(name)
    .then((c) => c.put(key, copy))
    .then(() => (max ? trim(name, max) : undefined))
    .catch(() => {});
}

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin || url.pathname.startsWith("/api/")) return;

  // Pages: always try the network first so deploys show up immediately; offline falls back to the shell.
  if (req.mode === "navigate") {
    event.respondWith(
      fetch(req)
        .then((res) => {
          if (res.ok && url.pathname === "/") event.waitUntil(keep(SHELL, "/", res));
          return res;
        })
        .catch(() => caches.match("/", { cacheName: SHELL })),
    );
    return;
  }

  // Hashed build files and icons never change: cache-first.
  if (url.pathname.startsWith("/assets/") || /\.(png|svg|webmanifest)$/.test(url.pathname)) {
    event.respondWith(
      caches.match(req).then(
        (hit) =>
          hit ||
          fetch(req).then((res) => {
            if (res.ok) event.waitUntil(keep(ASSETS, req, res, MAX_ASSETS));
            return res;
          }),
      ),
    );
  }
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = (event.notification.data && event.notification.data.url) || "/";
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((wins) => {
      for (const w of wins) {
        if ("focus" in w) {
          w.navigate(target);
          return w.focus();
        }
      }
      return self.clients.openWindow(target);
    }),
  );
});
