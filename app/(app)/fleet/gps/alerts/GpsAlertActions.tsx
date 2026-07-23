"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

// Acknowledge / Dismiss controls for one GPS alert (admin + manager). Posts to
// /api/gps/alert then refreshes so the alert leaves the open list.
export default function GpsAlertActions({ id }: { id: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState<"ack" | "dismiss" | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function act(action: "ack" | "dismiss") {
    setBusy(action);
    setError(null);
    try {
      const res = await fetch("/api/gps/alert", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, id }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) setError(data.error ?? "Action failed.");
      else router.refresh();
    } catch {
      setError("Network error.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex gap-2">
        <button
          onClick={() => act("ack")}
          disabled={busy !== null}
          data-testid="gps-alert-ack"
          className="rounded-lg border border-[#cfe0d6] bg-white px-3 py-1.5 text-xs font-medium text-[#0e1b15] hover:bg-[#eef5f0] disabled:opacity-50"
        >
          {busy === "ack" ? "…" : "Acknowledge"}
        </button>
        <button
          onClick={() => act("dismiss")}
          disabled={busy !== null}
          data-testid="gps-alert-dismiss"
          className="rounded-lg border border-line bg-white px-3 py-1.5 text-xs font-medium text-muted hover:bg-black/[0.03] disabled:opacity-50"
        >
          {busy === "dismiss" ? "…" : "Dismiss"}
        </button>
      </div>
      {error ? <span className="text-xs text-red-500">{error}</span> : null}
    </div>
  );
}
