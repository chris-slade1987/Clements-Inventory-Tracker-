"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Card, btn } from "@/components/ui";

// Director/admin inline entry of an advisor's monthly funnel actuals. Used to run
// the board this month before the SmarterLaunch feed is connected; afterward the
// numbers flow in automatically and this stays as a manual override.
export default function FunnelEntryButton({
  advisorId, advisorName, periodKey, periodLabel, current,
}: {
  advisorId: string; advisorName: string; periodKey: string; periodLabel: string;
  current: { leadsCreated: number; proposalsMade: number; closedAmount: number };
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [f, setF] = useState(current);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setBusy(true); setError(null);
    const res = await fetch("/api/sales/funnel", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ advisorEmployeeId: advisorId, periodKey, ...f }),
    });
    const d = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) return setError(d.error ?? "Save failed.");
    setOpen(false);
    router.refresh();
  }

  return (
    <>
      <button onClick={() => { setF(current); setError(null); setOpen(true); }} className="text-[11px] font-medium text-brand-700 hover:underline">Edit</button>
      {open ? (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-end sm:items-center justify-center p-0 sm:p-4">
          <Card className="w-full sm:max-w-sm rounded-t-2xl sm:rounded-2xl p-5 space-y-3">
            <h3 className="text-base font-semibold">{advisorName} — {periodLabel}</h3>
            <Num label="Leads created" v={f.leadsCreated} on={(n) => setF({ ...f, leadsCreated: n })} />
            <Num label="Proposals made" v={f.proposalsMade} on={(n) => setF({ ...f, proposalsMade: n })} />
            <Num label="Closed ($ this month)" v={f.closedAmount} on={(n) => setF({ ...f, closedAmount: n })} step="0.01" />
            {error ? <p className="text-sm text-red-600">{error}</p> : null}
            <div className="flex gap-2 pt-1">
              <button onClick={() => setOpen(false)} className={btn.secondary}>Cancel</button>
              <button onClick={save} disabled={busy} className={`${btn.primary} flex-1`}>{busy ? "Saving…" : "Save"}</button>
            </div>
          </Card>
        </div>
      ) : null}
    </>
  );
}

function Num({ label, v, on, step }: { label: string; v: number; on: (n: number) => void; step?: string }) {
  return (
    <label className="block text-sm font-medium">{label}
      <input type="number" min={0} step={step ?? "1"} value={v} onChange={(e) => on(parseFloat(e.target.value) || 0)} className="mt-1 w-full rounded-lg border border-line px-3 py-2 text-sm" />
    </label>
  );
}
