import Link from "next/link";
import { Card, PageHeader, EmptyState } from "@/components/ui";
import { requireUser } from "@/lib/auth";
import { money, dateShort } from "@/lib/format";
import { BRANCHES, branchLabel } from "@/lib/management";
import { listVehicles, isDueSoon } from "@/lib/fleet";
import { managerReminders } from "@/lib/reminders";
import FleetControls from "./FleetControls";

export const dynamic = "force-dynamic";

export default async function FleetPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const user = await requireUser();
  const sp = await searchParams;
  const branch = BRANCHES.find((b) => b.key === sp.branch)?.key ?? null;
  const vehicles = await listVehicles(branch ?? undefined);
  const reminders = await managerReminders(branch ?? undefined);
  const active = vehicles.filter((v) => v.status === "active");
  const ytdSpend = vehicles.reduce((s, v) => s + v.ytdCost, 0);
  const cpmVals = vehicles.map((v) => v.costPerMile).filter((n): n is number => n != null);
  const avgCpm = cpmVals.length ? cpmVals.reduce((s, n) => s + n, 0) / cpmVals.length : null;
  const dueSoon = vehicles.filter((v) => v.status === "active" && isDueSoon(v));

  return (
    <>
      <PageHeader title="Fleet" subtitle="Vehicles, maintenance & operating cost" />

      {user.role === "admin" ? <FleetControls /> : null}

      <div className="mb-4 flex flex-wrap gap-1 rounded-xl bg-black/20 p-1 w-fit">
        <BranchPill href="/fleet" label="All branches" active={branch === null} />
        {BRANCHES.map((b) => (
          <BranchPill
            key={b.key}
            href={`/fleet?branch=${b.key}`}
            label={b.label}
            active={branch === b.key}
          />
        ))}
      </div>

      {reminders.length > 0 ? (
        <Link href="/my-branch" className="mb-4 flex items-center gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 hover:bg-amber-100/70">
          <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-amber-100 text-amber-700">
            <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={1.8}><path d="M12 3a6 6 0 00-6 6c0 5-2 6-2 6h16s-2-1-2-6a6 6 0 00-6-6zM10.5 20a2 2 0 003 0" strokeLinecap="round" strokeLinejoin="round" /></svg>
          </span>
          <span className="flex-1 text-sm">
            <span className="font-medium text-amber-800">{reminders.length} reminder{reminders.length === 1 ? "" : "s"} need attention</span>
            <span className="block text-xs text-amber-700">{reminders.slice(0, 2).map((r) => r.detail).join(" · ")}{reminders.length > 2 ? " …" : ""}</span>
          </span>
          <span className="text-amber-700 text-sm">View →</span>
        </Link>
      ) : null}

      {vehicles.length === 0 ? (
        <EmptyState
          title={branch ? `No vehicles in ${branchLabel(branch)}` : "No vehicles yet"}
          hint={
            branch
              ? "Try another branch or view all branches."
              : user.role === "admin"
                ? "Add a vehicle or import your fleet sheet to get started."
                : "Ask an admin to load the fleet."
          }
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

function BranchPill({ href, label, active }: { href: string; label: string; active: boolean }) {
  return (
    <Link
      href={href}
      className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
        active ? "bg-emerald-grad text-[#05271c] shadow" : "text-mint hover:text-white"
      }`}
    >
      {label}
    </Link>
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
