"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import SalesCoachButton from "@/components/SalesCoachButton";

// Director-only tools above the dashboard: an on-demand AI team briefing, and a
// load/clear for the sample data that runs the board until SmarterLaunch is
// connected. Once SmarterLaunch is `live`, the board shows the real feed, so the
// "Load sample data" control is hidden; a one-time "Clear sample data" remains
// while leftover demo rows exist so the director can wipe them at cutover.
export default function SalesDirectorTools({ periodKey, hasDemo, live = false }: { periodKey: string; hasDemo: boolean; live?: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function demo(action: "load" | "clear") {
    setBusy(true); setMsg(null);
    try {
      const res = await fetch("/api/sales/demo", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action }) });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) { setMsg(d.error ?? "Failed."); return; }
      setMsg(action === "load" ? `Loaded sample data for ${d.loaded} advisor(s)${typeof d.leads === "number" ? ` + ${d.leads} sample leads` : ""}.` : `Cleared ${d.cleared} sample row(s).`);
      router.refresh();
    } finally { setBusy(false); }
  }

  return (
    <div className="mb-5 rounded-xl border border-line bg-surface p-4">
      <SalesCoachButton scope="team" periodKey={periodKey} label="AI team briefing" />
      {live ? (
        // SmarterLaunch is connected — the board reads the live lead feed. Keep only
        // a one-time clear for any leftover sample rows.
        hasDemo ? (
          <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-line pt-3">
            <span className="text-xs text-muted">SmarterLaunch is connected — the board is live.</span>
            <button onClick={() => demo("clear")} disabled={busy} className="rounded-lg border border-line px-3 py-1.5 text-xs font-medium text-muted hover:text-ink disabled:opacity-50">Clear leftover sample data</button>
            {msg ? <span className="text-xs font-medium text-brand-700">{msg}</span> : null}
          </div>
        ) : null
      ) : (
        <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-line pt-3">
          <span className="text-xs text-muted">Until SmarterLaunch is connected:</span>
          <button onClick={() => demo("load")} disabled={busy} className="rounded-lg border border-brand-300 px-3 py-1.5 text-xs font-medium text-brand-700 hover:bg-brand-50 disabled:opacity-50">{busy ? "Working…" : "Load sample data"}</button>
          {hasDemo ? <button onClick={() => demo("clear")} disabled={busy} className="rounded-lg border border-line px-3 py-1.5 text-xs font-medium text-muted hover:text-ink disabled:opacity-50">Clear sample data</button> : null}
          {msg ? <span className="text-xs font-medium text-brand-700">{msg}</span> : null}
        </div>
      )}
    </div>
  );
}
