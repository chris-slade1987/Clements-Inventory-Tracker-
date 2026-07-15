"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Card, btn } from "@/components/ui";
import {
  SERVICE_TYPES, SCALE_5, SCALE_3, RIDE_ALONG_RATINGS,
  FACILITY_SAFETY, FACILITY_CLEAN, EQUIPMENT_YESNO, PERSONNEL_YESNO, scoreAudit,
} from "@/lib/audit";

type Ride = {
  employeeId: string; technicianName: string; serviceType: string;
  customerInteraction: number | null; serviceExecution: number | null; equipmentPrep: number | null; safety: number | null;
  customerNotes: string; executionNotes: string; equipmentNotes: string; safetyNotes: string;
  strengths: string; improvement: string; coaching: string;
};
type FollowUp = { description: string; dueDate: string };
type Prefill = {
  visitDate: string; auditorName: string;
  facility: Record<string, unknown>; personnel: Record<string, unknown>; ratings: Record<string, unknown>;
  facilityIssues: string; concerns: string; suggestions: string; nextQuarterPlan: string; status: string;
  rideAlongs: Ride[]; followUps: FollowUp[];
};

const blankRide = (): Ride => ({ employeeId: "", technicianName: "", serviceType: "", customerInteraction: null, serviceExecution: null, equipmentPrep: null, safety: null, customerNotes: "", executionNotes: "", equipmentNotes: "", safetyNotes: "", strengths: "", improvement: "", coaching: "" });

export default function AuditForm({
  branch, year, quarter, employees, prefill, emailConfigured,
}: {
  branch: string; year: number; quarter: number;
  employees: { id: string; name: string }[]; prefill: Prefill; emailConfigured: boolean;
}) {
  const router = useRouter();
  const [visitDate, setVisitDate] = useState(prefill.visitDate);
  const [auditorName, setAuditorName] = useState(prefill.auditorName);
  const [facility, setFacility] = useState<Record<string, number | boolean>>(prefill.facility as Record<string, number | boolean>);
  const [personnel, setPersonnel] = useState<Record<string, boolean>>(prefill.personnel as Record<string, boolean>);
  const [ratings, setRatings] = useState<Record<string, number>>(prefill.ratings as Record<string, number>);
  const [text, setText] = useState({ facilityIssues: prefill.facilityIssues, concerns: prefill.concerns, suggestions: prefill.suggestions, nextQuarterPlan: prefill.nextQuarterPlan });
  const [rides, setRides] = useState<Ride[]>(prefill.rideAlongs.length ? prefill.rideAlongs : [blankRide()]);
  const [followUps, setFollowUps] = useState<FollowUp[]>(prefill.followUps.length ? prefill.followUps : [{ description: "", dueDate: "" }]);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const live = useMemo(() => scoreAudit(facility, personnel, ratings), [facility, personnel, ratings]);

  async function submit(action: "save" | "submit") {
    setBusy(action); setError(null); setMsg(null);
    const payload = {
      action, branch, year, quarter, visitDate, auditorName,
      facility, personnel, ratings, ...text,
      rideAlongs: rides.filter((r) => r.technicianName || r.serviceType),
      followUps: followUps.filter((f) => f.description.trim()),
    };
    const res = await fetch("/api/management/audit", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
    const data = await res.json().catch(() => ({}));
    setBusy(null);
    if (!res.ok) return setError(data.error ?? "Save failed.");
    if (action === "submit") { router.push("/management/audits"); router.refresh(); }
    else { setMsg(`Draft saved · ${data.scorePct}%`); router.refresh(); }
  }

  return (
    <div className="space-y-4 max-w-3xl pb-28">
      <Card className="p-4 grid gap-3 sm:grid-cols-2">
        <label className="block text-sm font-medium">Director of Field Ops
          <input value={auditorName} onChange={(e) => setAuditorName(e.target.value)} className="mt-1 w-full rounded-lg border border-line px-3 py-2.5 text-sm" />
        </label>
        <label className="block text-sm font-medium">Date of visit
          <input type="date" value={visitDate} onChange={(e) => setVisitDate(e.target.value)} className="mt-1 w-full rounded-lg border border-line px-3 py-2.5 text-sm text-ink" />
        </label>
      </Card>

      {/* 1. Ride-alongs */}
      <SectionTitle n="1" title="Ride-along & technician evaluation" />
      {rides.map((r, i) => (
        <Card key={i} className="p-3 space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-muted">Technician {i + 1}</span>
            {rides.length > 1 ? <button onClick={() => setRides((s) => s.filter((_, x) => x !== i))} className="text-muted hover:text-red-600 text-xs">Remove</button> : null}
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            <label className="text-xs text-muted">Technician
              <select value={r.employeeId} onChange={(e) => { const emp = employees.find((x) => x.id === e.target.value); upd(setRides, i, { employeeId: e.target.value, technicianName: emp?.name ?? r.technicianName }); }} className="mt-0.5 w-full rounded-lg border border-line px-2 py-2 text-sm bg-surface">
                <option value="">{r.technicianName || "— Select —"}</option>
                {employees.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
              </select>
            </label>
            <label className="text-xs text-muted">Service type observed
              <select value={r.serviceType} onChange={(e) => upd(setRides, i, { serviceType: e.target.value })} className="mt-0.5 w-full rounded-lg border border-line px-2 py-2 text-sm bg-surface">
                <option value="">— Select —</option>
                {SERVICE_TYPES.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
              </select>
            </label>
          </div>
          {RIDE_ALONG_RATINGS.map((rr) => (
            <div key={rr.key}>
              <div className="flex flex-col sm:flex-row sm:items-center gap-2">
                <div className="flex-1 text-sm"><span className="font-medium text-ink">{rr.label}</span> <span className="text-xs text-muted">· {rr.hint}</span></div>
                <Scale5 value={r[rr.key as keyof Ride] as number | null} onChange={(v) => upd(setRides, i, { [rr.key]: v } as Partial<Ride>)} />
              </div>
            </div>
          ))}
          <div className="grid gap-2 sm:grid-cols-3">
            <TA label="Strengths" v={r.strengths} on={(v) => upd(setRides, i, { strengths: v })} />
            <TA label="Areas for improvement" v={r.improvement} on={(v) => upd(setRides, i, { improvement: v })} />
            <TA label="Training / coaching needed" v={r.coaching} on={(v) => upd(setRides, i, { coaching: v })} />
          </div>
        </Card>
      ))}
      <button onClick={() => setRides((s) => [...s, blankRide()])} className={`${btn.secondary} w-full`}>+ Add technician ride-along</button>

      {/* 2. Facility inspection */}
      <SectionTitle n="2" title="Facility inspection" />
      <Card className="p-4 space-y-2">
        <GroupLabel>A · Safety &amp; Compliance</GroupLabel>
        {FACILITY_SAFETY.map((it) => <Row3 key={it.key} label={it.label} value={facility[it.key] as number} onChange={(v) => setFacility((s) => ({ ...s, [it.key]: v }))} />)}
        <GroupLabel>B · Cleanliness &amp; Organization</GroupLabel>
        {FACILITY_CLEAN.map((it) => <Row3 key={it.key} label={it.label} value={facility[it.key] as number} onChange={(v) => setFacility((s) => ({ ...s, [it.key]: v }))} />)}
        <TA label="Issues noted" v={text.facilityIssues} on={(v) => setText({ ...text, facilityIssues: v })} />
        <GroupLabel>C · Equipment &amp; Vehicles</GroupLabel>
        {EQUIPMENT_YESNO.map((it) => <RowYesNo key={it.key} label={it.label} value={facility[it.key] as boolean} onChange={(v) => setFacility((s) => ({ ...s, [it.key]: v }))} />)}
        <div className="flex items-center justify-between gap-2 pt-1"><span className="text-sm font-medium text-ink">Section rating</span><Scale5 value={ratings.equipment ?? null} onChange={(v) => setRatings((s) => ({ ...s, equipment: v }))} /></div>
      </Card>

      {/* 3. Personnel & training */}
      <SectionTitle n="3" title="Personnel & training" />
      <Card className="p-4 space-y-2">
        {PERSONNEL_YESNO.map((it) => <RowYesNo key={it.key} label={it.label} value={personnel[it.key]} onChange={(v) => setPersonnel((s) => ({ ...s, [it.key]: v }))} />)}
        <div className="flex items-center justify-between gap-2 pt-1"><span className="text-sm font-medium text-ink">Section rating</span><Scale5 value={ratings.personnel ?? null} onChange={(v) => setRatings((s) => ({ ...s, personnel: v }))} /></div>
      </Card>

      {/* 4. Notes & follow-ups */}
      <SectionTitle n="4" title="Notes & follow-ups" />
      <Card className="p-4 space-y-3">
        <TA label="Branch-specific concerns / issues identified" v={text.concerns} on={(v) => setText({ ...text, concerns: v })} />
        <TA label="Suggestions for team engagement & inclusion" v={text.suggestions} on={(v) => setText({ ...text, suggestions: v })} />
        <div>
          <div className="text-sm font-medium text-ink mb-1">Action items for branch manager before next visit</div>
          <p className="text-xs text-muted mb-2">Each becomes a dated reminder on the manager&rsquo;s dashboard.</p>
          {followUps.map((fu, i) => (
            <div key={i} className="flex gap-2 mb-2">
              <input value={fu.description} onChange={(e) => upd(setFollowUps, i, { description: e.target.value })} placeholder="Action item" className="flex-1 rounded-lg border border-line px-2 py-1.5 text-sm" />
              <input type="date" value={fu.dueDate} onChange={(e) => upd(setFollowUps, i, { dueDate: e.target.value })} className="rounded-lg border border-line px-2 py-1.5 text-sm text-ink" />
              {followUps.length > 1 ? <button onClick={() => setFollowUps((s) => s.filter((_, x) => x !== i))} className="text-muted hover:text-red-600 px-1">✕</button> : null}
            </div>
          ))}
          <button onClick={() => setFollowUps((s) => [...s, { description: "", dueDate: "" }])} className="text-xs font-medium text-brand-700 hover:underline">+ Add action item</button>
        </div>
      </Card>

      {/* 5. Next quarter */}
      <SectionTitle n="5" title="Pre-visit planning for next quarter" />
      <Card className="p-4"><TA label="Technicians for next ride-along & areas of focus" v={text.nextQuarterPlan} on={(v) => setText({ ...text, nextQuarterPlan: v })} /></Card>

      {error ? <p className="text-sm text-red-600">{error}</p> : null}
      {!emailConfigured ? <p className="text-[11px] text-amber-600">Email provider not configured — the manager copy on submit is logged only until RESEND_API_KEY is set.</p> : null}

      {/* Sticky score / actions */}
      <div className="fixed bottom-0 inset-x-0 sm:left-60 border-t border-line bg-surface/95 backdrop-blur px-4 py-3 z-20">
        <div className="max-w-3xl mx-auto flex items-center gap-4">
          <div className="text-sm">
            <div className="font-semibold tabular-nums">{live.score}/{live.maxScore} · {live.scorePct}%</div>
            <div className="text-xs text-muted">Branch compliance score{msg ? ` · ${msg}` : ""}</div>
          </div>
          <div className="ml-auto flex gap-2">
            <button onClick={() => submit("save")} disabled={!!busy} className={btn.secondary}>{busy === "save" ? "Saving…" : "Save draft"}</button>
            <button onClick={() => submit("submit")} disabled={!!busy} className={btn.primary}>{busy === "submit" ? "Submitting…" : "Submit & email manager"}</button>
          </div>
        </div>
      </div>
    </div>
  );
}

function upd<T>(setter: React.Dispatch<React.SetStateAction<T[]>>, i: number, patch: Partial<T>) {
  setter((s) => s.map((x, idx) => (idx === i ? { ...x, ...patch } : x)));
}

function SectionTitle({ n, title }: { n: string; title: string }) {
  return <div className="flex items-baseline gap-2 pt-1"><span className="grid h-6 w-6 place-items-center rounded-full bg-brand-100 text-xs font-bold text-brand-700">{n}</span><h3 className="text-sm font-semibold text-ink">{title}</h3></div>;
}
function GroupLabel({ children }: { children: React.ReactNode }) {
  return <div className="text-xs font-semibold uppercase tracking-wider text-muted pt-2">{children}</div>;
}
function Scale5({ value, onChange }: { value: number | null; onChange: (v: number) => void }) {
  return (
    <div className="flex gap-1 rounded-xl bg-slate-100 p-1">
      {SCALE_5.map((s) => (
        <button key={s.value} title={s.label} onClick={() => onChange(s.value)} className={`h-8 w-8 rounded-lg text-xs font-medium transition-colors ${value === s.value ? "bg-emerald-grad text-[#05271c] shadow" : "text-slate-600 hover:text-slate-900"}`}>{s.value}</button>
      ))}
    </div>
  );
}
function Row3({ label, value, onChange }: { label: string; value: number | undefined; onChange: (v: number) => void }) {
  return (
    <div className="flex flex-col sm:flex-row sm:items-center gap-2">
      <div className="flex-1 text-sm text-ink">{label}</div>
      <div className="flex gap-1 rounded-xl bg-slate-100 p-1">
        {SCALE_3.map((s) => <button key={s.value} title={s.label} onClick={() => onChange(s.value)} className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${value === s.value ? "bg-emerald-grad text-[#05271c] shadow" : "text-slate-600 hover:text-slate-900"}`}>{s.value}</button>)}
      </div>
    </div>
  );
}
function RowYesNo({ label, value, onChange }: { label: string; value: boolean | undefined; onChange: (v: boolean) => void }) {
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 text-sm text-ink">{label}</div>
      <div className="flex gap-1 rounded-xl bg-slate-100 p-1">
        <button onClick={() => onChange(true)} className={`rounded-lg px-4 py-1.5 text-xs font-medium transition-colors ${value === true ? "bg-emerald-grad text-[#05271c] shadow" : "text-slate-600 hover:text-slate-900"}`}>Yes</button>
        <button onClick={() => onChange(false)} className={`rounded-lg px-4 py-1.5 text-xs font-medium transition-colors ${value === false ? "bg-red-500 text-white shadow" : "text-slate-600 hover:text-slate-900"}`}>No</button>
      </div>
    </div>
  );
}
function TA({ label, v, on }: { label: string; v: string; on: (v: string) => void }) {
  return <label className="block text-xs text-muted">{label}<textarea value={v} onChange={(e) => on(e.target.value)} rows={2} className="mt-0.5 w-full rounded-lg border border-line px-2 py-1.5 text-sm text-ink" /></label>;
}
