"use client";

import { useEffect } from "react";

/**
 * Registers the service worker for offline-friendly PWA behaviour.
 * Kept intentionally small; the SW itself lives at /public/sw.js.
 */
export default function ServiceWorkerRegister() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production") return;
    if (!("serviceWorker" in navigator)) return;

    const onLoad = () => {
      navigator.serviceWorker.register("/sw.js").catch(() => {
        /* Registration failures are non-fatal for the app. */
      });
    };
    window.addEventListener("load", onLoad);
    return () => window.removeEventListener("load", onLoad);
  }, []);

  return null;
}
