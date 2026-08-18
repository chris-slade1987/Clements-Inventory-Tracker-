"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

// Admin-only banner to clear PAST-DUE reminders + audit follow-ups (due before
// today). Upcoming items — due today, this week, this month, and later — are
// kept. Reversible: reminders are dismissed and follow-ups closed, never deleted.
export default function ClearPastDueButton({
  counts,
}: {
  counts: { reminders: number; auditFollowUps: number; total: number };
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  if (counts.total === 0) return null;

  async function run() {
    if (
      !window.confirm(
        `Clear ${counts.total} past-due item${counts.total === 1 ? "" : "s"}?\n\n` +
          `• ${counts.reminders} manual reminder${counts.reminders === 1 ? "" : "s"} → dismissed\n` +
          `• ${counts.auditFollowUps} audit follow-up${counts.auditFollowUps === 1 ? "" : "s"} → closed\n\n` +
          `Anything due today, this week, this month, or later is kept. This is reversible — nothing is deleted.`
      )
    )
      return;
    setBusy(true);
    setMsg(null);
    const res = await fetch("/api/reminders/clear-past-due", { method: "POST" });
    const d = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) return setMsg(d.error ?? "Could not clear.");
    setMsg(`Cleared ${(d.reminders ?? 0) + (d.auditFollowUps ?? 0)} past-due item${(d.reminders ?? 0) + (d.auditFollowUps ?? 0) === 1 ? "" : "s"}.`);
    router.refresh();
  }

  return (
    <div className="mb-5 flex flex-wrap items-center gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 print:hidden">
      <div className="text-sm text-amber-900">
        <strong>{counts.total}</strong> past-due item{counts.total === 1 ? "" : "s"} on the dashboard
        {" "}({counts.reminders} reminder{counts.reminders === 1 ? "" : "s"}, {counts.auditFollowUps} audit follow-up{counts.auditFollowUps === 1 ? "" : "s"}).
        Upcoming items are kept.
      </div>
      <button
        onClick={run}
        disabled={busy}
        className="ml-auto rounded-lg bg-amber-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-amber-700 disabled:opacity-50"
      >
        {busy ? "Clearing…" : "Clear past-due"}
      </button>
      {msg ? <span className="w-full text-xs text-emerald-700">{msg}</span> : null}
    </div>
  );
}
