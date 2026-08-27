import Link from "next/link";
import { redirect } from "next/navigation";
import { PageHeader, Card, EmptyState } from "@/components/ui";
import { requireUser, canManageSales } from "@/lib/auth";
import { money, qty } from "@/lib/format";
import { BRANCHES, branchLabel } from "@/lib/management";
import { salesTeamRoster, currentPeriodKey, periodLabel } from "@/lib/sales";

export const dynamic = "force-dynamic";

export default async function SalesTeamPage({ searchParams }: { searchParams: Promise<{ branch?: string }> }) {
  const user = await requireUser();
  if (!canManageSales(user)) redirect("/me");

  const sp = await searchParams;
  const branch = BRANCHES.find((b) => b.key === sp.branch)?.key ?? null;
  const periodKey = currentPeriodKey();
  const { rows, totals } = await salesTeamRoster(periodKey, branch);

  return (
    <>
      <PageHeader title="Sales Team" subtitle={`Service advisors & monthly goals across all branches — ${periodLabel(periodKey)}`} />

      {/* branch filter */}
      <div className="mb-4 flex flex-wrap gap-2">
        <Pill href="/sales" active={!branch}>All branches</Pill>
        {BRANCHES.map((b) => (
          <Pill key={b.key} href={`/sales?branch=${b.key}`} active={branch === b.key}>{b.label}</Pill>
        ))}
      </div>

      <div className="grid gap-3 grid-cols-2 lg:grid-cols-4 mb-5">
        <Tile label="Service advisors" value={String(totals.advisors)} />
        <Tile label="Goals set this month" value={`${totals.withGoal} / ${totals.advisors}`} tone={totals.withGoal < totals.advisors ? "warn" : "good"} />
        <Tile label="Combined monthly goal" value={money(totals.totalGoal)} />
        <Tile label="Sales & Attrition" value="Open →" href="/management/sales" />
      </div>

      {rows.length === 0 ? (
        <EmptyState title="No service advisors yet" hint="Assign the Service Advisor access level to your sales reps in People, and they'll appear here." />
      ) : (
        <Card className="p-0 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-muted border-b border-line">
                  <th className="px-4 py-2 font-medium">Advisor</th>
                  <th className="px-3 py-2 font-medium">Branch</th>
                  <th className="px-3 py-2 font-medium text-right">Monthly goal</th>
                  <th className="px-3 py-2 font-medium text-right">Sales / day</th>
                  <th className="px-3 py-2 font-medium text-right">Leads / day</th>
                  <th className="px-3 py-2 font-medium text-center">Goal set</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.advisor.id} className="border-b border-line last:border-0">
                    <td className="px-4 py-2 font-medium"><Link href={`/sales/${r.advisor.id}`} className="text-brand-700 hover:underline">{r.advisor.name}</Link></td>
                    <td className="px-3 py-2 text-muted">{r.advisor.branch ? branchLabel(r.advisor.branch) : "—"}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{r.hasGoal ? money(r.salesGoal) : "—"}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-muted">{r.hasGoal ? money(r.salesPerDay) : "—"}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-muted">{r.hasGoal ? qty(r.prospectsPerDay) : "—"}</td>
                    <td className="px-3 py-2 text-center">
                      <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${r.hasGoal ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700"}`}>{r.hasGoal ? "Set" : "Not set"}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </>
  );
}

function Pill({ href, active, children }: { href: string; active: boolean; children: React.ReactNode }) {
  return (
    <Link href={href} className={`rounded-full px-3 py-1.5 text-sm font-medium ${active ? "bg-brand-600 text-white" : "border border-line bg-white text-ink hover:bg-slate-50"}`}>{children}</Link>
  );
}

function Tile({ label, value, tone, href }: { label: string; value: string; tone?: "good" | "warn"; href?: string }) {
  const color = tone === "warn" ? "text-amber-600" : tone === "good" ? "text-brand-600" : "";
  const inner = (
    <Card className="p-4 h-full">
      <div className="text-xs uppercase tracking-wider text-muted">{label}</div>
      <div className={`mt-1 text-2xl font-light tabular-nums ${color}`}>{value}</div>
    </Card>
  );
  return href ? <Link href={href}>{inner}</Link> : inner;
}
