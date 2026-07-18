import Link from "next/link";
import { Card, PageHeader, EmptyState } from "@/components/ui";
import { requireUser } from "@/lib/auth";
import { money } from "@/lib/format";
import { BRANCHES, branchLabel } from "@/lib/management";
import { fleetFuelOverview } from "@/lib/fuel";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";
export const metadata = { title: "Fuel — Clements Command & Control" };

const MONTH_LABEL = (ym: string) => {
  const [y, m] = ym.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString("en-US", { month: "short", year: "2-digit", timeZone: "UTC" });
};

export default async function FleetFuelPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  await requireUser();
  const sp = await searchParams;
  const branch = BRANCHES.find((b) => b.key === sp.branch)?.key ?? null;

  const [ov, unlinkedCount, period] = await Promise.all([
    fleetFuelOverview(branch),
    prisma.fuelTransaction.count({ where: { matchMethod: "none", ...(branch ? { branch } : {}) } }),
    prisma.fuelTransaction.aggregate({ _min: { periodStart: true }, _max: { periodEnd: true } }),
  ]);

  const maxMonth = Math.max(1, ...ov.months.map((m) => m.spend));
  const periodLabel =
    period._min.periodStart && period._max.periodEnd
      ? `${period._min.periodStart.toLocaleDateString("en-US", { month: "short", year: "numeric", timeZone: "UTC" })} – ${period._max.periodEnd.toLocaleDateString("en-US", { month: "short", year: "numeric", timeZone: "UTC" })}`
      : "";

  return (
    <>
      <PageHeader title="Fuel" subtitle={`Coast fuel-card spend linked to vehicles${periodLabel ? ` · ${periodLabel}` : ""}`} />

      <div className="mb-4 flex flex-wrap gap-1 rounded-xl bg-black/20 p-1 w-fit">
        <BranchPill href="/fleet/fuel" label="All branches" active={branch === null} />
        {BRANCHES.map((b) => (
          <BranchPill key={b.key} href={`/fleet/fuel?branch=${b.key}`} label={b.label} active={branch === b.key} />
        ))}
      </div>

      {ov.txCount === 0 ? (
        <EmptyState title="No fuel data yet" hint="Coast statements haven't been imported for this scope." />
      ) : (
        <>
          <div className="grid gap-3 grid-cols-2 lg:grid-cols-4 mb-5">
            <Tile label="Fuel spend" value={money(ov.totalSpend)} />
            <Tile label="Gallons" value={ov.totalGallons.toLocaleString(undefined, { maximumFractionDigits: 0 })} />
            <Tile label="Avg $/gal" value={ov.totalGallons > 0 ? `$${(ov.totalSpend / ov.totalGallons).toFixed(2)}` : "—"} />
            <Tile label="Vehicles fueled" value={String(ov.vehicleCount)} />
          </div>

          {/* Monthly spend bars */}
          {ov.months.length > 1 ? (
            <Card className="p-4 mb-5">
              <div className="text-sm font-medium text-ink mb-3">Spend by statement month</div>
              <div className="space-y-1.5">
                {ov.months.map((m) => (
                  <div key={m.month} className="flex items-center gap-3">
                    <div className="w-12 shrink-0 text-xs text-muted tabular-nums">{MONTH_LABEL(m.month)}</div>
                    <div className="flex-1 h-5 rounded bg-black/[0.04] overflow-hidden">
                      <div className="h-full bg-emerald-grad rounded" style={{ width: `${(m.spend / maxMonth) * 100}%` }} />
                    </div>
                    <div className="w-20 shrink-0 text-right text-xs tabular-nums text-ink">{money(m.spend)}</div>
                  </div>
                ))}
              </div>
              {(ov.fees !== 0 || ov.rebates !== 0) ? (
                <div className="mt-3 pt-3 border-t border-line text-xs text-muted flex flex-wrap gap-4">
                  {ov.fees !== 0 ? <span>Card subscription fees: <span className="text-ink">{money(ov.fees)}</span></span> : null}
                  {ov.rebates !== 0 ? <span>Rebates &amp; credits: <span className="text-brand-700">{money(ov.rebates)}</span></span> : null}
                  <span className="text-muted/70">(account-level — not tied to a vehicle)</span>
                </div>
              ) : null}
            </Card>
          ) : null}

          {/* Per-vehicle table */}
          <Card className="p-0 overflow-hidden">
            <div className="px-4 py-3 border-b border-line flex items-center justify-between">
              <div className="text-sm font-medium text-ink">Spend by vehicle</div>
              {unlinkedCount > 0 ? (
                <span className="text-xs text-amber-600">{unlinkedCount} transaction{unlinkedCount === 1 ? "" : "s"} not linked</span>
              ) : (
                <span className="text-xs text-brand-700">All purchases linked ✓</span>
              )}
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-muted border-b border-line">
                    <th className="px-4 py-2 font-medium">Vehicle</th>
                    <th className="px-3 py-2 font-medium">Branch</th>
                    <th className="px-3 py-2 font-medium text-right">Fills</th>
                    <th className="px-3 py-2 font-medium text-right">Gallons</th>
                    <th className="px-3 py-2 font-medium text-right">Avg MPG</th>
                    <th className="px-3 py-2 font-medium text-right">Spend</th>
                  </tr>
                </thead>
                <tbody>
                  {ov.vehicles.map((v) => (
                    <tr key={v.id} className="border-b border-line last:border-0">
                      <td className="px-4 py-2">
                        <Link href={`/fleet/${v.id}`} className="font-medium text-brand-700 hover:underline">
                          {v.unit ? `${v.unit} · ` : ""}{v.name}
                        </Link>
                      </td>
                      <td className="px-3 py-2 text-muted">{v.branch ? branchLabel(v.branch) : "—"}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{v.count}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{v.gallons.toLocaleString(undefined, { maximumFractionDigits: 0 })}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{v.avgMpg ? v.avgMpg.toFixed(1) : "—"}</td>
                      <td className="px-3 py-2 text-right tabular-nums font-medium">{money(v.spend)}</td>
                    </tr>
                  ))}
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
    <Link href={href} className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${active ? "bg-emerald-grad text-[#05271c] shadow" : "text-mint hover:text-white"}`}>
      {label}
    </Link>
  );
}

function Tile({ label, value }: { label: string; value: string }) {
  return (
    <Card className="p-4">
      <div className="text-xs uppercase tracking-wider text-muted">{label}</div>
      <div className="mt-1 text-2xl font-light tabular-nums">{value}</div>
    </Card>
  );
}
