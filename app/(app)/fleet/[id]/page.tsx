import Link from "next/link";
import { notFound } from "next/navigation";
import { Card, PageHeader } from "@/components/ui";
import { requireUser } from "@/lib/auth";
import { money, dateShort } from "@/lib/format";
import { branchLabel } from "@/lib/management";
import { vehicleDetail, serviceLabel, dispositionLabel, DISPOSITIONS } from "@/lib/fleet";
import { vehicleFuel } from "@/lib/fuel";
import VehicleFuelPanel from "@/components/VehicleFuelPanel";
import { docsForVehicle } from "@/lib/documents";
import { remindersForVehicle } from "@/lib/manual-reminders";
import { vehicleInspections } from "@/lib/inspection";
import ServiceForm from "./ServiceForm";
import VehicleDisposition from "./VehicleDisposition";
import VehicleDocuments from "./VehicleDocuments";
import RemindersCard from "@/components/RemindersCard";
import VehicleGpsPanel from "@/components/gps/VehicleGpsPanel";

export const dynamic = "force-dynamic";

export default async function VehiclePage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await params;
  const detail = await vehicleDetail(id);
  if (!detail) notFound();
  const { vehicle: v, services, totalCost } = detail;
  const inspections = await vehicleInspections(id);
  const documents = await docsForVehicle(id);
  const reminders = await remindersForVehicle(id);
  const fuel = await vehicleFuel(id, 1000);
  const canManage = user.role === "admin" || user.role === "manager";
  const now = new Date();
  const thisMonthDone = inspections.some((i) => i.year === now.getFullYear() && i.month === now.getMonth() + 1);

  return (
    <>
      <div className="mb-2">
        <Link href="/fleet" className="text-xs font-medium text-brand-700 hover:underline">← Fleet</Link>
      </div>
      <PageHeader
        title={`${v.unitNumber ? `${v.unitNumber} · ` : ""}${v.name}`}
        subtitle={[v.branch ? branchLabel(v.branch) : null, v.plate, v.vin].filter(Boolean).join(" · ") || "Vehicle"}
      />

      <div className="grid gap-3 grid-cols-2 lg:grid-cols-4 mb-5">
        <Info label="Mileage" value={v.currentMileage != null ? v.currentMileage.toLocaleString() : "—"} />
        <Info label="Total maintenance" value={money(totalCost)} />
        <Info label="Cost / mile" value={v.currentMileage && v.currentMileage > 0 ? `$${(totalCost / v.currentMileage).toFixed(3)}` : "—"} />
        <Info label="Status" value={v.status === "active" ? "Active" : dispositionLabel(v.disposition)} />
      </div>

      {v.status !== "active" ? (
        <Card className="p-4 mb-5 ring-1 ring-slate-200 bg-slate-50">
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-full bg-slate-200 px-2 py-0.5 text-[11px] font-medium text-slate-700">Out of service · {dispositionLabel(v.disposition)}</span>
            {v.dispositionDate ? <span className="text-xs text-muted">{dateShort(v.dispositionDate)}</span> : null}
            {v.salePrice != null ? <span className="text-xs text-muted">· sale {money(v.salePrice)}</span> : null}
          </div>
          {v.dispositionNotes ? <p className="mt-2 text-sm text-muted whitespace-pre-line">{v.dispositionNotes}</p> : null}
        </Card>
      ) : null}

      {user.role === "admin" ? (
        <div className="mb-5">
          <VehicleDisposition
            vehicleId={v.id}
            status={v.status}
            dispositions={DISPOSITIONS.map((d) => ({ key: d.key, label: d.label }))}
            current={{ disposition: v.disposition, dispositionDate: v.dispositionDate ? v.dispositionDate.toISOString() : null, salePrice: v.salePrice, dispositionNotes: v.dispositionNotes }}
          />
        </div>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-2 mb-5">
        <Card className="p-4">
          <div className="text-sm font-medium text-ink mb-2">Profile</div>
          <dl className="space-y-1.5 text-sm">
            <Field label="Assigned driver" value={v.assignedTo} />
            <Field label="Year / Make / Model" value={[v.year, v.make, v.model].filter(Boolean).join(" ") || null} />
            <Field label="VIN" value={v.vin} />
            <Field label="Plate" value={v.plate} />
            <Field label="Fuel card" value={v.driverCard} />
            <Field label="GPS" value={v.gps} />
            <Field label="Registration renewal" value={v.registrationRenewal ? dateShort(v.registrationRenewal) : null} />
            <Field label="Mileage as of" value={v.mileageAsOf ? dateShort(v.mileageAsOf) : null} />
          </dl>
          {v.statusNotes ? (
            <div className="mt-3 rounded-lg bg-amber-50 border border-amber-200 p-2 text-xs text-amber-800 whitespace-pre-line">{v.statusNotes}</div>
          ) : null}
        </Card>

        <Card className={`p-4 ${(v.loanBank || v.loanNumber || v.monthlyPayment) ? "ring-1 ring-amber-300" : ""}`}>
          <div className="text-sm font-medium text-ink mb-2">
            Financing {(v.loanBank || v.loanNumber || v.monthlyPayment) ? <span className="ml-1 rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-700">On loan</span> : <span className="ml-1 text-[11px] text-muted">Owned outright</span>}
          </div>
          {(v.loanBank || v.loanNumber || v.monthlyPayment) ? (
            <dl className="space-y-1.5 text-sm">
              <Field label="Bank" value={v.loanBank} />
              <Field label="Loan #" value={v.loanNumber} />
              <Field label="Monthly payment" value={v.monthlyPayment != null ? money(v.monthlyPayment) : null} />
              <Field label="Balance" value={v.loanBalance != null ? money(v.loanBalance) : null} />
              <Field label="Maturity / payoff" value={v.payoffDate ? dateShort(v.payoffDate) : null} />
            </dl>
          ) : (
            <p className="text-sm text-muted">No active loan on this vehicle.</p>
          )}
          {v.purchasePrice != null ? <div className="mt-2 text-xs text-muted">Purchase price: {money(v.purchasePrice)}</div> : null}
        </Card>
      </div>

      {/* GPS / Location — near-real-time position, trail & today's trips */}
      <VehicleGpsPanel vehicleId={v.id} />

      {/* Fuel — Coast card purchases linked to this vehicle, with range switch */}
      <VehicleFuelPanel
        rows={fuel.rows.map((f) => ({
          id: f.id,
          date: f.date.toISOString(),
          driverName: f.driverName,
          merchant: f.merchant,
          gallons: f.gallons,
          costPerGallon: f.costPerGallon,
          calculatedMpg: f.calculatedMpg,
          odometer: f.odometer,
          amount: f.amount,
          type: f.type,
        }))}
      />

      {/* Documents — insurance, registration, title, bill of sale */}
      <VehicleDocuments
        vehicleId={v.id}
        vehicleLabel={`${v.unitNumber ? `#${v.unitNumber} · ` : ""}${v.name}`}
        sold={v.status !== "active"}
        canManage={canManage}
        documents={documents.map((d) => ({ id: d.id, title: d.title, category: d.category, filePath: d.filePath, insurer: d.insurer, policyNumber: d.policyNumber, expirationDate: d.expirationDate ? d.expirationDate.toISOString() : null }))}
      />

      {/* Reminders tagged to this vehicle */}
      <RemindersCard
        preset={{ vehicleId: v.id, label: `${v.unitNumber ? `#${v.unitNumber} · ` : ""}${v.name}` }}
        canManage={canManage}
        reminders={reminders.map((r) => ({ id: r.id, title: r.title, notes: r.notes, dueDate: r.dueDate.toISOString(), severity: r.severity, status: r.status }))}
      />

      {/* Monthly inspection */}
      <Card className="p-0 overflow-hidden mb-5">
        <div className="px-4 py-3 border-b border-line flex items-center justify-between gap-2">
          <div className="text-sm font-medium text-ink">
            Monthly inspection
            {thisMonthDone ? (
              <span className="ml-2 rounded-full bg-brand-100 px-2 py-0.5 text-[11px] font-medium text-brand-700">This month done</span>
            ) : (
              <span className="ml-2 rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-700">Due this month</span>
            )}
          </div>
          {user.role === "admin" || user.role === "manager" ? (
            <Link href={`/fleet/${v.id}/inspect`} className="text-xs font-medium text-brand-700 hover:underline">
              {thisMonthDone ? "View / edit →" : "Start inspection →"}
            </Link>
          ) : null}
        </div>
        {inspections.length === 0 ? (
          <p className="px-4 py-6 text-center text-sm text-muted">No inspections recorded yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-muted border-b border-line">
                  <th className="px-4 py-2 font-medium">Period</th>
                  <th className="px-3 py-2 font-medium">Date</th>
                  <th className="px-3 py-2 font-medium">Technician</th>
                  <th className="px-3 py-2 font-medium">Inspector</th>
                  <th className="px-3 py-2 font-medium text-right">Score</th>
                  <th className="px-4 py-2 font-medium text-center">Grade</th>
                </tr>
              </thead>
              <tbody>
                {inspections.map((ins) => (
                  <tr key={ins.id} className="border-b border-line last:border-0">
                    <td className="px-4 py-2 whitespace-nowrap">{MONTH_ABBR[ins.month]} {ins.year}</td>
                    <td className="px-3 py-2 whitespace-nowrap">{dateShort(ins.date)}</td>
                    <td className="px-3 py-2 text-muted">{ins.technicianName ?? "—"}</td>
                    <td className="px-3 py-2 text-muted">{ins.inspectorName ?? "—"}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{ins.score}/{ins.maxScore} · {ins.scorePct}%</td>
                    <td className="px-4 py-2 text-center">
                      <span className={`inline-grid h-6 w-6 place-items-center rounded-full text-xs font-bold ${ins.grade === "A" || ins.grade === "B" ? "bg-emerald-100 text-emerald-700" : ins.grade === "C" ? "bg-amber-100 text-amber-700" : "bg-red-100 text-red-700"}`}>{ins.grade}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {user.role === "admin" ? <ServiceForm vehicleId={v.id} /> : null}

      <Card className="p-0 overflow-hidden">
        <div className="px-4 py-3 border-b border-line text-sm font-medium text-ink">Service history</div>
        {services.length === 0 ? (
          <p className="px-4 py-8 text-center text-sm text-muted">No service records yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-muted border-b border-line">
                  <th className="px-4 py-2 font-medium">Date</th>
                  <th className="px-3 py-2 font-medium">Type</th>
                  <th className="px-3 py-2 font-medium">Description</th>
                  <th className="px-3 py-2 font-medium text-right">Mileage</th>
                  <th className="px-3 py-2 font-medium">Vendor</th>
                  <th className="px-3 py-2 font-medium">Next due</th>
                  <th className="px-4 py-2 font-medium text-right">Cost</th>
                </tr>
              </thead>
              <tbody>
                {services.map((s) => (
                  <tr key={s.id} className="border-b border-line last:border-0">
                    <td className="px-4 py-2 whitespace-nowrap">{dateShort(s.date)}</td>
                    <td className="px-3 py-2">{serviceLabel(s.type)}</td>
                    <td className="px-3 py-2 text-muted">{s.description ?? "—"}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{s.mileage != null ? s.mileage.toLocaleString() : "—"}</td>
                    <td className="px-3 py-2 text-muted">{s.vendor ?? "—"}</td>
                    <td className="px-3 py-2 text-muted">
                      {s.nextDueDate ? dateShort(s.nextDueDate) : s.nextDueMileage != null ? `${s.nextDueMileage.toLocaleString()} mi` : "—"}
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums font-medium">{money(s.cost)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </>
  );
}

const MONTH_ABBR = ["", "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function Info({ label, value }: { label: string; value: string }) {
  return (
    <Card className="p-4">
      <div className="text-xs uppercase tracking-wider text-muted">{label}</div>
      <div className="mt-1 text-xl font-light tabular-nums">{value}</div>
    </Card>
  );
}

function Field({ label, value }: { label: string; value: string | number | null }) {
  return (
    <div className="flex justify-between gap-3">
      <dt className="text-muted">{label}</dt>
      <dd className="text-ink text-right">{value != null && value !== "" ? value : "—"}</dd>
    </div>
  );
}
