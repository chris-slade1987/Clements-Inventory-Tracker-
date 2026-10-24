"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

// Manual "Refresh now" — forces a fresh NWS pull for the scope the viewer is allowed
// to see (own branch for a manager, the selected/all territories for an admin), then
// re-renders the server page. Refresh-on-read already keeps data fresh; this is for
// when a manager wants the very latest before heading out.
export default function RefreshButton({ scope }: { scope: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [pending, startTransition] = useTransition();

  async function refresh() {
    setBusy(true);
    try {
      await fetch(`/api/weather?branch=${encodeURIComponent(scope)}&brief=0&force=1`, { cache: "no-store" });
    } catch {
      /* non-fatal — the page still shows last-good data */
    } finally {
      setBusy(false);
      startTransition(() => router.refresh());
    }
  }

  return (
    <button
      onClick={refresh}
      disabled={busy || pending}
      className="inline-flex items-center gap-1.5 rounded-lg border border-line px-3 py-1.5 text-sm text-muted hover:bg-black/5 disabled:opacity-50"
    >
      <svg viewBox="0 0 24 24" className={`h-3.5 w-3.5 ${busy || pending ? "animate-spin" : ""}`} fill="none" stroke="currentColor" strokeWidth="1.8">
        <path d="M21 12a9 9 0 11-2.64-6.36M21 3v6h-6" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      {busy || pending ? "Refreshing…" : "Refresh now"}
    </button>
  );
}
