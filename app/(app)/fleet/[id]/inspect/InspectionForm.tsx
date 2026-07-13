"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Card, btn } from "@/components/ui";
import {
  CONDITION_ITEMS,
  RATING_SCALE,
  CHECK_ITEMS,
  MAX_SCORE,
  scoreInspection,
  gradeLetter,
  type Ratings,
  type Checks,
} from "@/lib/inspection";

const MONTHS = ["", "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

type Prefill = {
  date: string;
  technicianName: string;
  inspectorName: string;
  mileage: string;
  oilChangeLast: string;
  oilChangeNext: string;
  tireRotationLast: string;
  tireRotationNext: string;
  otherMaintLast: string;
  otherMaintNext: string;
  notes: string;
  ratings: Record<string, number>;
  ratingIssues: Record<string, string>;
  checks: Record<string, boolean>;
};

export default function InspectionForm({
  vehicleId,
  vehicleLabel,
  year,
  month,
  isEdit,
  prefill,
}: {
  vehicleId: string;
  vehicleLabel: string;
  year: number;
  month: number;
  isEdit: boolean;
  prefill: Prefill;
}) {
  const router = useRouter();
  const [f, setF] = useState({
    date: prefill.date,
    technicianName: prefill.technicianName,
    inspectorName: prefill.inspectorName,
    mileage: prefill.mileage,
    oilChangeLast: prefill.oilChangeLast,
    oilChangeNext: prefill.oilChangeNext,
    tireRotationLast: prefill.tireRotationLast,
    tireRotationNext: prefill.tireRotationNext,
    otherMaintLast: prefill.otherMaintLast,
    otherMaintNext: prefill.otherMaintNext,
    notes: prefill.notes,
  });
  const [ratings, setRatings] = useState<Ratings>(prefill.ratings ?? {});
  const [ratingIssues, setRatingIssues] = useState<Record<string, string>>(prefill.ratingIssues ?? {});
  const [checks, setChecks] = useState<Checks>(prefill.checks ?? {});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const set = (patch: Partial<typeof f>) => setF((s) => ({ ...s, ...patch }));

  const live = useMemo(() => scoreInspection(ratings, checks), [ratings, checks]);
  const critFails = CHECK_ITEMS.filter((it) => it.critical && checks[it.key] === false);
  const answered = CONDITION_ITEMS.filter((it) => ratings[it.key]).length + CHECK_ITEMS.filter((it) => checks[it.key] != null).length;
  const totalItems = CONDITION_ITEMS.length + CHECK_ITEMS.length;

  async function save() {
    setBusy(true);
    setError(null);
    const res = await fetch("/api/fleet/inspection", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ vehicleId, year, month, ...f, ratings, ratingIssues, checks }),
    });
    const data = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) return setError(data.error ?? "Save failed.");
    setDone(true);
    router.refresh();
  }

  if (done) {
    return (
      <Card className="p-5 max-w-md">
        <div className="flex items-center gap-2 text-brand-700">
          <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth={2}><path d="M20 6 9 17l-5-5" strokeLinecap="round" strokeLinejoin="round" /></svg>
          <h2 className="text-lg font-semibold">Inspection saved</h2>
        </div>
        <p className="mt-2 text-sm text-muted">
          {vehicleLabel} — {MONTHS[month]} {year}. Grade <span className="font-semibold text-ink">{live.grade}</span> ({live.score}/{MAX_SCORE}, {live.scorePct}%).
          {critFails.length > 0 ? ` ${critFails.length} critical item flagged for follow-up.` : ""}
        </p>
        <div className="mt-5 flex gap-2">
          <button onClick={() => router.push(`/fleet/${vehicleId}`)} className={btn.primary}>Back to vehicle</button>
          <button onClick={() => setDone(false)} className={btn.secondary}>Keep editing</button>
        </div>
      </Card>
    );
  }

  return (
    <div className="space-y-4 max-w-3xl pb-28">
      {/* Header */}
      <Card className="p-4 grid gap-3 sm:grid-cols-2">
        <div className="sm:col-span-2 text-xs uppercase tracking-wider text-muted">
          Inspection period · <span className="text-ink font-medium">{MONTHS[month]} {year}</span>
          {isEdit ? <span className="ml-2 rounded-full bg-amber-100 px-2 py-0.5 text-[11px] text-amber-700">Editing existing</span> : null}
        </div>
        <Field label="Technician (assigned driver)" v={f.technicianName} on={(v) => set({ technicianName: v })} />
        <Field label="Inspector (manager)" v={f.inspectorName} on={(v) => set({ inspectorName: v })} />
        <label className="block text-sm font-medium">Inspection date
          <input type="date" value={f.date} onChange={(e) => set({ date: e.target.value })} className="mt-1 w-full rounded-lg border border-line px-3 py-2.5 text-sm text-ink" />
        </label>
        <Field label="Mileage" v={f.mileage} on={(v) => set({ mileage: v })} hint="Pre-filled from file; updating syncs the vehicle" />
      </Card>

      {/* Section A — condition ratings */}
      <SectionTitle n="A" title="Condition" hint="Rate each area." />
      <div className="space-y-2">
        {CONDITION_ITEMS.map((it) => (
          <Card key={it.key} className="p-3">
            <div className="flex flex-col sm:flex-row sm:items-center gap-3">
              <div className="flex-1 text-sm font-medium text-ink">{it.label}</div>
              <div className="flex gap-1 rounded-xl bg-black/20 p-1">
                {RATING_SCALE.map((r) => {
                  const sel = ratings[it.key] === r.value;
                  return (
                    <button
                      key={r.value}
                      onClick={() => setRatings((s) => ({ ...s, [it.key]: r.value }))}
                      className={`rounded-lg px-3 py-2 text-xs font-medium min-w-[84px] transition-colors ${
                        sel ? "bg-emerald-grad text-[#05271c] shadow" : "text-mint hover:text-white"
                      }`}
                    >
                      {r.short} · {r.value}
                    </button>
                  );
                })}
              </div>
            </div>
            <input
              value={ratingIssues[it.key] ?? ""}
              onChange={(e) => setRatingIssues((s) => ({ ...s, [it.key]: e.target.value }))}
              placeholder="Issues to address (optional)"
              className="mt-2 w-full rounded-lg border border-line px-3 py-2 text-sm"
            />
          </Card>
        ))}
      </div>

      {/* Section B — maintenance log review */}
      <SectionTitle n="B" title="Routine maintenance log review" hint="Oil change dates pre-filled from service history." />
      <Card className="p-4 space-y-3">
        <MaintRow label="Oil change" last={f.oilChangeLast} next={f.oilChangeNext} onLast={(v) => set({ oilChangeLast: v })} onNext={(v) => set({ oilChangeNext: v })} />
        <MaintRow label="Tire rotation" last={f.tireRotationLast} next={f.tireRotationNext} onLast={(v) => set({ tireRotationLast: v })} onNext={(v) => set({ tireRotationNext: v })} />
        <MaintRow label="Other" last={f.otherMaintLast} next={f.otherMaintNext} onLast={(v) => set({ otherMaintLast: v })} onNext={(v) => set({ otherMaintNext: v })} />
      </Card>

      {/* Section C — compliance checks */}
      <SectionTitle n="C" title="FDACS / insurance / maintenance" hint="1 point each. Critical items flag a safety alert when failed." />
      <div className="space-y-2">
        {CHECK_ITEMS.map((it) => {
          const val = checks[it.key];
          return (
            <Card key={it.key} className={`p-3 ${it.critical && val === false ? "ring-1 ring-red-300" : ""}`}>
              <div className="flex items-center gap-3">
                <div className="flex-1 text-sm text-ink">
                  {it.label}
                  {it.critical ? <span className="ml-2 rounded-full bg-red-50 px-1.5 py-0.5 text-[10px] font-medium text-red-600 align-middle">critical</span> : null}
                </div>
                <div className="flex gap-1 rounded-xl bg-black/20 p-1">
                  <button
                    onClick={() => setChecks((s) => ({ ...s, [it.key]: true }))}
                    className={`rounded-lg px-4 py-2 text-xs font-medium transition-colors ${val === true ? "bg-emerald-grad text-[#05271c] shadow" : "text-mint hover:text-white"}`}
                  >Pass</button>
                  <button
                    onClick={() => setChecks((s) => ({ ...s, [it.key]: false }))}
                    className={`rounded-lg px-4 py-2 text-xs font-medium transition-colors ${val === false ? "bg-red-500 text-white shadow" : "text-mint hover:text-white"}`}
                  >Fail</button>
                </div>
              </div>
            </Card>
          );
        })}
      </div>

      {/* Notes */}
      <Card className="p-4">
        <label className="block text-sm font-medium">Notes
          <textarea value={f.notes} onChange={(e) => set({ notes: e.target.value })} rows={3} className="mt-1 w-full rounded-lg border border-line px-3 py-2 text-sm" />
        </label>
      </Card>

      {error ? <p className="text-sm text-red-600">{error}</p> : null}

      {/* Sticky live score / save bar */}
      <div className="fixed bottom-0 inset-x-0 sm:left-60 border-t border-line bg-surface/95 backdrop-blur px-4 py-3 z-20">
        <div className="max-w-3xl mx-auto flex items-center gap-4">
          <div className="flex items-center gap-3">
            <div className={`grid h-12 w-12 place-items-center rounded-full text-lg font-bold ${gradeColor(live.grade)}`}>{live.grade}</div>
            <div className="text-sm">
              <div className="font-semibold tabular-nums">{live.score}/{MAX_SCORE} · {live.scorePct}%</div>
              <div className="text-xs text-muted">
                {answered}/{totalItems} answered
                {critFails.length > 0 ? <span className="ml-2 text-red-600 font-medium">· {critFails.length} critical fail</span> : null}
              </div>
            </div>
          </div>
          <button onClick={save} disabled={busy} className={`${btn.primary} ml-auto`}>
            {busy ? "Saving…" : isEdit ? "Update inspection" : "Save inspection"}
          </button>
        </div>
      </div>
    </div>
  );
}

function gradeColor(g: string) {
  if (g === "A" || g === "B") return "bg-emerald-100 text-emerald-700";
  if (g === "C") return "bg-amber-100 text-amber-700";
  return "bg-red-100 text-red-700";
}

function SectionTitle({ n, title, hint }: { n: string; title: string; hint?: string }) {
  return (
    <div className="flex items-baseline gap-2 pt-1">
      <span className="grid h-6 w-6 place-items-center rounded-full bg-brand-100 text-xs font-bold text-brand-700">{n}</span>
      <h3 className="text-sm font-semibold text-ink">{title}</h3>
      {hint ? <span className="text-xs text-muted">· {hint}</span> : null}
    </div>
  );
}

function Field({ label, v, on, hint }: { label: string; v: string; on: (v: string) => void; hint?: string }) {
  return (
    <label className="block text-sm font-medium">{label}
      <input value={v} onChange={(e) => on(e.target.value)} className="mt-1 w-full rounded-lg border border-line px-3 py-2.5 text-sm" />
      {hint ? <span className="mt-0.5 block text-[11px] font-normal text-muted">{hint}</span> : null}
    </label>
  );
}

function MaintRow({ label, last, next, onLast, onNext }: { label: string; last: string; next: string; onLast: (v: string) => void; onNext: (v: string) => void }) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-[1fr_1fr_1fr] gap-2 items-center">
      <div className="text-sm font-medium text-ink">{label}</div>
      <label className="text-xs text-muted">Last service
        <input type="date" value={last} onChange={(e) => onLast(e.target.value)} className="mt-0.5 w-full rounded-lg border border-line px-2 py-2 text-sm text-ink" />
      </label>
      <label className="text-xs text-muted">Next scheduled
        <input type="date" value={next} onChange={(e) => onNext(e.target.value)} className="mt-0.5 w-full rounded-lg border border-line px-2 py-2 text-sm text-ink" />
      </label>
    </div>
  );
}
