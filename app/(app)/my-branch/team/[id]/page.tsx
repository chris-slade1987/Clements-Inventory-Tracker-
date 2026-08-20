import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Card, PageHeader } from "@/components/ui";
import { requireUser, branchLocked } from "@/lib/auth";
import { branchLabel } from "@/lib/management";
import { dateShort } from "@/lib/format";
import { recordTypeLabel } from "@/lib/personnel";
import { parseJson } from "@/lib/inspection";
import { employeeDetail } from "@/lib/people";
import { reviewsForEmployee, REVIEW_LABEL, STATUS_LABEL } from "@/lib/review";
import { remindersForEmployee } from "@/lib/manual-reminders";
import { documentsForEmployee } from "@/lib/branch-hub";
import { absencesForEmployee, canManageAbsenceBranch, canResolveNotes, reasonLabel } from "@/lib/absence";
import PtoProfileCard from "@/components/PtoProfileCard";
import AbsenceCard from "@/components/AbsenceCard";
import RemindersCard from "@/components/RemindersCard";
import RecordForm from "./RecordForm";
import SignatureBlock from "./SignatureBlock";
import OtherNoteForm from "./OtherNoteForm";

export const dynamic = "force-dynamic";

const MONTH_ABBR = ["", "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const TYPE_STYLE: Record<string, string> = {
  writeup: "bg-amber-100 text-amber-700",
  note: "bg-slate-100 text-slate-600",
  recognition: "bg-emerald-100 text-emerald-700",
  accident: "bg-red-100 text-red-700",
};
function gradeChip(grade: string) {
  const c = grade === "A" || grade === "B" ? "bg-emerald-100 text-emerald-700" : grade === "C" ? "bg-amber-100 text-amber-700" : "bg-red-100 text-red-700";
  return `inline-grid h-6 w-6 place-items-center rounded-full text-xs font-bold ${c}`;
}

// A manager's view of one of their team members. This mirrors the HR People
// profile (contact, licenses, inspections, ride-alongs, training, reviews,
// reminders, full personnel record) so a manager sees everything HR sees —
// scoped to their own branch's team — while keeping the manager tools
// (write-up / coaching / recognition / accident, call-out log, PTO, other notes).
// Employment-status / offboarding stays HR-only and is not shown here.
export default async function TeamMemberPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await params;
  const detail = await employeeDetail(id);
  if (!detail) notFound();
  const { employee: e, inspections, rideAlongs, training, records, assigned, avgPct, grade } = detail;

  // Branch-scoped: a branch manager may only open profiles of their own team.
  if (branchLocked(user) && e.branch !== user.branch) redirect("/my-branch/team");

  const [reviews, empReminders, licenses, empAbsences] = await Promise.all([
    reviewsForEmployee(e.id),
    remindersForEmployee(e.id),
    documentsForEmployee(e.id),
    absencesForEmployee(e.id),
  ]);

  const canManage = user.role === "admin" || user.hrAccess || (user.role === "manager" && !!user.branch && user.branch === e.branch);

  // Call-outs linked to an accident report — surfaced on the accident record.
  const injuryByRecord = new Map<string, typeof empAbsences>();
  for (const a of empAbsences) {
    if (a.accidentRecordId) {
      const arr = injuryByRecord.get(a.accidentRecordId) ?? [];
      arr.push(a);
      injuryByRecord.set(a.accidentRecordId, arr);
    }
  }
  const fmtRange = (a: { startDate: Date; endDate: Date; days: number }) => {
    const f = (d: Date) => d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
    return a.days > 1 ? `${f(a.startDate)} – ${f(a.endDate)}` : f(a.startDate);
  };
  const birthday = e.birthMonth ? `${MONTH_ABBR[e.birthMonth]}${e.birthDay ? ` ${e.birthDay}` : ""}` : null;

  return (
    <>
      <div className="mb-2"><Link href="/my-branch/team" className="text-xs font-medium text-brand-700 hover:underline">← My Team</Link></div>
      <PageHeader title={e.name} subtitle={[e.role, e.division, e.branch ? branchLabel(e.branch) : null].filter(Boolean).join(" · ") || "Team member"} />

      <div className="grid gap-4 lg:grid-cols-2 mb-5">
        {/* Contact / profile (read-only for managers; HR edits it on the People profile) */}
        <Card className="p-4">
          <div className="text-sm font-medium text-ink mb-2">Contact &amp; profile</div>
          <dl className="grid grid-cols-[9rem_1fr] gap-y-1.5 text-sm">
            <Row label="Work email" v={e.email} />
            <Row label="Work phone" v={e.phone} />
            <Row label="Personal phone" v={e.personalPhone} />
            <Row label="Title" v={e.title} />
            <Row label="Start date" v={e.hireDate ? dateShort(e.hireDate) : null} />
            <Row label="Branch" v={e.branch ? branchLabel(e.branch) : null} />
            <Row label="Birthday" v={birthday} />
          </dl>
        </Card>

        {/* Assigned vehicles */}
        <Card className="p-4">
          <div className="text-sm font-medium text-ink mb-2">Assigned vehicles</div>
          {assigned.length === 0 ? (
            <p className="text-sm text-muted">No vehicle currently assigned.</p>
          ) : (
            <ul className="text-sm space-y-1">
              {assigned.map((v) => (
                <li key={v.id}>
                  <Link href={`/fleet/${v.id}`} className="text-brand-700 hover:underline">{v.unitNumber ? `#${v.unitNumber} · ` : ""}{v.name}</Link>
                </li>
              ))}
            </ul>
          )}
          {avgPct != null ? <p className="mt-3 text-xs text-muted">Inspection avg: <span className="font-medium text-ink">{avgPct}%</span> · grade {grade}</p> : null}
        </Card>
      </div>

      {/* Paid time off */}
      <PtoProfileCard employeeId={e.id} canManage={canManage} />

      {/* Attendance / call-out log */}
      <AbsenceCard employeeId={e.id} canManage={canManageAbsenceBranch(user, e.branch)} canResolve={canResolveNotes(user)} />

      {/* File a write-up / coaching note / recognition / accident report */}
      <RecordForm employeeId={e.id} employeeName={e.name} />

      {/* Other notes — general comment filed to the profile (and HR) */}
      <OtherNoteForm employeeId={e.id} employeeName={e.name} />

      {/* Personnel records */}
      <Card className="p-0 overflow-hidden mt-5">
        <div className="px-4 py-3 border-b border-line text-sm font-medium text-ink">Personnel records</div>
        {records.length === 0 ? (
          <p className="px-4 py-8 text-center text-sm text-muted">No records yet. Use the actions above to file the first one.</p>
        ) : (
          <ul className="divide-y divide-line">
            {records.map((r) => {
              const details = parseJson<Record<string, string>>(r.details, {});
              return (
                <li key={r.id} className="px-4 py-3">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${TYPE_STYLE[r.type] ?? "bg-slate-100 text-slate-600"}`}>{recordTypeLabel(r.type)}{r.category ? ` · ${r.category}` : ""}</span>
                    <span className="text-xs text-muted">{dateShort(r.createdAt)} · {r.authorName ?? "—"}</span>
                    {r.hrNotified ? <span className="text-[11px] text-brand-600">HR notified</span> : <span className="text-[11px] text-muted">HR queued</span>}
                  </div>
                  {r.title ? <div className="mt-1 text-sm font-medium text-ink">{r.title}</div> : null}
                  {r.body ? <div className="mt-0.5 text-sm text-muted whitespace-pre-line">{r.body}</div> : null}
                  {r.incidentDate ? <div className="mt-1 text-xs text-muted">Incident: {dateShort(r.incidentDate)}</div> : null}
                  {Object.keys(details).length > 0 ? (
                    <div className="mt-1 text-xs text-muted">
                      {Object.entries(details).filter(([, v]) => v && typeof v === "string").slice(0, 8).map(([k, v]) => <span key={k} className="mr-3"><span className="font-medium">{k}:</span> {String(v)}</span>)}
                    </div>
                  ) : null}
                  {r.actionTaken ? <div className="mt-1 text-xs"><span className="font-medium text-ink">Action:</span> <span className="text-muted">{r.actionTaken}</span></div> : null}
                  {r.attachmentFile ? <a href={r.attachmentFile} target="_blank" className="mt-1 inline-block text-xs font-medium text-brand-700 hover:underline">📎 {r.attachmentName ?? "attachment"}</a> : null}
                  {r.type === "accident" && injuryByRecord.has(r.id) ? (
                    <div className="mt-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800">
                      <span className="font-semibold">Employee out of work due to this injury:</span>{" "}
                      {injuryByRecord.get(r.id)!.map((a, i) => (
                        <span key={a.id}>{i > 0 ? "; " : ""}{fmtRange(a)} ({reasonLabel(a.reason).toLowerCase()}, note {a.noteStatus})</span>
                      ))}
                    </div>
                  ) : null}
                  {(r.type === "writeup" || r.type === "accident") ? (
                    <SignatureBlock
                      recordId={r.id}
                      type={r.type}
                      employeeEmail={e.email ?? ""}
                      signatures={r.signatures.map((s) => ({ id: s.id, role: s.role, signerName: s.signerName, signedAt: s.signedAt }))}
                      requests={r.signatureRequests.map((q) => ({ id: q.id, role: q.role, email: q.email }))}
                    />
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      {/* Licenses & credentials */}
      {licenses.length > 0 ? (
        <Card className="p-0 overflow-hidden mt-5">
          <div className="px-4 py-3 border-b border-line text-sm font-medium text-ink">Licenses &amp; credentials</div>
          <ul className="divide-y divide-line">
            {licenses.map((l) => {
              const days = l.expirationDate ? Math.round((l.expirationDate.getTime() - Date.now()) / 864e5) : null;
              return (
                <li key={l.id} className="px-4 py-3 flex flex-wrap items-center justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      {l.filePath ? <a href={`/api/branch/document/${l.id}/file`} target="_blank" className="text-sm font-medium text-brand-700 hover:underline">📄 {l.title}</a> : <span className="text-sm font-medium text-ink">{l.title}</span>}
                      {l.categories ? <span className="rounded-full bg-brand-100 px-2 py-0.5 text-[10px] font-medium text-brand-700">{l.categories}</span> : null}
                    </div>
                    <div className="text-xs text-muted mt-0.5">{[l.licenseNumber ? `#${l.licenseNumber}` : null, l.branch ? `certifies ${branchLabel(l.branch)}` : null].filter(Boolean).join(" · ")}</div>
                  </div>
                  {l.expirationDate ? <span className={`text-xs font-medium ${days != null && days <= 0 ? "text-red-600" : days != null && days <= 90 ? "text-amber-600" : "text-muted"}`}>expires {dateShort(l.expirationDate)}{days != null && days > 0 ? ` · ${days}d` : ""}</span> : null}
                </li>
              );
            })}
          </ul>
        </Card>
      ) : null}

      {/* Reminders tagged to this employee */}
      <div className="mt-5">
        <RemindersCard
          preset={{ employeeId: e.id, label: e.name }}
          canManage={canManage}
          reminders={empReminders.map((r) => ({ id: r.id, title: r.title, notes: r.notes, dueDate: r.dueDate.toISOString(), severity: r.severity, status: r.status }))}
        />
      </div>

      {/* Vehicle inspection history */}
      <Card className="p-0 overflow-hidden mt-5">
        <div className="px-4 py-3 border-b border-line text-sm font-medium text-ink">Vehicle inspection history</div>
        {inspections.length === 0 ? (
          <p className="px-4 py-8 text-center text-sm text-muted">No inspections tagged to this profile yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-muted border-b border-line">
                  <th className="px-4 py-2 font-medium">Period</th>
                  <th className="px-3 py-2 font-medium">Vehicle</th>
                  <th className="px-3 py-2 font-medium">Inspector</th>
                  <th className="px-3 py-2 font-medium text-right">Score</th>
                  <th className="px-4 py-2 font-medium text-center">Grade</th>
                </tr>
              </thead>
              <tbody>
                {inspections.map((i) => (
                  <tr key={i.id} className="border-b border-line last:border-0">
                    <td className="px-4 py-2 whitespace-nowrap">{MONTH_ABBR[i.month]} {i.year}</td>
                    <td className="px-3 py-2"><Link href={`/fleet/${i.vehicleId}/inspect?year=${i.year}&month=${i.month}`} className="text-brand-700 hover:underline">{i.vehicle.unitNumber ? `#${i.vehicle.unitNumber} · ` : ""}{i.vehicle.name}</Link></td>
                    <td className="px-3 py-2 text-muted">{i.inspectorName ?? "—"}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{i.score}/{i.maxScore} · {i.scorePct}%</td>
                    <td className="px-4 py-2 text-center"><span className={gradeChip(i.grade)}>{i.grade}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* Field-audit ride-alongs */}
      {rideAlongs.length > 0 ? (
        <Card className="p-0 overflow-hidden mt-5">
          <div className="px-4 py-3 border-b border-line text-sm font-medium text-ink">Field-audit ride-alongs</div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-muted border-b border-line">
                  <th className="px-4 py-2 font-medium">Quarter</th>
                  <th className="px-3 py-2 font-medium">Service</th>
                  <th className="px-3 py-2 font-medium text-right">Customer</th>
                  <th className="px-3 py-2 font-medium text-right">Execution</th>
                  <th className="px-3 py-2 font-medium text-right">Equipment</th>
                  <th className="px-4 py-2 font-medium text-right">Safety</th>
                </tr>
              </thead>
              <tbody>
                {rideAlongs.map((r) => (
                  <tr key={r.id} className="border-b border-line last:border-0">
                    <td className="px-4 py-2 whitespace-nowrap">Q{r.audit.quarter} {r.audit.year}</td>
                    <td className="px-3 py-2 text-muted">{r.serviceType ?? "—"}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{r.customerInteraction ?? "—"}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{r.serviceExecution ?? "—"}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{r.equipmentPrep ?? "—"}</td>
                    <td className="px-4 py-2 text-right tabular-nums">{r.safety ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      ) : null}

      {/* Training record */}
      <Card className="p-0 overflow-hidden mt-5">
        <div className="px-4 py-3 border-b border-line text-sm font-medium text-ink">Training record</div>
        {training.length === 0 ? (
          <p className="px-4 py-8 text-center text-sm text-muted">No training assigned yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-muted border-b border-line">
                  <th className="px-4 py-2 font-medium">Course</th>
                  <th className="px-3 py-2 font-medium">Category</th>
                  <th className="px-3 py-2 font-medium">Completed</th>
                  <th className="px-3 py-2 font-medium text-right">Score</th>
                  <th className="px-4 py-2 font-medium text-center">Status</th>
                </tr>
              </thead>
              <tbody>
                {training.map((t) => (
                  <tr key={t.id} className="border-b border-line last:border-0">
                    <td className="px-4 py-2 font-medium">{t.course.title}</td>
                    <td className="px-3 py-2 text-muted capitalize">{t.course.category}</td>
                    <td className="px-3 py-2 text-muted">{t.completedAt ? dateShort(t.completedAt) : "—"}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{t.score != null ? `${t.score}%` : "—"}</td>
                    <td className="px-4 py-2 text-center"><span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${t.status === "completed" ? "bg-emerald-100 text-emerald-700" : t.status === "in_progress" ? "bg-amber-100 text-amber-700" : "bg-red-100 text-red-600"}`}>{t.status === "completed" ? "Completed" : t.status === "in_progress" ? "In progress" : "Not started"}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* New-hire 30 / 60-day reviews */}
      <Card className="p-0 overflow-hidden mt-5">
        <div className="px-4 py-3 border-b border-line text-sm font-medium text-ink">New-hire reviews</div>
        {reviews.length === 0 ? (
          <p className="px-4 py-8 text-center text-sm text-muted">No 30 or 60-day reviews on file{e.hireDate ? "" : " — add a hire date to schedule them"}.</p>
        ) : (
          <ul className="divide-y divide-line">
            {reviews.map((r) => (
              <li key={r.id} className="px-4 py-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${r.status === "completed" ? "bg-emerald-100 text-emerald-700" : r.status === "pending_approval" ? "bg-brand-100 text-brand-700" : "bg-amber-100 text-amber-700"}`}>{REVIEW_LABEL[r.type]}</span>
                  <span className="text-xs text-muted">{STATUS_LABEL[r.status] ?? r.status}</span>
                  <span className="text-xs text-muted">due {dateShort(r.dueDate)}{r.completedAt ? ` · approved ${dateShort(r.completedAt)}` : ""}</span>
                  <Link href={`/reviews/${r.id}`} className="ml-auto text-xs font-medium text-brand-700 hover:underline">View →</Link>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </>
  );
}

function Row({ label, v }: { label: string; v: string | null | undefined }) {
  return (
    <>
      <dt className="text-muted">{label}</dt>
      <dd className="text-ink">{v || <span className="text-muted">—</span>}</dd>
    </>
  );
}
