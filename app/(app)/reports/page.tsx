import Link from "next/link";
import { Card, PageHeader } from "@/components/ui";
import { requireUser, branchLocked } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import {
  dispersedValueByWarehouse,
  distinctDistributors,
  last3MonthsRange,
  lastMonthRange,
  onHandByProduct,
  onHandValueByWarehouse,
  parseFilters,
  productCostMap,
  purchasedDollarsByWarehouse,
  warehouseMetrics,
  warehouseProductBreakdown,
  type ReportFilters,
} from "@/lib/reporting";
import { money, qty } from "@/lib/format";
import { PRODUCT_CATEGORIES } from "@/lib/constants";
import FilterBar from "@/components/FilterBar";
import GroupedBarChart from "@/components/GroupedBarChart";
import WarehouseBreakdown from "@/components/WarehouseBreakdown";
import PurchasesView from "@/components/reports/PurchasesView";
import DispersalsView from "@/components/reports/DispersalsView";
import SpendView from "@/components/reports/SpendView";
import OnHandView from "@/components/reports/OnHandView";

export const dynamic = "force-dynamic";

const TABS = [
  { key: "overview", label: "Overview" },
  { key: "purchases", label: "Purchases" },
  { key: "dispersals", label: "Dispersals" },
  { key: "spend", label: "Spend" },
  { key: "onhand", label: "On-hand" },
] as const;
type ViewKey = (typeof TABS)[number]["key"];

// Local-timezone ISO date (yyyy-mm-dd) — avoids the UTC day-shift of toISOString.
function localIso(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export default async function ReportsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const user = await requireUser();
  const sp = await searchParams;
  const filters = parseFilters(sp);
  const view: ViewKey = (TABS.find((t) => t.key === sp.view)?.key ?? "overview") as ViewKey;

  // Branch scoping — only the NEW detail reports. Overview keeps its old behavior.
  const locked = branchLocked(user);
  const scopeDetail = view !== "overview" && locked;
  const detailWarehouseId = scopeDetail ? user.warehouseId ?? undefined : filters.warehouseId || undefined;

  // Per-view default date window (mirrors the FilterBar presets).
  const now = new Date();
  let effFrom = filters.from;
  let effTo = filters.to;
  if ((view === "purchases" || view === "dispersals" || view === "spend") && !effFrom && !effTo) {
    const r = view === "spend" ? last3MonthsRange(now) : lastMonthRange(now);
    effFrom = r.from;
    effTo = r.to;
  }
  const asOf = view === "onhand" ? filters.asOf ?? now : filters.asOf;

  const scopedFilters: ReportFilters = {
    ...filters,
    from: effFrom,
    to: effTo,
    asOf,
    warehouseId: detailWarehouseId,
  };

  const [allWarehouses, products] = await Promise.all([
    prisma.warehouse.findMany({ where: { active: true }, orderBy: { name: "asc" } }),
    prisma.product.findMany({ where: { active: true }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
  ]);
  const detailWarehouses =
    scopeDetail && user.warehouseId ? allWarehouses.filter((w) => w.id === user.warehouseId) : allWarehouses;

  const tabBar = (
    <div className="mb-5 flex flex-wrap gap-1.5 border-b border-line">
      {TABS.map((t) => {
        const active = t.key === view;
        return (
          <Link
            key={t.key}
            href={t.key === "overview" ? "/reports" : `/reports?view=${t.key}`}
            className={`-mb-px rounded-t-lg border-b-2 px-3 py-2 text-sm font-medium transition-colors ${
              active
                ? "border-brand-600 text-brand-700"
                : "border-transparent text-muted hover:text-ink hover:border-line"
            }`}
          >
            {t.label}
          </Link>
        );
      })}
    </div>
  );

  // ---- Overview (unchanged behavior) ----------------------------------
  if (view === "overview") {
    const cost = await productCostMap();
    const [warehouses, metrics, productRows, purch$, disp$, onHand$, breakdown] = await Promise.all([
      Promise.resolve(allWarehouses),
      warehouseMetrics(filters),
      onHandByProduct(filters),
      purchasedDollarsByWarehouse(filters.from ?? new Date(0), filters.to),
      dispersedValueByWarehouse(filters.from ?? new Date(0), filters.to, cost),
      onHandValueByWarehouse(cost),
      warehouseProductBreakdown(filters, cost),
    ]);

    const shownWarehouses = filters.warehouseId
      ? warehouses.filter((w) => w.id === filters.warehouseId)
      : warehouses;

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

    return (
      <>
        <PageHeader
          title="Reports"
          subtitle="Purchased vs. dispersed vs. on-hand, per warehouse and product."
        />
        {tabBar}

        <FilterBar
          products={products}
          warehouses={allWarehouses}
          categories={PRODUCT_CATEGORIES}
          initial={sp}
          exportBase="/api/reports/export"
          view="overview"
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

        {/* Warehouse summary — per-branch with a product-level breakdown */}
        <Card className="p-0 overflow-hidden mb-6">
          <div className="px-4 py-3 border-b border-line flex items-center justify-between gap-2">
            <h2 className="text-sm font-semibold text-ink">Warehouse summary</h2>
            <span className="text-xs text-muted">Click a branch to expand its products · $ in = purchased, $ out = dispersed</span>
          </div>
          <WarehouseBreakdown
            warehouses={shownWarehouses.map((w) => ({ id: w.id, name: w.name }))}
            data={Object.fromEntries(shownWarehouses.map((w) => [w.id, breakdown.get(w.id) ?? []]))}
          />
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

  // ---- Detail views ---------------------------------------------------
  const cost = await productCostMap();

  // FilterBar inputs for detail views — preselect the resolved default window.
  const detailInitial = {
    from: effFrom ? localIso(effFrom) : "",
    to: effTo ? localIso(effTo) : "",
    productId: filters.productId ?? "",
    warehouseId: scopeDetail ? user.warehouseId ?? "" : filters.warehouseId ?? "",
    category: filters.category ?? "",
    distributor: filters.distributor ?? "",
    technicianId: filters.technicianId ?? "",
    asOf: asOf ? localIso(asOf) : "",
  };

  const needDistributors = view === "purchases" || view === "spend";
  const needTechnicians = view === "dispersals";
  const [distributors, technicians] = await Promise.all([
    needDistributors ? distinctDistributors() : Promise.resolve([] as string[]),
    needTechnicians
      ? prisma.technician.findMany({
          where: { active: true, homeWarehouseId: detailWarehouseId ?? undefined },
          orderBy: { name: "asc" },
          select: { id: true, name: true },
        })
      : Promise.resolve([] as { id: string; name: string }[]),
  ]);

  const subtitle =
    view === "purchases"
      ? "Distributor receipts (check-in), one row per invoice line."
      : view === "dispersals"
      ? "Dispersals to technicians (check-out), by technician and line item."
      : view === "spend"
      ? "Purchase spend by distributor and category, with a monthly trend."
      : "Point-in-time on-hand per product per branch, with dollar value.";

  return (
    <>
      <PageHeader title="Reports" subtitle={subtitle} />
      {tabBar}

      <FilterBar
        products={products}
        warehouses={detailWarehouses}
        categories={view === "onhand" ? PRODUCT_CATEGORIES : undefined}
        distributors={needDistributors ? distributors : undefined}
        technicians={needTechnicians ? technicians : undefined}
        initial={detailInitial}
        exportBase="/api/reports/export"
        view={view}
        showDateRange={view !== "onhand"}
        showAsOf={view === "onhand"}
      />

      {view === "purchases" ? (
        <PurchasesView filters={scopedFilters} />
      ) : view === "dispersals" ? (
        <DispersalsView filters={scopedFilters} cost={cost} />
      ) : view === "spend" ? (
        <SpendView filters={scopedFilters} />
      ) : (
        <OnHandView filters={scopedFilters} warehouses={detailWarehouses} cost={cost} />
      )}
    </>
  );
}
