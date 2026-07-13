import Link from "next/link";
import { notFound } from "next/navigation";
import { Card, PageHeader } from "@/components/ui";
import { requireUser } from "@/lib/auth";
import { dateShort } from "@/lib/format";
import { branchLabel } from "@/lib/management";
import { employeeDetail } from "@/lib/people";
import { emailConfigured } from "@/lib/email";
import EmployeeContact from "./EmployeeContact";

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
  const { employee: e, inspections, rideAlongs, assigned, avgPct, grade } = detail;
  const canEdit = user.role === "admin";

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
          initial={{ email: e.email ?? "", phone: e.phone ?? "", title: e.title ?? "", status: e.status }}
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
