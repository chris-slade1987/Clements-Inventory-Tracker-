import Link from "next/link";
import { Card, PageHeader, EmptyState } from "@/components/ui";
import { requireUser } from "@/lib/auth";
import { money, dateShort } from "@/lib/format";
import { branchLabel } from "@/lib/management";
import { listVehicles, isDueSoon } from "@/lib/fleet";
import FleetControls from "./FleetControls";

export const dynamic = "force-dynamic";

export default async function FleetPage() {
  const user = await requireUser();
  const vehicles = await listVehicles();
  const active = vehicles.filter((v) => v.status === "active");
  const ytdSpend = vehicles.reduce((s, v) => s + v.ytdCost, 0);
  const cpmVals = vehicles.map((v) => v.costPerMile).filter((n): n is number => n != null);
  const avgCpm = cpmVals.length ? cpmVals.reduce((s, n) => s + n, 0) / cpmVals.length : null;
  const dueSoon = vehicles.filter((v) => v.status === "active" && isDueSoon(v));

  return (
    <>
      <PageHeader title="Fleet" subtitle="Vehicles, maintenance & operating cost" />

      {user.role === "admin" ? <FleetControls /> : null}

      {vehicles.length === 0 ? (
        <EmptyState
          title="No vehicles yet"
          hint={user.role === "admin" ? "Add a vehicle or import your fleet sheet to get started." : "Ask an admin to load the fleet."}
        />
      ) : (
        <>
          <div className="grid gap-3 grid-cols-2 lg:grid-cols-4 mb-5">
            <Tile label="Active vehicles" value={String(active.length)} />
            <Tile label="Maintenance spend · YTD" value={money(ytdSpend)} />
            <Tile label="Avg cost / mile" value={avgCpm == null ? "—" : `$${avgCpm.toFixed(3)}`} />
            <Tile label="Due for service" value={String(dueSoon.length)} tone={dueSoon.length > 0 ? "warn" : undefined} />
          </div>

          <Card className="p-0 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-muted border-b border-line">
                    <th className="px-4 py-2 font-medium">Vehicle</th>
                    <th className="px-3 py-2 font-medium">Branch</th>
                    <th className="px-3 py-2 font-medium text-right">Mileage</th>
                    <th className="px-3 py-2 font-medium text-right">YTD cost</th>
                    <th className="px-3 py-2 font-medium text-right">Total cost</th>
                    <th className="px-3 py-2 font-medium text-right">$/mile</th>
                    <th className="px-3 py-2 font-medium">Loan</th>
                    <th className="px-3 py-2 font-medium">Next due</th>
                  </tr>
                </thead>
                <tbody>
                  {vehicles.map((v) => {
                    const due = v.status === "active" && isDueSoon(v);
                    return (
                      <tr key={v.id} className={`border-b border-line last:border-0 ${v.status !== "active" ? "opacity-50" : ""}`}>
                        <td className="px-4 py-2">
                          <Link href={`/fleet/${v.id}`} className="font-medium text-brand-700 hover:underline">
                            {v.unitNumber ? `${v.unitNumber} · ` : ""}{v.name}
                          </Link>
                          {v.status !== "active" ? <span className="ml-2 text-[10px] uppercase text-muted">retired</span> : null}
                        </td>
                        <td className="px-3 py-2 text-muted">{v.branch ? branchLabel(v.branch) : "—"}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{v.currentMileage != null ? v.currentMileage.toLocaleString() : "—"}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{money(v.ytdCost)}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{money(v.totalCost)}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{v.costPerMile == null ? "—" : `$${v.costPerMile.toFixed(3)}`}</td>
                        <td className="px-3 py-2">
                          {v.hasLoan ? (
                            <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-700">
                              {v.monthlyPayment != null ? `${money(v.monthlyPayment)}/mo` : "Loan"}
                            </span>
                          ) : (
                            <span className="text-[11px] text-muted">Owned</span>
                          )}
                        </td>
                        <td className={`px-3 py-2 ${due ? "text-amber-600 font-medium" : "text-muted"}`}>
                          {v.nextDueDate ? dateShort(v.nextDueDate) : v.nextDueMileage != null ? `${v.nextDueMileage.toLocaleString()} mi` : "—"}
                          {due ? " · due" : ""}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Card>
        </>
      )}
    </>
  );
}

function Tile({ label, value, tone }: { label: string; value: string; tone?: "warn" }) {
  return (
    <Card className="p-4">
      <div className="text-xs uppercase tracking-wider text-muted">{label}</div>
      <div className={`mt-1 text-2xl font-light tabular-nums ${tone === "warn" ? "text-amber-600" : ""}`}>{value}</div>
    </Card>
  );
}
