import Link from "next/link";
import { Card, PageHeader } from "@/components/ui";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import {
  dispersedByEmployeeByWarehouse,
  productsPurchasedByWarehouse,
  purchasedDollarsByWarehouse,
  type EmployeeDispersal,
  type PurchasedProduct,
} from "@/lib/reporting";
import { currentPeriods, monthlyBudgetFor } from "@/lib/budgets";
import { money, qty } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  await requireUser();
  const p = currentPeriods(new Date());

  const [warehouses, technicians, mtd, ytd, products, dispersed, openAlerts] =
    await Promise.all([
      prisma.warehouse.findMany({ where: { active: true }, orderBy: { name: "asc" } }),
      prisma.technician.findMany({
        where: { active: true },
        select: { id: true, name: true, homeWarehouseId: true, role: true },
        orderBy: { name: "asc" },
      }),
      purchasedDollarsByWarehouse(p.monthStart),
      purchasedDollarsByWarehouse(p.yearStart),
      productsPurchasedByWarehouse(p.monthStart),
      dispersedByEmployeeByWarehouse(p.monthStart),
      prisma.alert.findMany({
        where: { status: "open" },
        orderBy: { createdAt: "desc" },
        include: { product: { select: { name: true } } },
        take: 6,
      }),
    ]);

  const techsByWh = new Map<string, { id: string; name: string; role: string }[]>();
  for (const t of technicians) {
    if (!techsByWh.has(t.homeWarehouseId)) techsByWh.set(t.homeWarehouseId, []);
    techsByWh.get(t.homeWarehouseId)!.push(t);
  }

  const companyMtd = [...mtd.values()].reduce((s, v) => s + v, 0);
  const companyBudget = warehouses.reduce((s, w) => s + monthlyBudgetFor(w.name), 0);

  return (
    <>
      <PageHeader
        title="Dashboard"
        subtitle={`Purchasing vs. budget · ${p.monthLabel}`}
      />

      {/* Company MTD banner */}
      <Card className="p-4 mb-5">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <div className="text-xs uppercase tracking-wider text-muted">
              All branches · purchased this month
            </div>
            <div className="mt-1 text-3xl font-light tabular-nums">
              {money(companyMtd)}
            </div>
          </div>
          <div className="text-right">
            <div className="text-xs uppercase tracking-wider text-muted">
              Monthly budget{" "}
              <span className="ml-1 rounded bg-amber-400/15 px-1.5 py-0.5 text-[10px] font-medium text-amber-300">
                placeholder
              </span>
            </div>
            <div className="mt-1 text-xl font-light tabular-nums text-mint">
              {money(companyBudget)}
            </div>
          </div>
        </div>
        <BudgetBar spent={companyMtd} budget={companyBudget} />
      </Card>

      {/* Per-branch summary cards */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4 mb-6">
        {warehouses.map((w) => {
          const budget = monthlyBudgetFor(w.name);
          const spentMtd = mtd.get(w.id) ?? 0;
          const spentYtd = ytd.get(w.id) ?? 0;
          const ytdBudget = budget * p.monthIndex;
          return (
            <Card key={w.id} className="p-4 overflow-hidden">
              <div className="h-1 -mx-4 -mt-4 mb-3 bg-emerald-grad" />
              <div className="text-xs font-medium uppercase tracking-wider text-muted">
                {w.name}
              </div>
              <div className="mt-2 text-2xl font-light tabular-nums">
                {money(spentMtd)}
              </div>
              <div className="text-xs text-muted">this month</div>
              <BudgetBar spent={spentMtd} budget={budget} />
              <div className="mt-3 flex justify-between text-xs">
                <span className="text-muted">YTD</span>
                <span className="tabular-nums">
                  {money(spentYtd)}{" "}
                  <span className="text-muted">/ {money(ytdBudget)}</span>
                </span>
              </div>
            </Card>
          );
        })}
      </div>

      {/* Per-branch detail: purchased products + dispersed by employee */}
      <div className="space-y-6">
        {warehouses.map((w) => {
          const purchased = products.get(w.id) ?? [];
          const disp = dispersed.get(w.id) ?? [];
          const branchTechs = techsByWh.get(w.id) ?? [];
          return (
            <div key={w.id}>
              <h2 className="text-lg font-light tracking-tight mb-3 flex items-center gap-2">
                <span className="inline-block h-4 w-1 rounded bg-emerald-grad" />
                {w.name}
              </h2>
              <div className="grid gap-4 lg:grid-cols-2">
                <PurchasedPanel rows={purchased} month={p.monthLabel} />
                <DispersedPanel rows={disp} techs={branchTechs} />
              </div>
            </div>
          );
        })}
      </div>

      {/* Open alerts */}
      <Card className="p-0 overflow-hidden mt-6">
        <div className="px-4 py-3 border-b border-line flex items-center justify-between">
          <h2 className="text-sm font-medium">Open alerts</h2>
          <Link href="/alerts" className="text-xs font-medium text-brand-300 hover:underline">
            View all
          </Link>
        </div>
        {openAlerts.length === 0 ? (
          <p className="px-4 py-6 text-center text-sm text-muted">No open alerts.</p>
        ) : (
          <ul className="divide-y divide-line">
            {openAlerts.map((a) => (
              <li key={a.id} className="px-4 py-3 flex items-start gap-3">
                <SeverityDot severity={a.severity} />
                <div className="min-w-0">
                  <div className="text-sm">{a.message}</div>
                  <div className="text-xs text-muted">
                    {a.type.replace(/_/g, " ")}
                    {a.product ? ` · ${a.product.name}` : ""}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </>
  );
}

function BudgetBar({ spent, budget }: { spent: number; budget: number }) {
  const pct = budget > 0 ? Math.min(100, (spent / budget) * 100) : 0;
  const over = spent > budget && budget > 0;
  const remaining = budget - spent;
  return (
    <div className="mt-2">
      <div className="h-2 rounded-full bg-white/10 overflow-hidden">
        <div
          className={`h-full rounded-full ${over ? "bg-amber-400" : "bg-emerald-grad"}`}
          style={{ width: `${budget > 0 ? Math.min(100, (spent / budget) * 100) : 0}%` }}
        />
      </div>
      <div className="mt-1 flex justify-between text-[11px] text-muted tabular-nums">
        <span>{Math.round(pct)}% of budget</span>
        <span className={over ? "text-amber-300" : "text-mint"}>
          {over ? `${money(-remaining)} over` : `${money(remaining)} left`}
        </span>
      </div>
    </div>
  );
}

function PurchasedPanel({ rows, month }: { rows: PurchasedProduct[]; month: string }) {
  const total = rows.reduce((s, r) => s + r.value, 0);
  return (
    <Card className="p-0 overflow-hidden">
      <div className="px-4 py-3 border-b border-line flex items-center justify-between">
        <h3 className="text-sm font-medium">Purchased this month</h3>
        <span className="text-sm font-light tabular-nums">{money(total)}</span>
      </div>
      {rows.length === 0 ? (
        <p className="px-4 py-8 text-center text-sm text-muted">
          No purchases recorded in {month}. They&rsquo;ll appear here as invoices
          are checked in.
        </p>
      ) : (
        <div className="overflow-x-auto max-h-72 overflow-y-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-muted border-b border-line sticky top-0 bg-forest">
                <th className="px-4 py-2 font-medium">Product</th>
                <th className="px-3 py-2 font-medium text-right">Qty</th>
                <th className="px-4 py-2 font-medium text-right">Cost</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.name} className="border-b border-line last:border-0">
                  <td className="px-4 py-2">{r.name}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{qty(r.qty)}</td>
                  <td className="px-4 py-2 text-right tabular-nums">{money(r.value)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

function DispersedPanel({
  rows,
  techs,
}: {
  rows: EmployeeDispersal[];
  techs: { id: string; name: string; role: string }[];
}) {
  const hasData = rows.length > 0;
  // Placeholder: show the branch's technicians with no data yet.
  const placeholderRows = techs
    .filter((t) => t.role === "Technician")
    .slice(0, 6);
  return (
    <Card className="p-0 overflow-hidden">
      <div className="px-4 py-3 border-b border-line flex items-center justify-between">
        <h3 className="text-sm font-medium">Dispersed this month · by employee</h3>
        {!hasData ? (
          <span className="rounded bg-amber-400/15 px-1.5 py-0.5 text-[10px] font-medium text-amber-300">
            not tracked yet
          </span>
        ) : null}
      </div>
      {hasData ? (
        <div className="overflow-x-auto max-h-72 overflow-y-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-muted border-b border-line">
                <th className="px-4 py-2 font-medium">Employee</th>
                <th className="px-3 py-2 font-medium text-right">Check-outs</th>
                <th className="px-4 py-2 font-medium text-right">Units</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.technicianId} className="border-b border-line last:border-0">
                  <td className="px-4 py-2">{r.name}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{r.lines}</td>
                  <td className="px-4 py-2 text-right tabular-nums">{qty(r.units)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div>
          <p className="px-4 pt-3 text-xs text-muted">
            Dispersal tracking populates as check-outs are recorded. Preview of
            this branch&rsquo;s technicians:
          </p>
          <table className="w-full text-sm mt-1">
            <tbody>
              {placeholderRows.map((t) => (
                <tr key={t.id} className="border-t border-line">
                  <td className="px-4 py-2 text-muted">{t.name}</td>
                  <td className="px-4 py-2 text-right text-muted">—</td>
                </tr>
              ))}
              {placeholderRows.length === 0 ? (
                <tr>
                  <td className="px-4 py-6 text-center text-sm text-muted">
                    No technicians on this branch yet.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

function SeverityDot({ severity }: { severity: string }) {
  const color =
    severity === "critical"
      ? "bg-red-400"
      : severity === "warning"
        ? "bg-amber-400"
        : "bg-blue-400";
  return <span className={`mt-1 h-2.5 w-2.5 rounded-full shrink-0 ${color}`} />;
}
