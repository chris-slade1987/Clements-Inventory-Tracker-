import { prisma } from "@/lib/prisma";
import { absencesForEmployee } from "@/lib/absence";
import { dateShort } from "@/lib/format";
import AbsenceLogger from "@/components/AbsenceLogger";

// Employee-profile "Attendance / Call-Outs" section. Shows compliance banners
// (outstanding medical note / workplace-injury link), a calendar-based logger,
// note-resolution controls (HR/admin), and the call-out history. Server
// component — reads the data, then hands plain props to the client logger.
//
// Separate from PTO by design: this is a monitoring record with no allowance.
export default async function AbsenceCard({
  employeeId,
  canManage = false,
  canResolve = false,
}: {
  employeeId: string;
  canManage?: boolean;
  canResolve?: boolean;
}) {
  const [employee, absences] = await Promise.all([
    prisma.employee.findUnique({ where: { id: employeeId }, select: { id: true, name: true, branch: true } }),
    absencesForEmployee(employeeId),
  ]);
  if (!employee) return null;

  const accidentRecords = await prisma.personnelRecord.findMany({
    where: { employeeId, type: "accident" },
    select: { id: true, title: true, incidentDate: true, createdAt: true },
    orderBy: { createdAt: "desc" },
  });
  const accidentById = new Map(accidentRecords.map((r) => [r.id, r]));

  // Banner (a): an outstanding medical note (illness > 2 days, not yet resolved).
  const outstandingNote = absences.find((a) => a.noteRequired && a.noteStatus === "requested");
  // Banner (b): out due to a workplace injury linked to an accident report.
  const injury = absences.find((a) => a.reason === "physical_injury" && a.workplaceRelated === true && a.accidentRecordId);
  const injuryRec = injury?.accidentRecordId ? accidentById.get(injury.accidentRecordId) : undefined;

  const fmtUTC = (d: Date) => d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
  const rangeOf = (a: { startDate: Date; endDate: Date; days: number }) =>
    a.days > 1 ? `${fmtUTC(a.startDate)} – ${fmtUTC(a.endDate)}` : fmtUTC(a.startDate);

  const accidentLabel = (r: { title: string | null; incidentDate: Date | null; createdAt: Date }) =>
    `${r.title || "Accident report"}${r.incidentDate ? ` — ${dateShort(r.incidentDate)}` : ` — filed ${dateShort(r.createdAt)}`}`;

  return (
    <div className="mb-5">
      {/* Compliance banners */}
      {outstandingNote ? (
        <div className="mb-2 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          <span className="font-semibold">Medical note requested</span> for {rangeOf(outstandingNote)} — awaiting proof.
          {canResolve ? " Mark it received or waive it below." : " HR is tracking this."}
        </div>
      ) : null}
      {injury && injuryRec ? (
        <div className="mb-2 rounded-xl border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-800">
          <span className="font-semibold">Out due to workplace injury</span> — {rangeOf(injury)}, linked to accident report{" "}
          <span className="font-medium">“{accidentLabel(injuryRec)}”</span>.
        </div>
      ) : null}

      <AbsenceLogger
        employeeId={employee.id}
        employeeName={employee.name}
        canManage={canManage}
        canResolve={canResolve}
        accidents={accidentRecords.map((r) => ({ id: r.id, label: accidentLabel(r) }))}
        absences={absences.map((a) => ({
          id: a.id,
          startDate: a.startDate.toISOString(),
          endDate: a.endDate.toISOString(),
          days: a.days,
          reason: a.reason,
          reasonDetail: a.reasonDetail,
          excused: a.excused,
          workplaceRelated: a.workplaceRelated,
          accidentRecordId: a.accidentRecordId,
          noteRequired: a.noteRequired,
          noteStatus: a.noteStatus,
          noteResolvedBy: a.noteResolvedBy,
          loggedByName: a.loggedByName,
        }))}
      />
    </div>
  );
}
