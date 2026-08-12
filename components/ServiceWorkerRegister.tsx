"use client";

import { useEffect } from "react";

/**
 * Registers the service worker for offline-friendly PWA behaviour AND keeps it
 * from serving a stale/mixed build.
 *
 * Without update handling, a new deploy can leave an installed PWA running old
 * JS while pulling some new files — so pages (the live map, GPS analytics, …)
 * intermittently fail to load until a manual hard refresh. Here we:
 *   1. poll for a new service worker, and
 *   2. reload exactly once when a new worker takes control (`controllerchange`),
 * so the page always lands on a single, consistent build.
 */
export default function ServiceWorkerRegister() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production") return;
    if (!("serviceWorker" in navigator)) return;

    // Reload once when the active worker changes to a new build. Guarded so it
    // can never loop (the new build controls the page after the reload, so no
    // further controllerchange fires).
    let refreshing = false;
    const onControllerChange = () => {
      if (refreshing) return;
      refreshing = true;
      window.location.reload();
    };
    navigator.serviceWorker.addEventListener("controllerchange", onControllerChange);

    let interval: ReturnType<typeof setInterval> | undefined;
    const onLoad = () => {
      navigator.serviceWorker
        .register("/sw.js")
        .then((reg) => {
          // Check for a new deploy now, on tab focus, and periodically.
          reg.update().catch(() => {});
          const check = () => reg.update().catch(() => {});
          document.addEventListener("visibilitychange", () => {
            if (document.visibilityState === "visible") check();
          });
          interval = setInterval(check, 60_000);
        })
        .catch(() => {
          /* Registration failures are non-fatal for the app. */
        });
    };
    window.addEventListener("load", onLoad);

    return () => {
      window.removeEventListener("load", onLoad);
      navigator.serviceWorker.removeEventListener("controllerchange", onControllerChange);
      if (interval) clearInterval(interval);
    };
  }, []);

  return null;
}
