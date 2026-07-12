import { Card, PageHeader } from "@/components/ui";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import {
  dispersedValueByWarehouse,
  onHandByProduct,
  onHandValueByWarehouse,
  parseFilters,
  productCostMap,
  purchasedDollarsByWarehouse,
  warehouseMetrics,
} from "@/lib/reporting";
import { money, qty } from "@/lib/format";
import { PRODUCT_CATEGORIES } from "@/lib/constants";
import FilterBar from "@/components/FilterBar";
import GroupedBarChart from "@/components/GroupedBarChart";

export const dynamic = "force-dynamic";

export default async function ReportsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  await requireUser();
  const sp = await searchParams;
  const filters = parseFilters(sp);

  const cost = await productCostMap();
  const [warehouses, products, metrics, productRows, purch$, disp$, onHand$] =
    await Promise.all([
      prisma.warehouse.findMany({ where: { active: true }, orderBy: { name: "asc" } }),
      prisma.product.findMany({ where: { active: true }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
      warehouseMetrics(filters),
      onHandByProduct(filters),
      purchasedDollarsByWarehouse(filters.from ?? new Date(0), filters.to),
      dispersedValueByWarehouse(filters.from ?? new Date(0), filters.to, cost),
      onHandValueByWarehouse(cost),
    ]);

  const shownWarehouses = filters.warehouseId
    ? warehouses.filter((w) => w.id === filters.warehouseId)
    : warehouses;

  // Units only make sense for a single product (same unit of measure). Across
  // all products, sum DOLLARS instead — units of a gel box + a gallon are not
  // comparable. So the chart flips between units and dollars by context.
  const singleProduct = !!filters.productId;
  const productName = singleProduct ? products.find((p) => p.id === filters.productId)?.name ?? "Product" : null;

  const chartTitle = singleProduct ? `Units by warehouse · ${productName}` : "Inventory value by warehouse";
  const chartSeries = singleProduct
    ? [
        { key: "purchasedQty", label: "Purchased", color: "#0b6b45" },
        { key: "dispersedQty", label: "Dispersed", color: "#2f9e73" },
        { key: "onHandQty", label: "On-hand", color: "#8ed1b2" },
      ]
    : [
        { key: "purchasedValue", label: "Purchased $", color: "#0b6b45" },
        { key: "dispersedValue", label: "Dispersed $", color: "#2f9e73" },
        { key: "onHandValue", label: "On-hand $", color: "#8ed1b2" },
      ];
  const chartFormat = singleProduct ? (n: number) => qty(n) : (n: number) => money(n);
  const chartGroups = shownWarehouses.map((w) => {
    const m = metrics.get(w.id);
    const values: Record<string, number> = singleProduct
      ? { purchasedQty: m?.purchasedQty ?? 0, dispersedQty: m?.dispersedQty ?? 0, onHandQty: m?.onHandQty ?? 0 }
      : { purchasedValue: purch$.get(w.id) ?? 0, dispersedValue: disp$.get(w.id) ?? 0, onHandValue: onHand$.get(w.id)?.value ?? 0 };
    return { label: w.name.replace(" (HQ)", ""), values };
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
        <h2 className="text-sm font-semibold text-ink mb-2">{chartTitle}</h2>
        {!singleProduct ? (
          <p className="text-xs text-muted mb-2">
            Across all products, quantities aren&rsquo;t comparable (a case ≠ a gallon), so this shows dollar value.
            Pick a product above to compare units by branch.
          </p>
        ) : null}
        <GroupedBarChart groups={chartGroups} series={chartSeries} formatValue={chartFormat} />
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
