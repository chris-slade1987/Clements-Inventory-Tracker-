"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

// Leadership credit for a month's routing sign-off. Everyone sees the "Credited"
// banner; only super admins see the Credit / Remove credit controls.
export default function RoutingCredit({
  branch,
  periodKey,
  monthLabel,
  branchName,
  credited,
  canCredit,
}: {
  branch: string;
  periodKey: string;
  monthLabel: string;
  branchName: string;
  credited: { at: string; by: string | null; note: string | null } | null;
  canCredit: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function call(action: "credit" | "uncredit") {
    if (action === "uncredit" && !window.confirm(`Remove the credit? ${branchName}'s ${monthLabel} routing will need a real sign-off again.`)) return;
    setBusy(true);
    setError(null);
    const res = await fetch("/api/routing-approval", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, branch, periodKey, note }),
    });
    const out = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) return setError(out.error ?? "Something went wrong.");
    setOpen(false);
    setNote("");
    router.refresh();
  }

  if (credited) {
    const date = new Date(credited.at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
    return (
      <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <span className="font-semibold">Credited as complete</span>
            {credited.by ? ` by ${credited.by}` : ""} on {date}. {monthLabel} routing counts as signed off for {branchName}.
            {credited.note ? <div className="mt-0.5 text-xs text-emerald-800">{credited.note}</div> : null}
          </div>
          {canCredit ? (
            <button type="button" onClick={() => call("uncredit")} disabled={busy} className="text-xs font-medium text-emerald-800 underline disabled:opacity-50">
              Remove credit
            </button>
          ) : null}
        </div>
        {error ? <p className="mt-1 text-xs text-red-600">{error}</p> : null}
      </div>
    );
  }

  if (!canCredit) return null;

  return (
    <div className="rounded-xl border border-line bg-white px-4 py-3">
      {open ? (
        <div className="space-y-2">
          <div className="text-sm font-medium text-ink">Credit {branchName}&rsquo;s {monthLabel} routing as complete</div>
          <p className="text-xs text-muted">
            Use when the manager did the work but it can&rsquo;t be signed yet (for example, their requested route changes are waiting on the routing department).
            The credit counts on their to-dos, clears any missed-duty strike, and stays in place when revised routes are uploaded.
          </p>
          <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} placeholder="Reason (required)" className="w-full rounded-lg border border-line px-3 py-2 text-sm" />
          {error ? <p className="text-xs text-red-600">{error}</p> : null}
          <div className="flex gap-2">
            <button type="button" onClick={() => call("credit")} disabled={busy || !note.trim()} className="rounded-xl bg-emerald-grad px-4 py-2.5 text-sm font-medium text-white shadow-sm disabled:opacity-50">
              {busy ? "Crediting…" : "Credit as complete"}
            </button>
            <button type="button" onClick={() => setOpen(false)} className="rounded-xl border border-line px-4 py-2.5 text-sm text-ink">Cancel</button>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-xs text-muted">Super admin: manager did the routing work but it can&rsquo;t be signed yet?</span>
          <button type="button" onClick={() => setOpen(true)} className="rounded-lg border border-line px-3 py-1.5 text-xs font-medium text-ink hover:bg-black/[0.03]">
            Credit as complete
          </button>
        </div>
      )}
    </div>
  );
}
