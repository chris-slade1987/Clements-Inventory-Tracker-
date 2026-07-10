import Link from "next/link";
import { Card, PageHeader } from "@/components/ui";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import {
  onHandValueByCategory,
  onHandValueByWarehouse,
  productCostMap,
  purchasedDollarsByWarehouse,
  spendByCategory,
  topProductsBySpend,
  topTechniciansByUsage,
  type Ranked,
} from "@/lib/reporting";
import { currentPeriods, monthlyBudgetFor } from "@/lib/budgets";
import { money, qty } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  await requireUser();
  const p = currentPeriods(new Date());

  const cost = await productCostMap();
  const [
    warehouses,
    mtd,
    ytd,
    catSpend,
    topProducts,
    topTechs,
    ohByWh,
    ohByCat,
    openAlerts,
  ] = await Promise.all([
    prisma.warehouse.findMany({ where: { active: true }, orderBy: { name: "asc" } }),
    purchasedDollarsByWarehouse(p.monthStart),
    purchasedDollarsByWarehouse(p.yearStart),
    spendByCategory(p.monthStart),
    topProductsBySpend(p.monthStart, undefined, 8),
    topTechniciansByUsage(p.monthStart, undefined, cost, 8),
    onHandValueByWarehouse(cost),
    onHandValueByCategory(cost),
    prisma.alert.findMany({
      where: { status: "open" },
      orderBy: { createdAt: "desc" },
      include: { product: { select: { name: true } } },
      take: 6,
    }),
  ]);

  const companyMtd = [...mtd.values()].reduce((s, v) => s + v, 0);
  const companyBudget = warehouses.reduce((s, w) => s + monthlyBudgetFor(w.name), 0);
  const companyOnHand = [...ohByWh.values()].reduce((s, v) => s + v.value, 0);

  return (
    <>
      <PageHeader title="Dashboard" subtitle={`This month at a glance · ${p.monthLabel}`} />

      {/* 1 — SPEND THIS MONTH */}
      <SectionLabel>Spend this month · vs budget</SectionLabel>
      <Card className="p-4 mb-4">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <div className="text-xs uppercase tracking-wider text-muted">All branches spent</div>
            <div className="mt-1 text-3xl font-light tabular-nums">{money(companyMtd)}</div>
          </div>
          <div className="text-right">
            <div className="text-xs uppercase tracking-wider text-muted">
              Monthly budget{" "}
              <span className="ml-1 rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-700">placeholder</span>
            </div>
            <div className="mt-1 text-xl font-light tabular-nums text-muted">{money(companyBudget)}</div>
          </div>
        </div>
        <BudgetBar spent={companyMtd} budget={companyBudget} />
      </Card>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4 mb-6">
        {warehouses.map((w) => {
          const budget = monthlyBudgetFor(w.name);
          const spent = mtd.get(w.id) ?? 0;
          const ytdSpent = ytd.get(w.id) ?? 0;
          return (
            <Card key={w.id} className="p-4 overflow-hidden">
              <div className="h-1 -mx-4 -mt-4 mb-3 bg-emerald-grad" />
              <div className="text-xs font-medium uppercase tracking-wider text-muted">{w.name}</div>
              <div className="mt-2 text-2xl font-light tabular-nums">{money(spent)}</div>
              <BudgetBar spent={spent} budget={budget} />
              <div className="mt-3 flex justify-between text-xs">
                <span className="text-muted">YTD</span>
                <span className="tabular-nums">
                  {money(ytdSpent)} <span className="text-muted">/ {money(budget * p.monthIndex)}</span>
                </span>
              </div>
            </Card>
          );
        })}
      </div>

      {/* 2 — WHAT WE'RE SPENDING ON */}
      <SectionLabel>What we&rsquo;re spending on this month</SectionLabel>
      <div className="grid gap-4 lg:grid-cols-2 mb-6">
        <Card className="p-4">
          <PanelTitle>Top spend by category</PanelTitle>
          <RankBars rows={catSpend} empty="No purchases recorded this month yet." />
        </Card>
        <Card className="p-0 overflow-hidden">
          <div className="px-4 py-3 border-b border-line"><PanelTitle>Top products by spend</PanelTitle></div>
          {topProducts.length === 0 ? (
            <Empty>No purchases recorded this month yet.</Empty>
          ) : (
            <RankTable rows={topProducts} col="Cost" />
          )}
        </Card>
      </div>

      {/* 3 — WHERE IT'S GOING + ON HAND */}
      <SectionLabel>Where product is going · what&rsquo;s on hand</SectionLabel>
      <div className="grid gap-4 lg:grid-cols-2 mb-6">
        <Card className="p-0 overflow-hidden">
          <div className="px-4 py-3 border-b border-line flex items-center justify-between">
            <PanelTitle>Top technicians · product used this month</PanelTitle>
            {topTechs.length === 0 ? (
              <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-700">no check-outs yet</span>
            ) : null}
          </div>
          {topTechs.length === 0 ? (
            <Empty>Dispersal populates as check-outs are recorded.</Empty>
          ) : (
            <div className="overflow-x-auto max-h-80 overflow-y-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-muted border-b border-line">
                    <th className="px-4 py-2 font-medium">Technician</th>
                    <th className="px-3 py-2 font-medium">Branch</th>
                    <th className="px-3 py-2 font-medium text-right">Items</th>
                    <th className="px-4 py-2 font-medium text-right">Value</th>
                  </tr>
                </thead>
                <tbody>
                  {topTechs.map((t) => (
                    <tr key={t.name + t.branch} className="border-b border-line last:border-0">
                      <td className="px-4 py-2">{t.name}</td>
                      <td className="px-3 py-2 text-muted">{t.branch.replace(" (HQ)", "")}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{qty(t.units)}</td>
                      <td className="px-4 py-2 text-right tabular-nums font-medium">{money(t.value)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        <Card className="p-0 overflow-hidden">
          <div className="px-4 py-3 border-b border-line flex items-center justify-between">
            <PanelTitle>On-hand value by branch</PanelTitle>
            <span className="text-sm font-light tabular-nums">{money(companyOnHand)}</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-muted border-b border-line">
                  <th className="px-4 py-2 font-medium">Branch</th>
                  <th className="px-3 py-2 font-medium text-right">Items</th>
                  <th className="px-4 py-2 font-medium text-right">Value</th>
                </tr>
              </thead>
              <tbody>
                {warehouses.map((w) => {
                  const oh = ohByWh.get(w.id) ?? { units: 0, value: 0 };
                  return (
                    <tr key={w.id} className="border-b border-line last:border-0">
                      <td className="px-4 py-2">{w.name}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{qty(oh.units)}</td>
                      <td className="px-4 py-2 text-right tabular-nums font-medium">{money(oh.value)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      </div>

      {/* 4 — ON HAND BY CATEGORY */}
      <div className="grid gap-4 lg:grid-cols-2 mb-6">
        <Card className="p-4">
          <PanelTitle>On-hand value by category</PanelTitle>
          <RankBars rows={ohByCat} empty="No stock on hand yet." />
        </Card>

        {/* Alerts */}
        <Card className="p-0 overflow-hidden">
          <div className="px-4 py-3 border-b border-line flex items-center justify-between">
            <PanelTitle>Open alerts</PanelTitle>
            <Link href="/alerts" className="text-xs font-medium text-brand-700 hover:underline">View all</Link>
          </div>
          {openAlerts.length === 0 ? (
            <Empty>No open alerts.</Empty>
          ) : (
            <ul className="divide-y divide-line">
              {openAlerts.map((a) => (
                <li key={a.id} className="px-4 py-3 flex items-start gap-3">
                  <SeverityDot severity={a.severity} />
                  <div className="min-w-0">
                    <div className="text-sm">{a.message}</div>
                    <div className="text-xs text-muted">
                      {a.type.replace(/_/g, " ")}{a.product ? ` · ${a.product.name}` : ""}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="flex items-center gap-2 text-xs font-medium uppercase tracking-widest text-mint mb-3">
      <span className="inline-block h-3 w-1 rounded bg-emerald-grad" />
      {children}
    </h2>
  );
}
function PanelTitle({ children }: { children: React.ReactNode }) {
  return <h3 className="text-sm font-medium text-ink">{children}</h3>;
}
function Empty({ children }: { children: React.ReactNode }) {
  return <p className="px-4 py-8 text-center text-sm text-muted">{children}</p>;
}

function BudgetBar({ spent, budget }: { spent: number; budget: number }) {
  const pct = budget > 0 ? Math.min(100, (spent / budget) * 100) : 0;
  const over = spent > budget && budget > 0;
  const remaining = budget - spent;
  return (
    <div className="mt-2">
      <div className="h-2 rounded-full bg-slate-200 overflow-hidden">
        <div
          className={`h-full rounded-full ${over ? "bg-amber-500" : "bg-emerald-grad"}`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <div className="mt-1 flex justify-between text-[11px] text-muted tabular-nums">
        <span>{Math.round(pct)}% of budget</span>
        <span className={over ? "text-amber-600 font-medium" : "text-emerald-700"}>
          {over ? `${money(-remaining)} over` : `${money(remaining)} left`}
        </span>
      </div>
    </div>
  );
}

function RankBars({ rows, empty }: { rows: Ranked[]; empty: string }) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  if (rows.length === 0) return <p className="py-6 text-center text-sm text-muted">{empty}</p>;
  return (
    <div className="mt-3 space-y-2.5">
      {rows.map((r) => (
        <div key={r.key} className="flex items-center gap-3">
          <div className="w-28 shrink-0 text-sm truncate">{r.label}</div>
          <div className="flex-1 h-4 rounded bg-slate-100 overflow-hidden">
            <div className="h-full rounded bg-emerald-grad" style={{ width: `${Math.max(3, (r.value / max) * 100)}%` }} />
          </div>
          <div className="w-20 shrink-0 text-right text-sm font-medium tabular-nums">{money(r.value)}</div>
        </div>
      ))}
    </div>
  );
}

function RankTable({ rows, col }: { rows: Ranked[]; col: string }) {
  return (
    <div className="overflow-x-auto max-h-80 overflow-y-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-xs text-muted border-b border-line">
            <th className="px-4 py-2 font-medium">Product</th>
            <th className="px-3 py-2 font-medium text-right">Qty</th>
            <th className="px-4 py-2 font-medium text-right">{col}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.key} className="border-b border-line last:border-0">
              <td className="px-4 py-2">{r.label}</td>
              <td className="px-3 py-2 text-right tabular-nums">{qty(r.qty)}</td>
              <td className="px-4 py-2 text-right tabular-nums font-medium">{money(r.value)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function SeverityDot({ severity }: { severity: string }) {
  const color = severity === "critical" ? "bg-red-500" : severity === "warning" ? "bg-amber-500" : "bg-blue-500";
  return <span className={`mt-1 h-2.5 w-2.5 rounded-full shrink-0 ${color}`} />;
}
