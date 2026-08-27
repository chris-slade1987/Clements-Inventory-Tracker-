import Link from "next/link";
import { redirect } from "next/navigation";
import { PageHeader, Card, EmptyState } from "@/components/ui";
import { requireUser, canManageSales } from "@/lib/auth";
import { money, qty } from "@/lib/format";
import { BRANCHES, branchLabel } from "@/lib/management";
import { salesDirectorDashboard, currentPeriodKey, periodLabel } from "@/lib/sales";

export const dynamic = "force-dynamic";

const m = (n: number | null) => (n == null ? "—" : money(n));

export default async function SalesTeamPage({ searchParams }: { searchParams: Promise<{ branch?: string }> }) {
  const user = await requireUser();
  if (!canManageSales(user)) redirect("/me");

  const sp = await searchParams;
  const branch = BRANCHES.find((b) => b.key === sp.branch)?.key ?? null;
  const periodKey = currentPeriodKey();
  const { advisorRows, byBranch, totals, actuals } = await salesDirectorDashboard(periodKey, branch);

  return (
    <>
      <PageHeader title="Sales Team" subtitle={`Targets, closed & pipeline across all branches — ${periodLabel(periodKey)}`} />

      {/* actuals connection state */}
      <div className={`mb-4 rounded-xl border px-4 py-2.5 text-sm ${actuals.connected ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-amber-200 bg-amber-50 text-amber-800"}`}>
        {actuals.connected
          ? <><strong>Closed &amp; pipeline are live</strong> — synced from the sales system{actuals.syncedAt ? ` (last update ${new Date(actuals.syncedAt).toLocaleDateString()})` : ""}. Targets are from advisor goal sheets.</>
          : <><strong>Targets are live</strong> from advisor goal sheets. <strong>Closed &amp; pipeline</strong> will populate here automatically once the sales system (WorkWave) is connected.</>}
      </div>

      {/* branch filter */}
      <div className="mb-4 flex flex-wrap gap-2">
        <Pill href="/sales" active={!branch}>All branches</Pill>
        {BRANCHES.map((b) => (
          <Pill key={b.key} href={`/sales?branch=${b.key}`} active={branch === b.key}>{b.label}</Pill>
        ))}
      </div>

      {/* company summary */}
      <div className="grid gap-3 grid-cols-2 lg:grid-cols-4 mb-6">
        <Tile label="Combined target (month)" value={money(totals.target)} />
        <Tile label="Goals set" value={`${totals.withGoal} / ${totals.advisors}`} tone={totals.withGoal < totals.advisors ? "warn" : "good"} />
        <Tile label="Closed (YTD)" value={m(totals.closed)} />
        <Tile label="Open pipeline" value={m(totals.pipeline)} />
      </div>

      {advisorRows.length === 0 ? (
        <EmptyState title="No service advisors yet" hint="Assign the Service Advisor access level to your sales reps in People, and they'll appear here." />
      ) : (
        <>
          {/* by branch */}
          <h2 className="text-sm font-semibold text-ink mb-2">By branch</h2>
          <Card className="p-0 overflow-hidden mb-6">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-muted border-b border-line">
                    <th className="px-4 py-2 font-medium">Branch</th>
                    <th className="px-3 py-2 font-medium text-right">Advisors</th>
                    <th className="px-3 py-2 font-medium text-right">Target (month)</th>
                    <th className="px-3 py-2 font-medium text-right">Closed (YTD)</th>
                  </tr>
                </thead>
                <tbody>
                  {byBranch.map((b) => (
                    <tr key={b.branch} className="border-b border-line last:border-0">
                      <td className="px-4 py-2 font-medium">
                        <Link href={`/sales?branch=${b.branch}`} className="text-brand-700 hover:underline">{b.label}</Link>
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums text-muted">{b.withGoal}/{b.advisors} set</td>
                      <td className="px-3 py-2 text-right tabular-nums font-medium">{money(b.target)}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-muted">{m(b.closed)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>

          {/* by advisor */}
          <h2 className="text-sm font-semibold text-ink mb-2">By service advisor</h2>
          <Card className="p-0 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-muted border-b border-line">
                    <th className="px-4 py-2 font-medium">Advisor</th>
                    <th className="px-3 py-2 font-medium">Branch</th>
                    <th className="px-3 py-2 font-medium text-right">Target (month)</th>
                    <th className="px-3 py-2 font-medium text-right">Sales / day</th>
                    <th className="px-3 py-2 font-medium text-right">Leads / day</th>
                    <th className="px-3 py-2 font-medium text-right">Closed (YTD)</th>
                    <th className="px-4 py-2 font-medium text-center">Goal</th>
                  </tr>
                </thead>
                <tbody>
                  {advisorRows.map((r) => (
                    <tr key={r.advisor.id} className="border-b border-line last:border-0">
                      <td className="px-4 py-2 font-medium"><Link href={`/sales/${r.advisor.id}`} className="text-brand-700 hover:underline">{r.advisor.name}</Link></td>
                      <td className="px-3 py-2 text-muted">{r.advisor.branch ? branchLabel(r.advisor.branch) : "—"}</td>
                      <td className="px-3 py-2 text-right tabular-nums font-medium">{r.hasGoal ? money(r.target) : "—"}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-muted">{r.hasGoal ? money(r.salesPerDay) : "—"}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-muted">{r.hasGoal ? qty(r.prospectsPerDay) : "—"}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-muted">{m(r.closed)}</td>
                      <td className="px-4 py-2 text-center">
                        <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${r.hasGoal ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700"}`}>{r.hasGoal ? "Set" : "Not set"}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>

          <div className="mt-4 flex flex-wrap items-center gap-3 text-xs text-muted">
            <Link href="/management/sales" className="font-medium text-brand-700 hover:underline">Open Sales &amp; Attrition analytics →</Link>
            <span>Closed = year-to-date won revenue from the sales feed. Per-branch and per-advisor pipeline detail arrives with the full sales API.</span>
          </div>
        </>
      )}
    </>
  );
}

function Pill({ href, active, children }: { href: string; active: boolean; children: React.ReactNode }) {
  return (
    <Link href={href} className={`rounded-full px-3 py-1.5 text-sm font-medium ${active ? "bg-brand-600 text-white" : "border border-line bg-white text-ink hover:bg-slate-50"}`}>{children}</Link>
  );
}

function Tile({ label, value, tone }: { label: string; value: string; tone?: "good" | "warn" }) {
  const color = tone === "warn" ? "text-amber-600" : tone === "good" ? "text-brand-600" : "";
  return (
    <Card className="p-4 h-full">
      <div className="text-xs uppercase tracking-wider text-muted">{label}</div>
      <div className={`mt-1 text-2xl font-light tabular-nums ${color}`}>{value}</div>
    </Card>
  );
}
