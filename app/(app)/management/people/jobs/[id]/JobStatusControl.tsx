"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { JOB_STATUS_LABELS } from "@/lib/ats-config";

const STATUSES = ["open", "on_hold", "filled", "closed"];

export default function JobStatusControl({ id, status }: { id: string; status: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function change(next: string) {
    if (next === status) return;
    setBusy(true);
    const res = await fetch("/api/ats", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "job.update", id, status: next }),
    });
    setBusy(false);
    if (res.ok) router.refresh();
  }

  return (
    <label className="text-xs text-muted flex items-center gap-2">
      Status
      <select
        value={status}
        disabled={busy}
        onChange={(e) => change(e.target.value)}
        className="rounded-lg border border-line px-2.5 py-1.5 text-sm bg-surface text-ink"
      >
        {STATUSES.map((s) => <option key={s} value={s}>{JOB_STATUS_LABELS[s]}</option>)}
      </select>
    </label>
  );
}
