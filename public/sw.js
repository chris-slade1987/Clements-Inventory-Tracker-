// Minimal offline-friendly service worker for Clements Command & Control.
//
// IMPORTANT — per-user safety: authenticated pages are PER-USER. The service
// worker must NEVER store or replay an app page (HTML) or an RSC/data payload,
// because its Cache Storage is a single bucket keyed only by URL with no notion
// of who is signed in — caching `/my-branch` for one user and serving it to the
// next is exactly what caused the wrong "Welcome <name>". (The `no-store` header
// we set on authenticated responses is ignored by a service worker that calls
// cache.put itself, so the rule has to live HERE.)
//
// Strategy:
//   - Navigations + RSC/dynamic responses → NETWORK-ONLY, never cached. Offline,
//     a navigation falls back to the static /offline shell.
//   - Content-hashed / static assets (JS, CSS, fonts, images, icons) → cache-first
//     (safe: not user-specific, and a new deploy ships new filenames).
//   - API responses → always live (never touched).

const CACHE = "clements-cc-v6";
// Only non-user-specific shells are pre-cached. NEVER pre-cache an authenticated
// page (e.g. /dashboard) — that would be a per-user page in a shared cache.
const APP_SHELL = ["/offline"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(APP_SHELL).catch(() => {}))
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        // Purge every older cache — this flushes any per-user pages a previous
        // version of this worker may have stored.
        Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
      )
      .then(() => self.clients.claim())
  );
});

function isImmutableAsset(url) {
  return (
    url.pathname.startsWith("/_next/static/") ||
    /\.(?:css|woff2?|png|svg|ico|webp|jpe?g|gif)$/.test(url.pathname) ||
    // Build JS, but NOT the service worker itself (let the browser update it).
    (/\.js$/.test(url.pathname) && url.pathname !== "/sw.js")
  );
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  // Never touch API responses — inventory/HR data must be live.
  if (url.pathname.startsWith("/api/")) return;
  // Never intercept the worker script — the browser updates it out-of-band.
  if (url.pathname === "/sw.js") return;

  // Navigations: network-only; offline → the static offline shell. Never cached,
  // so one signed-in user's page can never be replayed to another.
  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request).catch(() => caches.match("/offline"))
    );
    return;
  }

  // Static, non-user-specific build assets → cache-first (and populate on miss).
  if (isImmutableAsset(url)) {
    event.respondWith(
      caches.match(request).then(
        (cached) =>
          cached ||
          fetch(request).then((res) => {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(request, copy));
            return res;
          })
      )
    );
    return;
  }

  // Everything else — RSC payloads and any other dynamic/per-user response.
  // NETWORK-ONLY and never cached (an RSC page body is as user-specific as the
  // HTML). Let the browser handle offline failures normally.
  // (No event.respondWith → the request passes through to the network untouched.)
});
