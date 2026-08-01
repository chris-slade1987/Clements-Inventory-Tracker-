import Link from "next/link";
import { Card, PageHeader, EmptyState } from "@/components/ui";
import { requireUser } from "@/lib/auth";
import { money, dateShort } from "@/lib/format";
import { BRANCHES, branchLabel } from "@/lib/management";
import { listVehicles, dispositionLabel } from "@/lib/fleet";

export const dynamic = "force-dynamic";

const DISP_STYLE: Record<string, string> = {
  sold: "bg-emerald-100 text-emerald-700",
  traded: "bg-emerald-100 text-emerald-700",
  retired: "bg-slate-100 text-slate-600",
  transferred: "bg-brand-100 text-brand-700",
  totaled: "bg-red-100 text-red-700",
};

export default async function RetiredFleetPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  await requireUser();
  const sp = await searchParams;
  const branch = BRANCHES.find((b) => b.key === sp.branch)?.key ?? null;
  const vehicles = await listVehicles(branch ?? undefined, "inactive");
  const salvage = vehicles.reduce((s, v) => s + (v.salePrice ?? 0), 0);

  return (
    <>
      <div className="mb-2">
        <Link href={`/fleet${branch ? `?branch=${branch}` : ""}`} className="text-xs font-medium text-brand-700 hover:underline">← Fleet</Link>
      </div>
      <PageHeader title="Sold & retired vehicles" subtitle="Out-of-service vehicles — every record (service, inspections, financing) is retained" />

      <div className="mb-4 flex flex-wrap gap-1 rounded-xl bg-black/20 p-1 w-fit">
        <BranchPill href="/fleet/retired" label="All branches" active={branch === null} />
        {BRANCHES.map((b) => <BranchPill key={b.key} href={`/fleet/retired?branch=${b.key}`} label={b.label} active={branch === b.key} />)}
      </div>

      {vehicles.length === 0 ? (
        <EmptyState title="No sold or retired vehicles" hint="When a vehicle leaves service, retire or mark it sold from its detail page — it moves here with all its history." />
      ) : (
        <>
          <div className="grid gap-3 grid-cols-2 lg:grid-cols-3 mb-5">
            <Tile label="Out of service" value={String(vehicles.length)} />
            <Tile label="Sale proceeds recorded" value={money(salvage)} />
            <Tile label="Lifetime maintenance" value={money(vehicles.reduce((s, v) => s + v.totalCost, 0))} />
          </div>

          <Card className="p-0 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-muted border-b border-line">
                    <th className="px-4 py-2 font-medium">Vehicle</th>
                    <th className="px-3 py-2 font-medium">Branch</th>
                    <th className="px-3 py-2 font-medium text-center">Disposition</th>
                    <th className="px-3 py-2 font-medium">Date</th>
                    <th className="px-3 py-2 font-medium text-right">Sale price</th>
                    <th className="px-3 py-2 font-medium text-right">Last mileage</th>
                    <th className="px-4 py-2 font-medium text-right">Lifetime cost</th>
                  </tr>
                </thead>
                <tbody>
                  {vehicles.map((v) => (
                    <tr key={v.id} className="border-b border-line last:border-0">
                      <td className="px-4 py-2">
                        <Link href={`/fleet/${v.id}`} className="font-medium text-brand-700 hover:underline">{v.unitNumber ? `${v.unitNumber} · ` : ""}{v.name}</Link>
                      </td>
                      <td className="px-3 py-2 text-muted">{v.branch ? branchLabel(v.branch) : "—"}</td>
                      <td className="px-3 py-2 text-center">
                        <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${DISP_STYLE[v.disposition ?? "retired"] ?? "bg-slate-100 text-slate-600"}`}>{dispositionLabel(v.disposition)}</span>
                      </td>
                      <td className="px-3 py-2 text-muted whitespace-nowrap">{v.dispositionDate ? dateShort(v.dispositionDate) : "—"}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{v.salePrice != null ? money(v.salePrice) : "—"}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{v.currentMileage != null ? v.currentMileage.toLocaleString() : "—"}</td>
                      <td className="px-4 py-2 text-right tabular-nums">{money(v.totalCost)}</td>
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
    <Link href={href} className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${active ? "bg-emerald-grad text-white shadow" : "text-muted hover:text-ink"}`}>{label}</Link>
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
