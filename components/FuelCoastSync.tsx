"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Card, btn } from "@/components/ui";

// Admin control to pull fuel purchases from the Coast API on demand. The feed
// also runs automatically on a schedule (Vercel Cron every 6h); this is the
// "Refresh now" equivalent, mirroring the GPS Live Map Refresh.
export default function FuelCoastSync({
  configured,
  cursor,
  apiRowCount,
}: {
  configured: boolean;
  cursor: string | null;
  apiRowCount: number;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function sync() {
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch("/api/fleet/fuel/sync", { method: "POST" });
      const d = await res.json();
      if (!res.ok || d.ok === false) {
        setMsg(d.error ? `Sync failed: ${d.error}` : "Sync failed.");
      } else {
        setMsg(
          `Synced ${d.fetched} purchase${d.fetched === 1 ? "" : "s"} · ${d.created} new, ${d.updated} updated · ${d.linked} linked to a truck${d.unlinked ? `, ${d.unlinked} unlinked` : ""}.`,
        );
        router.refresh();
      }
    } catch (e) {
      setMsg(`Sync failed: ${e instanceof Error ? e.message : "error"}`);
    } finally {
      setBusy(false);
    }
  }

  const last = cursor ? new Date(cursor).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : null;

  return (
    <Card className="mb-4 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="text-sm font-semibold text-ink">Coast live sync</div>
          <div className="text-xs text-muted">
            {configured
              ? `Auto-syncs every 6 hours. ${apiRowCount} transaction${apiRowCount === 1 ? "" : "s"} pulled from Coast${last ? ` · synced through ${last}` : ""}.`
              : "Not connected — add COAST_API_KEY in the deployment settings to pull purchases automatically."}
          </div>
        </div>
        <button className={btn.primary} onClick={sync} disabled={busy || !configured}>
          {busy ? "Syncing…" : "Sync from Coast"}
        </button>
      </div>
      {msg ? <div className="mt-3 rounded-lg border border-line bg-black/[0.03] px-3 py-2 text-xs text-ink">{msg}</div> : null}
    </Card>
  );
}
