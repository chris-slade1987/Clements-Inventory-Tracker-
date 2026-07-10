import Link from "next/link";
import { Card, PageHeader } from "@/components/ui";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import {
  onHandByProduct,
  parseFilters,
  warehouseMetrics,
} from "@/lib/reporting";
import { money, qty } from "@/lib/format";
import { PRODUCT_CATEGORIES } from "@/lib/constants";
import FilterBar from "@/components/FilterBar";
import GroupedBarChart, { REPORT_SERIES } from "@/components/GroupedBarChart";

export const dynamic = "force-dynamic";

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  await requireUser();
  const sp = await searchParams;
  const filters = parseFilters(sp);

  const [warehouses, products, metrics, productRows, openAlerts] =
    await Promise.all([
      prisma.warehouse.findMany({ where: { active: true }, orderBy: { name: "asc" } }),
      prisma.product.findMany({ where: { active: true }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
      warehouseMetrics(filters),
      onHandByProduct(filters),
      prisma.alert.findMany({
        where: { status: "open" },
        orderBy: { createdAt: "desc" },
        include: { product: { select: { name: true } } },
        take: 8,
      }),
    ]);

  const chartGroups = warehouses.map((w) => {
    const m = metrics.get(w.id);
    return {
      label: w.name.replace(" (HQ)", ""),
      values: {
        purchasedQty: m?.purchasedQty ?? 0,
        dispersedQty: m?.dispersedQty ?? 0,
        onHandQty: m?.onHandQty ?? 0,
      },
    };
  });

  return (
    <>
      <PageHeader
        title="Dashboard"
        subtitle="Purchased, dispersed, and on-hand across all warehouses."
      />

      <FilterBar
        products={products}
        categories={PRODUCT_CATEGORIES}
        initial={sp}
      />

      {/* Per-warehouse KPI cards */}
      <div className="grid gap-4 sm:grid-cols-3 mb-6">
        {warehouses.map((w) => {
          const m = metrics.get(w.id);
          return (
            <Card key={w.id} className="p-4 overflow-hidden">
              <div className="h-1 -mx-4 -mt-4 mb-3 bg-emerald-grad" />
              <div className="text-xs font-medium uppercase tracking-wider text-muted">
                {w.name}
              </div>
              <div className="mt-3 space-y-2">
                <Metric label="Purchased" value={qty(m?.purchasedQty ?? 0)} sub={money(m?.purchasedValue ?? 0)} />
                <Metric label="Dispersed" value={qty(m?.dispersedQty ?? 0)} />
                <Metric label="On-hand" value={qty(m?.onHandQty ?? 0)} accent />
              </div>
            </Card>
          );
        })}
      </div>

      {/* Chart */}
      <Card className="p-4 mb-6">
        <h2 className="text-sm font-semibold text-ink mb-2">
          Quantity by warehouse
        </h2>
        <GroupedBarChart
          groups={chartGroups}
          series={REPORT_SERIES}
          formatValue={(n) => qty(n)}
        />
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* On-hand by product */}
        <Card className="p-0 overflow-hidden">
          <div className="px-4 py-3 border-b border-line">
            <h2 className="text-sm font-semibold text-ink">On-hand by product</h2>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-muted border-b border-line">
                  <th className="px-4 py-2 font-medium">Product</th>
                  {warehouses.map((w) => (
                    <th key={w.id} className="px-2 py-2 font-medium text-right">
                      {w.name.replace(" (HQ)", "")}
                    </th>
                  ))}
                  <th className="px-4 py-2 font-medium text-right">Total</th>
                </tr>
              </thead>
              <tbody>
                {productRows.length === 0 ? (
                  <tr>
                    <td colSpan={warehouses.length + 2} className="px-4 py-6 text-center text-muted">
                      No stock movements yet.
                    </td>
                  </tr>
                ) : (
                  productRows.map((row) => (
                    <tr key={row.productId} className="border-b border-line last:border-0">
                      <td className="px-4 py-2">{row.name}</td>
                      {warehouses.map((w) => (
                        <td key={w.id} className="px-2 py-2 text-right tabular-nums">
                          {row.byWarehouse[w.id] ? qty(row.byWarehouse[w.id]) : "—"}
                        </td>
                      ))}
                      <td className="px-4 py-2 text-right font-medium tabular-nums">
                        {qty(row.total)}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </Card>

        {/* Open alerts */}
        <Card className="p-0 overflow-hidden">
          <div className="px-4 py-3 border-b border-line flex items-center justify-between">
            <h2 className="text-sm font-semibold text-ink">Open alerts</h2>
            <Link href="/alerts" className="text-xs font-medium text-brand-700 hover:underline">
              View all
            </Link>
          </div>
          {openAlerts.length === 0 ? (
            <p className="px-4 py-6 text-center text-sm text-muted">
              No open alerts.
            </p>
          ) : (
            <ul className="divide-y divide-line">
              {openAlerts.map((a) => (
                <li key={a.id} className="px-4 py-3 flex items-start gap-3">
                  <SeverityDot severity={a.severity} />
                  <div className="min-w-0">
                    <div className="text-sm text-ink">{a.message}</div>
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
      </div>
    </>
  );
}

function Metric({
  label,
  value,
  sub,
  accent,
}: {
  label: string;
  value: string;
  sub?: string;
  accent?: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between">
      <span className="text-sm text-muted">{label}</span>
      <span className="text-right">
        <span className={`text-xl font-light tabular-nums ${accent ? "text-brand-700" : "text-ink"}`}>
          {value}
        </span>
        {sub ? <span className="ml-2 text-xs text-muted">{sub}</span> : null}
      </span>
    </div>
  );
}

function SeverityDot({ severity }: { severity: string }) {
  const color =
    severity === "critical"
      ? "bg-red-500"
      : severity === "warning"
        ? "bg-amber-500"
        : "bg-blue-500";
  return <span className={`mt-1 h-2.5 w-2.5 rounded-full shrink-0 ${color}`} />;
}
