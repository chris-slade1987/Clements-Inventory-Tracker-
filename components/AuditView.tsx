import {
  SERVICE_TYPES, SCALE_5, SCALE_3,
  RIDE_ALONG_RATINGS, FACILITY_SAFETY, FACILITY_CLEAN, EQUIPMENT_YESNO, PERSONNEL_YESNO,
  serviceTypeLabel, auditStatusLabel, normStatus,
} from "@/lib/audit";
import { branchLabel } from "@/lib/management";

// Read-only, print-friendly rendering of a completed/filed branch audit — the
// "signed form". Shared by the public manager-sign page and the in-app view.

type Ride = {
  technicianName: string | null; serviceType: string | null;
  customerInteraction: number | null; serviceExecution: number | null; equipmentPrep: number | null; safety: number | null;
  customerNotes: string | null; executionNotes: string | null; equipmentNotes: string | null; safetyNotes: string | null;
  strengths: string | null; improvement: string | null; coaching: string | null;
};
type FollowUp = { description: string; dueDate: Date | null; status: string };
export type AuditForView = {
  id: string; branch: string; year: number; quarter: number; visitDate: Date;
  auditorName: string | null; status: string; scorePct: number; score: number; maxScore: number;
  facility: string; personnel: string; ratings: string;
  facilityIssues: string | null; concerns: string | null; suggestions: string | null; nextQuarterPlan: string | null;
  auditorSignedName: string | null; auditorSignedAt: Date | null;
  managerSignedName: string | null; managerSignedTitle: string | null; managerSignedAt: Date | null;
  rideAlongs: Ride[]; followUps: FollowUp[];
};

function parse(s: string): Record<string, number | boolean> {
  try { return JSON.parse(s) as Record<string, number | boolean>; } catch { return {}; }
}
const d = (x: Date | null) => (x ? new Date(x).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }) : "—");
const scale5 = (v: number | null) => (v == null ? "—" : `${v} · ${SCALE_5.find((s) => s.value === v)?.label ?? ""}`);
const scale3 = (v: number | undefined) => (v == null ? "—" : `${v} · ${SCALE_3.find((s) => s.value === v)?.label ?? ""}`);

function Head({ children }: { children: React.ReactNode }) {
  return <h3 className="mt-6 mb-2 flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-brand-700">{children}</h3>;
}
function KV({ k, v }: { k: string; v: React.ReactNode }) {
  return <div className="flex justify-between gap-3 border-b border-slate-100 py-1.5 text-sm last:border-0"><span className="text-slate-600">{k}</span><span className="text-right font-medium text-slate-900">{v}</span></div>;
}
function Note({ label, v }: { label: string; v: string | null | undefined }) {
  if (!v) return null;
  return <div className="mt-1"><div className="text-[11px] font-medium uppercase tracking-wide text-slate-500">{label}</div><p className="whitespace-pre-wrap text-sm text-slate-800">{v}</p></div>;
}

export default function AuditView({ audit }: { audit: AuditForView }) {
  const facility = parse(audit.facility);
  const personnel = parse(audit.personnel) as Record<string, boolean>;
  const ratings = parse(audit.ratings) as Record<string, number>;
  const status = normStatus(audit.status);
  const yn = (b: boolean | undefined) => (b === true ? "Yes" : b === false ? "No" : "—");

  return (
    <div className="text-slate-900">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="text-xs uppercase tracking-wider text-slate-500">Director of Field Ops · Quarterly Branch Audit</div>
          <h2 className="mt-1 text-xl font-semibold">{branchLabel(audit.branch)} · Q{audit.quarter} {audit.year}</h2>
          <p className="text-sm text-slate-500">Visit {d(audit.visitDate)} · {audit.auditorName ?? "—"}</p>
          <span className={`mt-1 inline-block rounded-full px-2 py-0.5 text-[11px] font-medium ${status === "signed" ? "bg-emerald-100 text-emerald-700" : status === "pending_manager" ? "bg-amber-100 text-amber-700" : "bg-slate-100 text-slate-600"}`}>{auditStatusLabel(audit.status)}</span>
        </div>
        <div className="shrink-0 rounded-xl bg-emerald-50 px-4 py-2.5 text-center ring-1 ring-emerald-100">
          <div className="text-2xl font-bold leading-none tabular-nums text-emerald-700">{audit.scorePct}%</div>
          <div className="mt-1 text-[11px] text-emerald-800">{audit.score}/{audit.maxScore} compliance</div>
        </div>
      </div>

      {/* 1. Ride-alongs */}
      <Head>1 · Ride-along &amp; technician evaluation</Head>
      {audit.rideAlongs.length === 0 ? <p className="text-sm text-slate-500">No ride-alongs recorded.</p> : (
        <div className="space-y-3">
          {audit.rideAlongs.map((r, i) => (
            <div key={i} className="rounded-xl ring-1 ring-slate-200 p-3">
              <div className="flex items-center justify-between">
                <span className="font-medium">{r.technicianName || `Technician ${i + 1}`}</span>
                <span className="text-xs text-slate-500">{serviceTypeLabel(r.serviceType)}</span>
              </div>
              <div className="mt-2 grid gap-x-6 sm:grid-cols-2">
                {RIDE_ALONG_RATINGS.map((rr) => (
                  <KV key={rr.key} k={rr.label} v={scale5(r[rr.key as keyof Ride] as number | null)} />
                ))}
              </div>
              <Note label="Strengths" v={r.strengths} />
              <Note label="Areas for improvement" v={r.improvement} />
              <Note label="Training / coaching needed" v={r.coaching} />
            </div>
          ))}
        </div>
      )}

      {/* 2. Facility */}
      <Head>2 · Facility inspection</Head>
      <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">A · Safety &amp; compliance</div>
      {FACILITY_SAFETY.map((it) => <KV key={it.key} k={it.label} v={scale3(facility[it.key] as number)} />)}
      <div className="mt-3 text-[11px] font-semibold uppercase tracking-wide text-slate-400">B · Cleanliness &amp; organization</div>
      {FACILITY_CLEAN.map((it) => <KV key={it.key} k={it.label} v={scale3(facility[it.key] as number)} />)}
      <Note label="Issues noted" v={audit.facilityIssues} />
      <div className="mt-3 text-[11px] font-semibold uppercase tracking-wide text-slate-400">C · Equipment &amp; vehicles</div>
      {EQUIPMENT_YESNO.map((it) => <KV key={it.key} k={it.label} v={yn(facility[it.key] as boolean)} />)}
      <KV k="Section rating" v={scale5(ratings.equipment ?? null)} />

      {/* 3. Personnel */}
      <Head>3 · Personnel &amp; training</Head>
      {PERSONNEL_YESNO.map((it) => <KV key={it.key} k={it.label} v={yn(personnel[it.key])} />)}
      <KV k="Section rating" v={scale5(ratings.personnel ?? null)} />

      {/* 4. Notes & follow-ups */}
      <Head>4 · Notes &amp; follow-ups</Head>
      <Note label="Branch-specific concerns / issues identified" v={audit.concerns} />
      <Note label="Suggestions for team engagement &amp; inclusion" v={audit.suggestions} />
      {audit.followUps.length > 0 && (
        <div className="mt-2">
          <div className="text-[11px] font-medium uppercase tracking-wide text-slate-500">Action items for branch manager before next visit</div>
          <ul className="mt-1 space-y-1 text-sm">
            {audit.followUps.map((f, i) => (
              <li key={i} className="flex items-center gap-2">
                <span className={`inline-block h-1.5 w-1.5 rounded-full ${f.status === "done" ? "bg-emerald-500" : "bg-amber-500"}`} />
                <span className={f.status === "done" ? "text-slate-400 line-through" : "text-slate-800"}>{f.description}</span>
                {f.dueDate ? <span className="text-xs text-slate-400">· due {d(f.dueDate)}</span> : null}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* 5. Next quarter */}
      {audit.nextQuarterPlan ? (<><Head>5 · Pre-visit planning for next quarter</Head><Note label="Plan" v={audit.nextQuarterPlan} /></>) : null}

      {/* Signatures */}
      <Head>Signatures</Head>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="rounded-xl ring-1 ring-slate-200 p-3">
          <div className="text-[11px] uppercase tracking-wide text-slate-500">Director of Field Ops</div>
          <div className="mt-1 font-medium" style={{ fontFamily: "'Segoe Script','Brush Script MT',cursive" }}>{audit.auditorSignedName ?? "—"}</div>
          <div className="text-xs text-slate-400">{audit.auditorSignedAt ? `Signed ${d(audit.auditorSignedAt)}` : "Not signed"}</div>
        </div>
        <div className="rounded-xl ring-1 ring-slate-200 p-3">
          <div className="text-[11px] uppercase tracking-wide text-slate-500">Branch manager</div>
          <div className="mt-1 font-medium" style={{ fontFamily: "'Segoe Script','Brush Script MT',cursive" }}>{audit.managerSignedName ?? "—"}</div>
          <div className="text-xs text-slate-400">{audit.managerSignedAt ? `Signed ${d(audit.managerSignedAt)}${audit.managerSignedTitle ? ` · ${audit.managerSignedTitle}` : ""}` : "Awaiting signature"}</div>
        </div>
      </div>
    </div>
  );
}
