"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Card, btn } from "@/components/ui";
import { WAREHOUSE_SECTIONS, scoreWarehouse, WAREHOUSE_ITEMS, type Checks } from "@/lib/warehouse";

type Prefill = { date: string; inspectorName: string; checks: Record<string, boolean>; comments: Record<string, string>; notes: string };

function gradeColor(g: string) {
  if (g === "A" || g === "B") return "bg-emerald-100 text-emerald-700";
  if (g === "C") return "bg-amber-100 text-amber-700";
  return "bg-red-100 text-red-700";
}

export default function WarehouseForm({
  branch, year, month, isEdit, prefill,
}: {
  branch: string; year: number; month: number; isEdit: boolean; prefill: Prefill;
}) {
  const router = useRouter();
  const [date, setDate] = useState(prefill.date);
  const [inspectorName, setInspectorName] = useState(prefill.inspectorName);
  const [checks, setChecks] = useState<Checks>(prefill.checks ?? {});
  const [comments, setComments] = useState<Record<string, string>>(prefill.comments ?? {});
  const [notes, setNotes] = useState(prefill.notes);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const live = useMemo(() => scoreWarehouse(checks), [checks]);
  const critFails = WAREHOUSE_ITEMS.filter((it) => it.critical && checks[it.key] === false);
  const answered = WAREHOUSE_ITEMS.filter((it) => checks[it.key] != null).length;

  async function save() {
    setBusy(true); setError(null);
    const res = await fetch("/api/fleet/warehouse", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ branch, year, month, date, inspectorName, checks, comments, notes }),
    });
    const data = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) return setError(data.error ?? "Save failed.");
    setDone(true); router.refresh();
  }

  if (done) {
    return (
      <Card className="p-5 max-w-md">
        <div className="flex items-center gap-2 text-brand-700">
          <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth={2}><path d="M20 6 9 17l-5-5" strokeLinecap="round" strokeLinejoin="round" /></svg>
          <h2 className="text-lg font-semibold">Inspection saved</h2>
        </div>
        <p className="mt-2 text-sm text-muted">Grade <span className="font-semibold text-ink">{live.grade}</span> ({live.score}/{live.maxScore}, {live.scorePct}%).{critFails.length ? ` ${critFails.length} critical item flagged.` : ""}</p>
        <div className="mt-5 flex gap-2">
          <button onClick={() => router.push("/my-branch/warehouse")} className={btn.primary}>Back to warehouse</button>
          <button onClick={() => setDone(false)} className={btn.secondary}>Keep editing</button>
        </div>
      </Card>
    );
  }

  return (
    <div className="space-y-4 max-w-3xl pb-28">
      <Card className="p-4 grid gap-3 sm:grid-cols-2">
        <label className="block text-sm font-medium">Inspector
          <input value={inspectorName} onChange={(e) => setInspectorName(e.target.value)} className="mt-1 w-full rounded-lg border border-line px-3 py-2.5 text-sm" />
        </label>
        <label className="block text-sm font-medium">Date of inspection
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="mt-1 w-full rounded-lg border border-line px-3 py-2.5 text-sm text-ink" />
        </label>
      </Card>

      {WAREHOUSE_SECTIONS.map((sec) => (
        <div key={sec.section} className="space-y-2">
          <div className="text-sm font-semibold text-ink pt-1">{sec.section}</div>
          {sec.items.map((it) => {
            const val = checks[it.key];
            return (
              <Card key={it.key} className={`p-3 ${it.critical && val === false ? "ring-1 ring-red-300" : ""}`}>
                <div className="flex items-center gap-3">
                  <div className="flex-1 text-sm text-ink">
                    {it.label}
                    {it.critical ? <span className="ml-2 rounded-full bg-red-50 px-1.5 py-0.5 text-[10px] font-medium text-red-600 align-middle">critical</span> : null}
                  </div>
                  <div className="flex gap-1 rounded-xl bg-black/20 p-1">
                    <button onClick={() => setChecks((s) => ({ ...s, [it.key]: true }))} className={`rounded-lg px-4 py-2 text-xs font-medium transition-colors ${val === true ? "bg-emerald-grad text-[#05271c] shadow" : "text-mint hover:text-white"}`}>Yes</button>
                    <button onClick={() => setChecks((s) => ({ ...s, [it.key]: false }))} className={`rounded-lg px-4 py-2 text-xs font-medium transition-colors ${val === false ? "bg-red-500 text-white shadow" : "text-mint hover:text-white"}`}>No</button>
                  </div>
                </div>
                {val === false ? (
                  <input value={comments[it.key] ?? ""} onChange={(e) => setComments((s) => ({ ...s, [it.key]: e.target.value }))} placeholder="Corrective action needed" className="mt-2 w-full rounded-lg border border-amber-300 px-3 py-2 text-sm" />
                ) : null}
              </Card>
            );
          })}
        </div>
      ))}

      <Card className="p-4">
        <label className="block text-sm font-medium">Notes
          <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} className="mt-1 w-full rounded-lg border border-line px-3 py-2 text-sm" />
        </label>
      </Card>

      {error ? <p className="text-sm text-red-600">{error}</p> : null}

      <div className="fixed bottom-0 inset-x-0 sm:left-60 border-t border-line bg-surface/95 backdrop-blur px-4 py-3 z-20">
        <div className="max-w-3xl mx-auto flex items-center gap-4">
          <div className="flex items-center gap-3">
            <div className={`grid h-12 w-12 place-items-center rounded-full text-lg font-bold ${gradeColor(live.grade)}`}>{live.grade}</div>
            <div className="text-sm">
              <div className="font-semibold tabular-nums">{live.score}/{live.maxScore} · {live.scorePct}%</div>
              <div className="text-xs text-muted">{answered}/{WAREHOUSE_ITEMS.length} answered{critFails.length ? <span className="ml-2 text-red-600 font-medium">· {critFails.length} critical fail</span> : null}</div>
            </div>
          </div>
          <button onClick={save} disabled={busy} className={`${btn.primary} ml-auto`}>{busy ? "Saving…" : isEdit ? "Update inspection" : "Save inspection"}</button>
        </div>
      </div>
    </div>
  );
}
