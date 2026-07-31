import Link from "next/link";
import { PageHeader, EmptyState } from "@/components/ui";
import { requireUser } from "@/lib/auth";
import { BRANCHES, branchLabel } from "@/lib/management";
import { fleetFuelRows, coastFuelStatus } from "@/lib/fuel";
import { prisma } from "@/lib/prisma";
import FuelStatementUpload from "@/components/FuelStatementUpload";
import FuelCoastSync from "@/components/FuelCoastSync";
import FleetFuelDashboard from "@/components/FleetFuelDashboard";

export const dynamic = "force-dynamic";
export const metadata = { title: "Fuel — Clements Command & Control" };

export default async function FleetFuelPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const user = await requireUser();
  const canUpload = user.role === "admin" || user.role === "manager";
  const sp = await searchParams;
  const branch = BRANCHES.find((b) => b.key === sp.branch)?.key ?? null;

  const isAdmin = user.role === "admin";
  const [data, period, coast] = await Promise.all([
    fleetFuelRows(branch),
    prisma.fuelTransaction.aggregate({ _min: { periodStart: true }, _max: { periodEnd: true } }),
    isAdmin ? coastFuelStatus() : Promise.resolve(null),
  ]);

  const periodLabel =
    period._min.periodStart && period._max.periodEnd
      ? `${period._min.periodStart.toLocaleDateString("en-US", { month: "short", year: "numeric", timeZone: "UTC" })} – ${period._max.periodEnd.toLocaleDateString("en-US", { month: "short", year: "numeric", timeZone: "UTC" })}`
      : "";

  return (
    <>
      <PageHeader title="Fuel" subtitle={`Coast fuel-card spend linked to vehicles${periodLabel ? ` · imported ${periodLabel}` : ""}`} />

      {isAdmin && coast ? (
        <FuelCoastSync configured={coast.configured} cursor={coast.cursor} apiRowCount={coast.apiRowCount} />
      ) : null}

      {canUpload ? <FuelStatementUpload /> : null}

      <div className="mb-4 flex flex-wrap gap-1 rounded-xl bg-black/20 p-1 w-fit">
        <BranchPill href="/fleet/fuel" label="All branches" active={branch === null} />
        {BRANCHES.map((b) => (
          <BranchPill key={b.key} href={`/fleet/fuel?branch=${b.key}`} label={b.label} active={branch === b.key} />
        ))}
      </div>

      {data.rows.length === 0 ? (
        <EmptyState title="No fuel data yet" hint="Coast statements haven't been imported for this scope." />
      ) : (
        <FleetFuelDashboard rows={data.rows} months={data.months} fees={data.fees} rebates={data.rebates} />
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
