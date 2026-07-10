import Link from "next/link";
import { Card, PageHeader } from "@/components/ui";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import {
  onHandValueByCategory,
  productCostMap,
  purchasedDollarsByWarehouse,
  spendByCategory,
  topProductsBySpend,
  topProductsOnHand,
  topTechniciansByUsage,
  type Ranked,
} from "@/lib/reporting";
import { currentPeriods, monthlyBudgetFor } from "@/lib/budgets";
import { money, qty } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  await requireUser();
  const sp = await searchParams;
  const p = currentPeriods(new Date());

  const warehouses = await prisma.warehouse.findMany({
    where: { active: true },
    orderBy: { name: "asc" },
  });
  const selected = warehouses.find((w) => w.id === sp.branch) ?? null;
  const scopeId = selected?.id; // undefined = all branches
  const cost = await productCostMap();

  const [mtd, ytd, catSpend, topProducts, topTechs, ohByCat, topOnHand, openAlerts] =
    await Promise.all([
      purchasedDollarsByWarehouse(p.monthStart),
      purchasedDollarsByWarehouse(p.yearStart),
      spendByCategory(p.monthStart, undefined, scopeId),
      topProductsBySpend(p.monthStart, undefined, 8, scopeId),
      topTechniciansByUsage(p.monthStart, undefined, cost, 8, scopeId),
      onHandValueByCategory(cost, scopeId),
      topProductsOnHand(cost, scopeId, 8),
      prisma.alert.findMany({
        where: { status: "open" },
        orderBy: { createdAt: "desc" },
        include: { product: { select: { name: true } } },
        take: 6,
      }),
    ]);

  const companyMtd = [...mtd.values()].reduce((s, v) => s + v, 0);
  const companyBudget = warehouses.reduce((s, w) => s + monthlyBudgetFor(w.name), 0);
  const scopeOnHandValue = ohByCat.reduce((s, r) => s + r.value, 0);
  const scopeSpend = scopeId ? mtd.get(scopeId) ?? 0 : companyMtd;
  const scopeName = selected ? selected.name.replace(" (HQ)", "") : "All branches";

  return (
    <>
      <PageHeader title="Dashboard" subtitle={`This month at a glance · ${p.monthLabel}`} />

      {/* Selector: company banner + branch cards. Click to scope the detail below. */}
      <Link href="/dashboard" className="block mb-4">
        <Card className={`p-4 transition ${!selected ? "ring-2 ring-brand-500" : "hover:ring-1 hover:ring-brand-300"}`}>
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <div className="text-xs uppercase tracking-wider text-muted">
                All branches · spent this month
              </div>
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
      </Link>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4 mb-5">
        {warehouses.map((w) => {
          const budget = monthlyBudgetFor(w.name);
          const spent = mtd.get(w.id) ?? 0;
          const isSel = selected?.id === w.id;
          return (
            <Link key={w.id} href={isSel ? "/dashboard" : `/dashboard?branch=${w.id}`} className="block">
              <Card className={`p-4 overflow-hidden transition ${isSel ? "ring-2 ring-brand-500" : "hover:ring-1 hover:ring-brand-300"}`}>
                <div className="h-1 -mx-4 -mt-4 mb-3 bg-emerald-grad" />
                <div className="text-xs font-medium uppercase tracking-wider text-muted">{w.name}</div>
                <div className="mt-2 text-2xl font-light tabular-nums">{money(spent)}</div>
                <BudgetBar spent={spent} budget={budget} />
                <div className="mt-3 flex justify-between text-xs">
                  <span className="text-muted">YTD</span>
                  <span className="tabular-nums">
                    {money(ytd.get(w.id) ?? 0)} <span className="text-muted">/ {money(budget * p.monthIndex)}</span>
                  </span>
                </div>
              </Card>
            </Link>
          );
        })}
      </div>

      {/* Scope indicator */}
      <div className="flex items-center justify-between mb-3">
        <h2 className="flex items-center gap-2 text-sm font-medium text-white">
          <span className="inline-block h-4 w-1 rounded bg-emerald-grad" />
          {scopeName}
          <span className="text-mint font-light">· {money(scopeSpend)} spent · {money(scopeOnHandValue)} on hand</span>
        </h2>
        {selected ? (
          <Link href="/dashboard" className="text-xs font-medium text-brand-300 hover:underline">
            ← Show all branches
          </Link>
        ) : null}
      </div>

      {/* One detail section, scoped to the selection */}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="p-4">
          <PanelTitle>Top spend by category</PanelTitle>
          <RankBars rows={catSpend} empty="No purchases recorded this month yet." />
        </Card>
        <Card className="p-0 overflow-hidden">
          <div className="px-4 py-3 border-b border-line"><PanelTitle>Top products by spend</PanelTitle></div>
          {topProducts.length === 0 ? <Empty>No purchases recorded this month yet.</Empty> : <RankTable rows={topProducts} col="Cost" />}
        </Card>

        <Card className="p-0 overflow-hidden">
          <div className="px-4 py-3 border-b border-line flex items-center justify-between">
            <PanelTitle>Top technicians · product used</PanelTitle>
            {topTechs.length === 0 ? <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-700">no check-outs yet</span> : null}
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
            <PanelTitle>Top products on hand</PanelTitle>
            <span className="text-sm font-light tabular-nums">{money(scopeOnHandValue)}</span>
          </div>
          {topOnHand.length === 0 ? <Empty>No stock on hand yet.</Empty> : <RankTable rows={topOnHand} col="Value" />}
        </Card>

        <Card className="p-4">
          <PanelTitle>On-hand value by category</PanelTitle>
          <RankBars rows={ohByCat} empty="No stock on hand yet." />
        </Card>

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
                    <div className="text-xs text-muted">{a.type.replace(/_/g, " ")}{a.product ? ` · ${a.product.name}` : ""}</div>
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
        <div className={`h-full rounded-full ${over ? "bg-amber-500" : "bg-emerald-grad"}`} style={{ width: `${pct}%` }} />
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
