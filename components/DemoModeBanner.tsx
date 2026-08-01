"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

// Slim, tasteful banner shown ONLY in demo mode (the mounting layout is
// responsible for rendering it only when isDemoMode() is true). Admins get a
// one-click "Reset demo data" button that POSTs to /api/demo/reset and refreshes.
// Matches the app's dark forest/emerald aesthetic.
export default function DemoModeBanner({ isAdmin = false }: { isAdmin?: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function reset() {
    if (busy) return;
    if (!confirm("Reset the demo data? This clears and reseeds only demo-marked rows — real data is untouched.")) {
      return;
    }
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch("/api/demo/reset", { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data?.ok) {
        setMsg("Demo data reset.");
        router.refresh();
      } else {
        setMsg(data?.error ?? "Reset failed.");
      }
    } catch {
      setMsg("Reset failed.");
    } finally {
      setBusy(false);
    }
  }

  async function turnOff() {
    if (busy) return;
    if (!confirm("Turn OFF demo mode? This clears the demo sample data (real data is untouched).")) return;
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch("/api/demo/toggle", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ on: false }) });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data?.ok) router.refresh();
      else setMsg(data?.error ?? "Could not turn off demo mode.");
    } catch {
      setMsg("Could not turn off demo mode.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-wrap items-center justify-between gap-2 border-b border-emerald-400/25 bg-emerald-950/80 px-4 py-2 text-sm text-emerald-100">
      <div className="flex items-center gap-2">
        <span className="inline-flex h-2 w-2 shrink-0 rounded-full bg-emerald-400" aria-hidden />
        <span className="font-medium">Demo environment</span>
        <span className="text-emerald-200/80">— sample data, safe to click around.</span>
      </div>
      {isAdmin ? (
        <div className="flex items-center gap-3">
          {msg ? <span className="text-emerald-200/80">{msg}</span> : null}
          <button
            type="button"
            onClick={reset}
            disabled={busy}
            className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-400/40 bg-emerald-900/60 px-3 py-1.5 text-xs font-medium text-emerald-50 hover:bg-emerald-800/60 disabled:opacity-50 transition-colors"
          >
            {busy ? "Working…" : "Reset demo data"}
          </button>
          <button
            type="button"
            onClick={turnOff}
            disabled={busy}
            className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-400/20 px-3 py-1.5 text-xs font-medium text-emerald-100/80 hover:bg-emerald-900/50 disabled:opacity-50 transition-colors"
          >
            Turn off
          </button>
        </div>
      ) : null}
    </div>
  );
}
