import Link from "next/link";
import { notFound } from "next/navigation";
import { Card, PageHeader } from "@/components/ui";
import { requireUser } from "@/lib/auth";
import { isHrDirector } from "@/lib/personnel";
import { reviewsForEmployee, REVIEW_LABEL, STATUS_LABEL } from "@/lib/review";
import { separationForEmployee, SEPARATION_TYPES, REASON_CATEGORIES, EXIT_INTERVIEW, parseJson, type SeparationDoc } from "@/lib/separation";
import { remindersForEmployee } from "@/lib/manual-reminders";
import RemindersCard from "@/components/RemindersCard";
import { dateShort } from "@/lib/format";
import { branchLabel } from "@/lib/management";
import { employeeDetail } from "@/lib/people";
import PtoProfileCard from "@/components/PtoProfileCard";
import AbsenceCard from "@/components/AbsenceCard";
import { absencesForEmployee, canManageAbsenceBranch, canResolveNotes, reasonLabel } from "@/lib/absence";
import { documentsForEmployee } from "@/lib/branch-hub";
import { emailConfigured } from "@/lib/email";
import EmployeeContact from "./EmployeeContact";
import Offboarding from "./Offboarding";
import SignatureBlock from "@/app/(app)/my-branch/team/[id]/SignatureBlock";

export const dynamic = "force-dynamic";

const MONTH_ABBR = ["", "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function gradeChip(grade: string) {
  const c = grade === "A" || grade === "B" ? "bg-emerald-100 text-emerald-700" : grade === "C" ? "bg-amber-100 text-amber-700" : "bg-red-100 text-red-700";
  return `inline-grid h-6 w-6 place-items-center rounded-full text-xs font-bold ${c}`;
}

export default async function EmployeePage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await params;
  const detail = await employeeDetail(id);
  if (!detail) notFound();
  const { employee: e, inspections, rideAlongs, training, records, assigned, avgPct, grade } = detail;
  const reviews = await reviewsForEmployee(e.id);
  const empReminders = await remindersForEmployee(e.id);
  const licenses = await documentsForEmployee(e.id);
  const sep = await separationForEmployee(e.id);
  const separation = sep
    ? {
        separationType: sep.separationType,
        reasonCategory: sep.reasonCategory,
        reasonNotes: sep.reasonNotes,
        lastDay: sep.lastDay.toISOString(),
        rehireEligible: sep.rehireEligible,
        docs: parseJson<SeparationDoc[]>(sep.docs, []),
        exitStatus: sep.exitStatus,
        exitBypassReason: sep.exitBypassReason,
        exitResponses: parseJson<Record<string, string>>(sep.exitResponses, {}),
        exitInterviewAt: sep.exitInterviewAt ? sep.exitInterviewAt.toISOString() : null,
        exitInterviewBy: sep.exitInterviewBy,
        createdByName: sep.createdByName,
      }
    : null;
  const TRAINING_STATUS: Record<string, string> = { not_started: "Not started", in_progress: "In progress", completed: "Completed" };
  const RECORD_STYLE: Record<string, string> = { writeup: "bg-amber-100 text-amber-700", note: "bg-slate-100 text-slate-600", recognition: "bg-emerald-100 text-emerald-700", accident: "bg-red-100 text-red-700" };
  const RECORD_LABEL: Record<string, string> = { writeup: "Write-up", note: "Note", recognition: "Recognition", accident: "Accident" };
  const hr = isHrDirector(user);
  const canEdit = user.role === "admin" || hr;

  // Call-outs linked to an accident report — surfaced on the accident record so
  // the injury → time-off connection is visible with the report.
  const empAbsences = await absencesForEmployee(e.id);
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

  return (
    <>
      <div className="mb-2">
        <Link href="/management/people" className="text-xs font-medium text-brand-300 hover:underline">← People / HR</Link>
      </div>
      <PageHeader
        title={e.name}
        subtitle={[e.role, e.division, e.branch ? branchLabel(e.branch) : null].filter(Boolean).join(" · ") || "Employee"}
      />

      <div className="grid gap-4 lg:grid-cols-2 mb-5">
        {/* Contact / profile (editable by admin) */}
        <EmployeeContact
          id={e.id}
          canEdit={canEdit}
          initial={{ email: e.email ?? "", phone: e.phone ?? "", personalPhone: e.personalPhone ?? "", title: e.title ?? "", status: e.status, hireDate: e.hireDate ? e.hireDate.toISOString().slice(0, 10) : "" }}
          emailConfigured={emailConfigured()}
        />

        {/* Review snapshot */}
        <Card className="p-4">
          <div className="text-sm font-medium text-ink mb-2">Inspection performance</div>
          <div className="flex items-center gap-4">
            <div className={`grid h-14 w-14 place-items-center rounded-full text-xl font-bold ${grade ? gradeChip(grade) : "bg-black/5 text-muted"}`}>{grade ?? "—"}</div>
            <div>
              <div className="text-2xl font-light tabular-nums">{avgPct == null ? "—" : `${avgPct}%`}</div>
              <div className="text-xs text-muted">Average across {inspections.length} inspection{inspections.length === 1 ? "" : "s"}</div>
            </div>
          </div>
          {assigned.length > 0 ? (
            <div className="mt-3 text-xs text-muted">
              Assigned vehicle{assigned.length === 1 ? "" : "s"}:{" "}
              {assigned.map((v, i) => (
                <span key={v.id}>{i > 0 ? ", " : ""}<Link href={`/fleet/${v.id}`} className="text-brand-700 hover:underline">{v.unitNumber ? `#${v.unitNumber} ` : ""}{v.name}</Link></span>
              ))}
            </div>
          ) : null}
        </Card>
      </div>

      {/* Paid time off — balance + upcoming/recent approved (HR/admin can set allotment) */}
      <PtoProfileCard employeeId={e.id} canManage={canEdit} />

      {/* Attendance / Call-Outs — monitoring record + medical-note rule */}
      <AbsenceCard employeeId={e.id} canManage={canManageAbsenceBranch(user, e.branch)} canResolve={canResolveNotes(user)} />

      {/* Employment status / offboarding (HR & admin) */}
      <Offboarding
        employeeId={e.id}
        employeeName={e.name}
        status={e.status}
        separation={separation}
        canManage={canEdit}
        types={SEPARATION_TYPES.map((t) => ({ key: t.key, label: t.label }))}
        reasons={REASON_CATEGORIES.map((r) => ({ key: r.key, label: r.label }))}
        exitForm={EXIT_INTERVIEW}
      />

      {/* Licenses & credentials (filed under Branch Hub, shown here too) */}
      {licenses.length > 0 ? (
        <Card className="p-0 overflow-hidden mb-5">
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
                    <div className="text-xs text-muted mt-0.5">
                      {[l.licenseNumber ? `#${l.licenseNumber}` : null, l.branch ? `certifies ${branchLabel(l.branch)}` : null].filter(Boolean).join(" · ")}
                    </div>
                  </div>
                  {l.expirationDate ? <span className={`text-xs font-medium ${days != null && days <= 0 ? "text-red-600" : days != null && days <= 90 ? "text-amber-600" : "text-muted"}`}>expires {dateShort(l.expirationDate)}{days != null && days > 0 ? ` · ${days}d` : ""}</span> : null}
                </li>
              );
            })}
          </ul>
        </Card>
      ) : null}

      {/* Reminders tagged to this employee */}
      <RemindersCard
        preset={{ employeeId: e.id, label: e.name }}
        canManage={user.role === "admin" || user.role === "manager" || hr}
        reminders={empReminders.map((r) => ({ id: r.id, title: r.title, notes: r.notes, dueDate: r.dueDate.toISOString(), severity: r.severity, status: r.status }))}
      />

      {/* Inspection history */}
      <Card className="p-0 overflow-hidden mb-5">
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
                    <td className="px-3 py-2">
                      <Link href={`/fleet/${i.vehicleId}/inspect?year=${i.year}&month=${i.month}`} className="text-brand-700 hover:underline">
                        {i.vehicle.unitNumber ? `#${i.vehicle.unitNumber} · ` : ""}{i.vehicle.name}
                      </Link>
                    </td>
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

      {/* Audit ride-alongs */}
      {rideAlongs.length > 0 ? (
        <Card className="p-0 overflow-hidden mb-5">
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

      {/* Personnel records — write-ups, notes, recognition, accidents (HR view) */}
      <Card className="p-0 overflow-hidden mb-5">
        <div className="px-4 py-3 border-b border-line text-sm font-medium text-ink">Personnel records</div>
        {records.length === 0 ? (
          <p className="px-4 py-8 text-center text-sm text-muted">No write-ups, notes, or reports filed.</p>
        ) : (
          <ul className="divide-y divide-line">
            {records.map((r) => (
              <li key={r.id} className="px-4 py-3">
                <div className="flex items-center gap-2">
                  <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${RECORD_STYLE[r.type] ?? "bg-slate-100 text-slate-600"}`}>{RECORD_LABEL[r.type] ?? r.type}{r.category ? ` · ${r.category}` : ""}</span>
                  <span className="text-xs text-muted">{dateShort(r.createdAt)} · filed by {r.authorName ?? "—"}</span>
                </div>
                {r.title ? <div className="mt-1 text-sm font-medium text-ink">{r.title}</div> : null}
                {r.body ? <div className="mt-0.5 text-sm text-muted whitespace-pre-line">{r.body}</div> : null}
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
            ))}
          </ul>
        )}
      </Card>

      {/* Training record (personnel folder) */}
      <Card className="p-0 overflow-hidden mb-5">
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
                    <td className="px-4 py-2 text-center">
                      <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${t.status === "completed" ? "bg-emerald-100 text-emerald-700" : t.status === "in_progress" ? "bg-amber-100 text-amber-700" : "bg-red-100 text-red-600"}`}>{TRAINING_STATUS[t.status]}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* New-hire 30 / 60-day reviews */}
      <Card className="p-0 overflow-hidden mb-5">
        <div className="px-4 py-3 border-b border-line flex items-center justify-between">
          <div className="text-sm font-medium text-ink">New-hire reviews</div>
          {hr ? <Link href="/management/people/reviews" className="text-xs font-medium text-brand-300 hover:underline">Manage →</Link> : null}
        </div>
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
                {r.status === "completed" ? (
                  <div className="mt-1.5 flex flex-wrap gap-3 text-[11px] text-muted">
                    {r.reviewerSignedName ? <span>Reviewer: {r.reviewerSignedName} ✅</span> : null}
                    {r.employeeSignedName ? <span>Employee: {r.employeeSignedName} ✅</span> : null}
                    {r.hrSignedName ? <span>HR: {r.hrSignedName} ✅</span> : null}
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </Card>

      {/* Annual review — placeholder */}
      <Card className="p-4">
        <div className="flex items-center gap-2 mb-1">
          <div className="text-sm font-medium text-ink">Annual review</div>
          <span className="rounded-full bg-black/5 px-2 py-0.5 text-[11px] text-muted">Coming soon</span>
        </div>
        <p className="text-xs text-muted">
          The technician annual review will live here, mirroring the manager quarterly scorecard. It will
          aggregate this profile&rsquo;s inspection scores{avgPct != null ? ` (currently ${avgPct}% avg, grade ${grade})` : ""} and
          audit ride-along ratings as data points in the review.
        </p>
      </Card>
    </>
  );
}
