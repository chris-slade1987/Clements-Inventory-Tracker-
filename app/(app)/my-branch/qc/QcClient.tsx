"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Card, btn } from "@/components/ui";

type QcType = "ghp" | "lo";
type Item = { id: string; label: string };
type Result = "pass" | "fail" | "na";
type Progress = { ghp: number; lo: number; goalPerType: number; goalTotal: number; total: number; complete: boolean };
type Tech = { id: string; name: string };
type Recent = {
  id: string; type: string; acctNumber: string; customer: string;
  technicianName: string; technicianEmployeeId: string | null;
  inspectionDate: string; passCount: number; failCount: number; periodKey: string;
};

const todayISO = () => new Date().toISOString().slice(0, 10);
const shortOf = (t: string) => (t === "ghp" ? "GHP" : "L&O");
const DATE = (iso: string) => new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });

export default function QcClient({
  branch, branchLabel, branches, canComplete, technicians, progress, monthLabel, reviewerName,
  types, forms, recent, thisMonthKey,
}: {
  branch: string;
  branchLabel: string;
  branches: { key: string; label: string }[];
  canComplete: boolean;
  technicians: Tech[];
  progress: Progress;
  monthLabel: string;
  reviewerName: string;
  types: { key: QcType; label: string; short: string }[];
  forms: Record<string, Item[]>;
  recent: Recent[];
  thisMonthKey: string;
}) {
  const router = useRouter();
  const [openType, setOpenType] = useState<QcType | null>(null);

  return (
    <div className="space-y-5">
      {/* Monthly progress */}
      <div className="grid gap-3 sm:grid-cols-3">
        <ProgressCard label="GHP this month" value={progress.ghp} goal={progress.goalPerType} />
        <ProgressCard label="L&O this month" value={progress.lo} goal={progress.goalPerType} />
        <ProgressCard label="Total" value={progress.total} goal={progress.goalTotal} accent />
      </div>
      <p className="text-xs text-muted -mt-2">
        {monthLabel} · goal 10 GHP + 10 L&O. Completing all 20 satisfies the Quality Control item on your quarterly scorecard.
      </p>

      {/* New inspection */}
      {canComplete ? (
        openType ? (
          <QcForm
            type={openType}
            items={forms[openType] ?? []}
            typeLabel={types.find((t) => t.key === openType)?.label ?? openType}
            branch={branch}
            branches={branches}
            technicians={technicians}
            reviewerName={reviewerName}
            onCancel={() => setOpenType(null)}
            onDone={() => { setOpenType(null); router.refresh(); }}
          />
        ) : (
          <div className="flex flex-wrap gap-3">
            {types.map((t) => (
              <button key={t.key} onClick={() => setOpenType(t.key)} className={`${btn.primary}`}>
                New {t.short} inspection
              </button>
            ))}
          </div>
        )
      ) : null}

      {/* Archive */}
      <Card className="p-0 overflow-hidden">
        <div className="px-5 py-3 border-b border-line text-sm font-medium text-ink">
          Quality Control archive — {branchLabel}
        </div>
        {recent.length === 0 ? (
          <p className="px-5 py-6 text-sm text-muted">No inspections yet. Start one above.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-muted border-b border-line">
                  <th className="py-2 px-4 font-medium">Date</th>
                  <th className="py-2 px-4 font-medium">Type</th>
                  <th className="py-2 px-4 font-medium">Account</th>
                  <th className="py-2 px-4 font-medium">Customer</th>
                  <th className="py-2 px-4 font-medium">Technician</th>
                  <th className="py-2 px-4 font-medium text-right">Result</th>
                </tr>
              </thead>
              <tbody>
                {recent.map((r) => (
                  <tr key={r.id} className="border-b border-line last:border-0">
                    <td className="py-2 px-4 whitespace-nowrap text-muted">{DATE(r.inspectionDate)}{r.periodKey === thisMonthKey ? <span className="ml-1 rounded bg-emerald-100 px-1 text-[10px] text-emerald-700">this month</span> : null}</td>
                    <td className="py-2 px-4"><span className="rounded-full bg-black/5 px-2 py-0.5 text-[11px]">{shortOf(r.type)}</span></td>
                    <td className="py-2 px-4 text-ink">{r.acctNumber}</td>
                    <td className="py-2 px-4 text-ink">{r.customer}</td>
                    <td className="py-2 px-4 text-ink">
                      {r.technicianEmployeeId ? <a href={`/my-branch/team/${r.technicianEmployeeId}`} className="text-brand-700 hover:underline">{r.technicianName}</a> : r.technicianName}
                    </td>
                    <td className="py-2 px-4 text-right whitespace-nowrap tabular-nums">
                      <span className="text-emerald-700">{r.passCount}✓</span>{r.failCount > 0 ? <span className="ml-1 text-red-600">{r.failCount}✗</span> : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}

function ProgressCard({ label, value, goal, accent }: { label: string; value: number; goal: number; accent?: boolean }) {
  const pct = goal > 0 ? Math.min(100, Math.round((value / goal) * 100)) : 0;
  const met = value >= goal;
  return (
    <Card className="p-4">
      <div className="text-[11px] font-semibold uppercase tracking-wide text-muted">{label}</div>
      <div className={`mt-1 text-2xl font-bold tabular-nums ${met ? "text-emerald-700" : accent ? "text-ink" : "text-ink"}`}>
        {value}<span className="text-base font-normal text-muted">/{goal}</span>
      </div>
      <div className="mt-2 h-1.5 w-full rounded-full bg-black/10 overflow-hidden">
        <div className={`h-full ${met ? "bg-emerald-500" : "bg-brand-500"}`} style={{ width: `${pct}%` }} />
      </div>
    </Card>
  );
}

const RESULTS: { key: Result; label: string; cls: string }[] = [
  { key: "pass", label: "Pass", cls: "bg-emerald-600 text-white" },
  { key: "fail", label: "Fail", cls: "bg-red-600 text-white" },
  { key: "na", label: "N/A", cls: "bg-slate-500 text-white" },
];

function QcForm({
  type, items, typeLabel, branch, branches, technicians, reviewerName, onCancel, onDone,
}: {
  type: QcType;
  items: Item[];
  typeLabel: string;
  branch: string;
  branches: { key: string; label: string }[];
  technicians: Tech[];
  reviewerName: string;
  onCancel: () => void;
  onDone: () => void;
}) {
  const [acctNumber, setAcct] = useState("");
  const [customerFirst, setFirst] = useState("");
  const [customerLast, setLast] = useState("");
  const [lastTreatment, setLastTreatment] = useState("");
  const [inspectionDate, setInspectionDate] = useState(todayISO());
  const [technicianEmployeeId, setTech] = useState("");
  const [results, setResults] = useState<Record<string, Result>>({});
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const graded = items.filter((it) => results[it.id]).length;

  async function submit() {
    if (!acctNumber.trim()) return setError("Enter the account number.");
    if (!customerFirst.trim() || !customerLast.trim()) return setError("Enter the customer's first and last name.");
    if (!technicianEmployeeId) return setError("Select the technician being evaluated.");
    if (graded < items.length) return setError("Grade every item (Pass / Fail / N/A).");
    setBusy(true); setError(null);
    const res = await fetch("/api/qc", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type, branch, acctNumber, customerFirst, customerLast,
        lastTreatment: lastTreatment || null, inspectionDate,
        technicianEmployeeId,
        results: items.map((it) => ({ itemId: it.id, result: results[it.id] })),
        notes,
      }),
    });
    const d = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) return setError(d.error ?? "Could not submit.");
    onDone();
  }

  return (
    <Card className="p-0 overflow-hidden">
      <div className="px-5 py-3 border-b border-line flex items-center justify-between">
        <div className="text-sm font-semibold text-ink">{typeLabel} — QC inspection</div>
        <button onClick={onCancel} className="text-xs text-muted hover:underline">Cancel</button>
      </div>

      {/* Location / account header */}
      <div className="px-5 py-4 grid gap-3 sm:grid-cols-2 border-b border-line">
        <Field label="Account number (PestPac)"><input value={acctNumber} onChange={(e) => setAcct(e.target.value)} className={inputCls} placeholder="e.g. 100482" /></Field>
        <Field label="Technician being evaluated">
          <select value={technicianEmployeeId} onChange={(e) => setTech(e.target.value)} className={inputCls}>
            <option value="">Select a technician…</option>
            {technicians.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        </Field>
        <Field label="Customer first name"><input value={customerFirst} onChange={(e) => setFirst(e.target.value)} className={inputCls} placeholder="As on the PestPac account" /></Field>
        <Field label="Customer last name"><input value={customerLast} onChange={(e) => setLast(e.target.value)} className={inputCls} placeholder="As on the PestPac account" /></Field>
        <Field label="Date of last treatment"><input type="date" value={lastTreatment} onChange={(e) => setLastTreatment(e.target.value)} className={inputCls} /></Field>
        <Field label="Date of inspection"><input type="date" value={inspectionDate} onChange={(e) => setInspectionDate(e.target.value)} className={inputCls} /></Field>
      </div>

      {/* Grading items */}
      <div className="px-5 py-3 border-b border-line flex items-center justify-between">
        <div className="text-sm font-medium text-ink">Inspection</div>
        <div className="text-xs tabular-nums text-muted">{graded}/{items.length} graded</div>
      </div>
      <ul className="divide-y divide-line">
        {items.map((it) => (
          <li key={it.id} className="px-5 py-3 flex flex-wrap items-center gap-3 justify-between">
            <span className="text-[15px] text-ink flex-1 min-w-[12rem]">{it.label}</span>
            <div className="flex gap-1">
              {RESULTS.map((r) => {
                const active = results[it.id] === r.key;
                return (
                  <button
                    key={r.key}
                    type="button"
                    onClick={() => setResults((s) => ({ ...s, [it.id]: r.key }))}
                    className={`rounded-lg px-3 py-1 text-xs font-medium border ${active ? r.cls + " border-transparent" : "border-line text-muted hover:border-brand-300"}`}
                  >
                    {r.label}
                  </button>
                );
              })}
            </div>
          </li>
        ))}
      </ul>

      <div className="px-5 py-4 space-y-3">
        <Field label="Notes / findings (optional)">
          <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} className={inputCls} placeholder="Anything to pass along to the technician…" />
        </Field>
        <p className="text-xs text-muted">
          Signing files this inspection to <strong className="text-ink">{technicians.find((t) => t.id === technicianEmployeeId)?.name ?? "the technician"}</strong>&rsquo;s profile and emails it to them. Reviewer: {reviewerName}.
        </p>
        {error ? <p className="text-sm text-red-600">{error}</p> : null}
        <button onClick={submit} disabled={busy} className={`${btn.primary} w-full`}>{busy ? "Submitting…" : "Complete & send to technician"}</button>
      </div>
    </Card>
  );
}

const inputCls = "w-full rounded-lg border border-line px-3 py-2 text-sm bg-surface";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <div className="text-[11px] font-semibold uppercase tracking-wide text-muted mb-1">{label}</div>
      {children}
    </label>
  );
}
