import { Card, PageHeader } from "@/components/ui";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import {
  onHandByCategory,
  onHandByProduct,
  parseFilters,
  warehouseMetrics,
} from "@/lib/reporting";
import { money, qty } from "@/lib/format";
import { PRODUCT_CATEGORIES } from "@/lib/constants";
import FilterBar from "@/components/FilterBar";
import GroupedBarChart, { REPORT_SERIES } from "@/components/GroupedBarChart";

export const dynamic = "force-dynamic";

export default async function ReportsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  await requireUser();
  const sp = await searchParams;
  const filters = parseFilters(sp);

  const [warehouses, products, metrics, productRows, categoryRows] =
    await Promise.all([
      prisma.warehouse.findMany({ where: { active: true }, orderBy: { name: "asc" } }),
      prisma.product.findMany({ where: { active: true }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
      warehouseMetrics(filters),
      onHandByProduct(filters),
      onHandByCategory(filters),
    ]);
  const categoryMax = Math.max(1, ...categoryRows.map((c) => c.qty));

  const shownWarehouses = filters.warehouseId
    ? warehouses.filter((w) => w.id === filters.warehouseId)
    : warehouses;

  const chartGroups = shownWarehouses.map((w) => {
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

  const totals = shownWarehouses.reduce(
    (acc, w) => {
      const m = metrics.get(w.id);
      acc.purchasedQty += m?.purchasedQty ?? 0;
      acc.purchasedValue += m?.purchasedValue ?? 0;
      acc.dispersedQty += m?.dispersedQty ?? 0;
      acc.onHandQty += m?.onHandQty ?? 0;
      return acc;
    },
    { purchasedQty: 0, purchasedValue: 0, dispersedQty: 0, onHandQty: 0 }
  );

  return (
    <>
      <PageHeader
        title="Reports"
        subtitle="Purchased vs. dispersed vs. on-hand, per warehouse and product."
      />

      <FilterBar
        products={products}
        warehouses={warehouses}
        categories={PRODUCT_CATEGORIES}
        initial={sp}
        exportBase="/api/reports/export"
      />

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

      {/* Warehouse summary */}
      <Card className="p-0 overflow-hidden mb-6">
        <div className="px-4 py-3 border-b border-line">
          <h2 className="text-sm font-semibold text-ink">Warehouse summary</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-muted border-b border-line">
                <th className="px-4 py-2 font-medium">Warehouse</th>
                <th className="px-4 py-2 font-medium text-right">Purchased</th>
                <th className="px-4 py-2 font-medium text-right">Purchased $</th>
                <th className="px-4 py-2 font-medium text-right">Dispersed</th>
                <th className="px-4 py-2 font-medium text-right">On-hand</th>
              </tr>
            </thead>
            <tbody>
              {shownWarehouses.map((w) => {
                const m = metrics.get(w.id);
                return (
                  <tr key={w.id} className="border-b border-line">
                    <td className="px-4 py-2">{w.name}</td>
                    <td className="px-4 py-2 text-right tabular-nums">{qty(m?.purchasedQty ?? 0)}</td>
                    <td className="px-4 py-2 text-right tabular-nums">{money(m?.purchasedValue ?? 0)}</td>
                    <td className="px-4 py-2 text-right tabular-nums">{qty(m?.dispersedQty ?? 0)}</td>
                    <td className="px-4 py-2 text-right tabular-nums font-medium">{qty(m?.onHandQty ?? 0)}</td>
                  </tr>
                );
              })}
              <tr className="bg-slate-50 font-semibold">
                <td className="px-4 py-2">Total</td>
                <td className="px-4 py-2 text-right tabular-nums">{qty(totals.purchasedQty)}</td>
                <td className="px-4 py-2 text-right tabular-nums">{money(totals.purchasedValue)}</td>
                <td className="px-4 py-2 text-right tabular-nums">{qty(totals.dispersedQty)}</td>
                <td className="px-4 py-2 text-right tabular-nums">{qty(totals.onHandQty)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </Card>

      {/* On-hand by category */}
      <Card className="p-4 mb-6">
        <h2 className="text-sm font-semibold text-ink mb-3">On-hand by category</h2>
        {categoryRows.length === 0 ? (
          <p className="text-sm text-muted">No stock matches these filters.</p>
        ) : (
          <div className="space-y-2">
            {categoryRows.map((c) => (
              <div key={c.category} className="flex items-center gap-3">
                <div className="w-28 shrink-0 text-sm text-ink">{c.category}</div>
                <div className="flex-1 h-5 rounded bg-slate-100 overflow-hidden">
                  <div
                    className="h-full bg-brand-500 rounded"
                    style={{ width: `${Math.max(3, (c.qty / categoryMax) * 100)}%` }}
                  />
                </div>
                <div className="w-16 shrink-0 text-right text-sm font-medium tabular-nums">
                  {qty(c.qty)}
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>

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
                <th className="px-2 py-2 font-medium">Category</th>
                <th className="px-2 py-2 font-medium">Unit</th>
                {shownWarehouses.map((w) => (
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
                  <td colSpan={shownWarehouses.length + 4} className="px-4 py-6 text-center text-muted">
                    No stock movements match these filters.
                  </td>
                </tr>
              ) : (
                productRows.map((p) => (
                  <tr key={p.productId} className="border-b border-line last:border-0">
                    <td className="px-4 py-2">{p.name}</td>
                    <td className="px-2 py-2 text-muted">{p.category}</td>
                    <td className="px-2 py-2 text-muted">{p.unit}</td>
                    {shownWarehouses.map((w) => (
                      <td key={w.id} className="px-2 py-2 text-right tabular-nums">
                        {p.byWarehouse[w.id] ? qty(p.byWarehouse[w.id]) : "—"}
                      </td>
                    ))}
                    <td className="px-4 py-2 text-right font-medium tabular-nums">
                      {qty(p.total)}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </Card>
    </>
  );
}
