import Link from "next/link";
import { notFound } from "next/navigation";
import { Card, PageHeader } from "@/components/ui";
import { requireUser } from "@/lib/auth";
import { money, dateShort } from "@/lib/format";
import { branchLabel } from "@/lib/management";
import { vehicleDetail, serviceLabel } from "@/lib/fleet";
import ServiceForm from "./ServiceForm";

export const dynamic = "force-dynamic";

export default async function VehiclePage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await params;
  const detail = await vehicleDetail(id);
  if (!detail) notFound();
  const { vehicle: v, services, totalCost } = detail;

  return (
    <>
      <div className="mb-2">
        <Link href="/fleet" className="text-xs font-medium text-brand-300 hover:underline">← Fleet</Link>
      </div>
      <PageHeader
        title={`${v.unitNumber ? `${v.unitNumber} · ` : ""}${v.name}`}
        subtitle={[v.branch ? branchLabel(v.branch) : null, v.plate, v.vin].filter(Boolean).join(" · ") || "Vehicle"}
      />

      <div className="grid gap-3 grid-cols-2 lg:grid-cols-4 mb-5">
        <Info label="Mileage" value={v.currentMileage != null ? v.currentMileage.toLocaleString() : "—"} />
        <Info label="Total maintenance" value={money(totalCost)} />
        <Info label="Cost / mile" value={v.currentMileage && v.currentMileage > 0 ? `$${(totalCost / v.currentMileage).toFixed(3)}` : "—"} />
        <Info label="Status" value={v.status === "active" ? "Active" : "Retired"} />
      </div>

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
