"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Card, btn } from "@/components/ui";
import { WEEKLY_EQUIPMENT_ITEMS } from "@/lib/warehouse";

// Weekly emergency-equipment check — OSHA expects eyewash stations activated
// weekly. A fast per-branch tick, separate from the monthly inspection.
export default function WeeklyCheck({ branch, weekStart, done, prefill, canLog }: {
  branch: string; weekStart: string; done: boolean; prefill: { checks: Record<string, boolean>; note: string } | null; canLog: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [checks, setChecks] = useState<Record<string, boolean>>(prefill?.checks ?? Object.fromEntries(WEEKLY_EQUIPMENT_ITEMS.map((i) => [i.key, true])));
  const [note, setNote] = useState(prefill?.note ?? "");
  const [busy, setBusy] = useState(false);
  const label = new Date(weekStart + "T00:00:00Z").toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });

  async function save() {
    setBusy(true);
    const res = await fetch("/api/fleet/warehouse", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "weeklyCheck", branch, checks, note }) });
    setBusy(false);
    if (res.ok) { setOpen(false); router.refresh(); }
  }

  return (
    <Card className="p-4 mb-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="text-sm font-medium text-ink">Weekly emergency-equipment check <span className="text-xs font-normal text-muted">· week of {label}</span></div>
          <div className="mt-0.5 text-xs text-muted">OSHA: activate/flush the eyewash station weekly. Quick confirm of eyewash, spill kit, exits &amp; extinguishers.</div>
        </div>
        {done
          ? <span className="rounded-full bg-brand-100 px-2 py-0.5 text-[11px] font-medium text-brand-700">Logged this week</span>
          : <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-700">Not logged this week</span>}
      </div>
      {canLog ? (
        !open ? (
          <button onClick={() => setOpen(true)} className={`${btn.secondary} mt-3`}>{done ? "Update this week" : "Log this week"}</button>
        ) : (
          <div className="mt-3 space-y-2">
            {WEEKLY_EQUIPMENT_ITEMS.map((it) => (
              <div key={it.key} className="flex items-center justify-between gap-3">
                <span className="text-sm text-ink">{it.label}</span>
                <div className="flex gap-1 rounded-xl bg-slate-100 p-1">
                  <button onClick={() => setChecks((s) => ({ ...s, [it.key]: true }))} className={`rounded-lg px-3 py-1.5 text-xs font-medium ${checks[it.key] ? "bg-emerald-grad text-white shadow" : "text-slate-600"}`}>OK</button>
                  <button onClick={() => setChecks((s) => ({ ...s, [it.key]: false }))} className={`rounded-lg px-3 py-1.5 text-xs font-medium ${checks[it.key] === false ? "bg-red-500 text-white shadow" : "text-slate-600"}`}>Issue</button>
                </div>
              </div>
            ))}
            <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Note (optional)" className="w-full rounded-lg border border-line px-3 py-2 text-sm" />
            <div className="flex gap-2">
              <button onClick={save} disabled={busy} className={btn.primary}>{busy ? "Saving…" : "Save weekly check"}</button>
              <button onClick={() => setOpen(false)} className="text-xs font-medium text-muted hover:text-ink">Cancel</button>
            </div>
          </div>
        )
      ) : null}
    </Card>
  );
}
