import { getSessionUser, branchLocked, type SessionUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import {
  dispersalsDetail,
  last3MonthsRange,
  lastMonthRange,
  onHandByProduct,
  onHandSnapshot,
  parseFilters,
  productCostMap,
  purchasesDetail,
  spendByCategory,
  spendByDistributor,
  spendMonthlyTrend,
  warehouseMetrics,
  type ReportFilters,
} from "@/lib/reporting";

export const dynamic = "force-dynamic";
export const maxDuration = 20;

function csvCell(v: string | number): string {
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
const row = (cells: (string | number)[]) => cells.map(csvCell).join(",");
const d10 = (d: Date) => d.toISOString().slice(0, 10);
const m2 = (n: number | null | undefined) => (n ?? 0).toFixed(2);

function respond(lines: string[], name: string): Response {
  return new Response(lines.join("\n"), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${name}"`,
    },
  });
}

export async function GET(req: Request) {
  const user = await getSessionUser();
  if (!user) return new Response("Unauthorized", { status: 401 });

  const url = new URL(req.url);
  const sp = Object.fromEntries(url.searchParams.entries());
  const filters = parseFilters(sp);
  const view = sp.view ?? "overview";

  if (view === "overview") return overviewCsv(filters);

  // Branch scoping + per-view default windows (mirror the page).
  const locked = branchLocked(user);
  const detailWarehouseId = locked ? user.warehouseId ?? undefined : filters.warehouseId || undefined;
  const now = new Date();
  let from = filters.from;
  let to = filters.to;
  if ((view === "purchases" || view === "dispersals" || view === "spend") && !from && !to) {
    const r = view === "spend" ? last3MonthsRange(now) : lastMonthRange(now);
    from = r.from;
    to = r.to;
  }
  const asOf = view === "onhand" ? filters.asOf ?? now : filters.asOf;
  const scoped: ReportFilters = { ...filters, from, to, asOf, warehouseId: detailWarehouseId };

  if (view === "purchases") return purchasesCsv(scoped);
  if (view === "dispersals") return dispersalsCsv(scoped);
  if (view === "spend") return spendCsv(scoped);
  if (view === "onhand") return onhandCsv(scoped, user, locked);
  return overviewCsv(filters);
}

// ---- Overview (existing CSV, unchanged) -------------------------------
async function overviewCsv(filters: ReportFilters): Promise<Response> {
  const [warehouses, metrics, productRows] = await Promise.all([
    prisma.warehouse.findMany({ where: { active: true }, orderBy: { name: "asc" } }),
    warehouseMetrics(filters),
    onHandByProduct(filters),
  ]);

  const lines: string[] = [];
  lines.push("CanopyOS — Report");
  lines.push(row(["Range", filters.from ? d10(filters.from) : "all", "to", filters.to ? d10(filters.to) : "all"]));
  lines.push("");

  lines.push("Warehouse summary");
  lines.push(row(["Warehouse", "Purchased qty", "Purchased $", "Dispersed qty", "On-hand qty"]));
  for (const w of warehouses) {
    const m = metrics.get(w.id);
    lines.push(row([w.name, m?.purchasedQty ?? 0, m2(m?.purchasedValue), m?.dispersedQty ?? 0, m?.onHandQty ?? 0]));
  }
  lines.push("");

  lines.push("On-hand by product");
  lines.push(row(["Product", "Category", "Unit", ...warehouses.map((w) => w.name), "Total"]));
  for (const p of productRows) {
    lines.push(row([p.name, p.category, p.unit, ...warehouses.map((w) => p.byWarehouse[w.id] ?? 0), p.total]));
  }
  return respond(lines, "clements-report.csv");
}

// ---- Purchases detail -------------------------------------------------
async function purchasesCsv(f: ReportFilters): Promise<Response> {
  const detail = await purchasesDetail(f);
  const lines: string[] = [];
  lines.push("CanopyOS — Purchases (check-in) detail");
  lines.push(row(["Range", f.from ? d10(f.from) : "all", "to", f.to ? d10(f.to) : "all"]));
  lines.push("");
  lines.push(row(["Date", "Distributor", "Invoice #", "Branch", "Product", "Qty", "Unit", "Unit cost", "Line total"]));
  for (const inv of detail.invoices) {
    for (const l of inv.lines) {
      lines.push(
        row([
          d10(l.date),
          l.distributor,
          l.invoiceNumber,
          l.warehouseName,
          l.product,
          l.qty,
          l.unit ?? "",
          l.unitCost == null ? "" : m2(l.unitCost),
          m2(l.lineTotal),
        ])
      );
    }
    lines.push(row(["", "", inv.invoiceNumber, "", "Invoice subtotal", "", "", "", m2(inv.subtotal)]));
  }
  lines.push("");
  lines.push("Branch subtotals");
  lines.push(row(["Branch", "Purchases $"]));
  for (const b of detail.byBranch) lines.push(row([b.warehouseName, m2(b.subtotal)]));
  lines.push(row(["Grand total", m2(detail.grandTotal)]));
  return respond(lines, "clements-purchases.csv");
}

// ---- Dispersals detail ------------------------------------------------
async function dispersalsCsv(f: ReportFilters): Promise<Response> {
  const cost = await productCostMap();
  const detail = await dispersalsDetail(f, cost);
  const lines: string[] = [];
  lines.push("CanopyOS — Dispersals (check-out) detail");
  lines.push(row(["Range", f.from ? d10(f.from) : "all", "to", f.to ? d10(f.to) : "all"]));
  lines.push("");
  lines.push("By technician");
  lines.push(row(["Technician", "Lines", "Units", "Est. value"]));
  for (const t of detail.byTech) lines.push(row([t.technician, t.lines, t.units, m2(t.value)]));
  lines.push(row(["Total", detail.lines.length, detail.totalUnits, m2(detail.totalValue)]));
  lines.push("");
  lines.push("Line items");
  lines.push(row(["Date", "Branch", "Technician", "Product", "Qty", "Unit", "Est. value"]));
  for (const l of detail.lines) {
    lines.push(row([d10(l.date), l.warehouseName, l.technician, l.product, l.qty, l.unit ?? "", m2(l.value)]));
  }
  return respond(lines, "clements-dispersals.csv");
}

// ---- Spend by distributor / category ----------------------------------
async function spendCsv(f: ReportFilters): Promise<Response> {
  const from = f.from ?? new Date(0);
  const [byDistributor, byCategory, trend] = await Promise.all([
    spendByDistributor(from, f.to, f.warehouseId, f.distributor),
    spendByCategory(from, f.to, f.warehouseId, f.distributor),
    spendMonthlyTrend(from, f.to, f.warehouseId, f.distributor),
  ]);
  const lines: string[] = [];
  lines.push("CanopyOS — Spend by distributor / category");
  lines.push(row(["Range", f.from ? d10(f.from) : "all", "to", f.to ? d10(f.to) : "all"]));
  lines.push("");
  lines.push("Spend by distributor");
  lines.push(row(["Distributor", "Invoices", "Total $"]));
  for (const d of byDistributor) lines.push(row([d.distributor, d.invoices, m2(d.total)]));
  lines.push(row(["Total", byDistributor.reduce((s, r) => s + r.invoices, 0), m2(byDistributor.reduce((s, r) => s + r.total, 0))]));
  lines.push("");
  lines.push("Spend by category");
  lines.push(row(["Category", "Total $"]));
  for (const c of byCategory) lines.push(row([c.label, m2(c.value)]));
  lines.push(row(["Total", m2(byCategory.reduce((s, r) => s + r.value, 0))]));
  lines.push("");
  lines.push("Monthly trend");
  lines.push(row(["Month", "Total $"]));
  for (const t of trend) lines.push(row([t.label, m2(t.total)]));
  return respond(lines, "clements-spend.csv");
}

// ---- On-hand snapshot -------------------------------------------------
async function onhandCsv(f: ReportFilters, user: SessionUser, locked: boolean): Promise<Response> {
  const cost = await productCostMap();
  const allWarehouses = await prisma.warehouse.findMany({ where: { active: true }, orderBy: { name: "asc" } });
  const warehouses = locked && user.warehouseId ? allWarehouses.filter((w) => w.id === user.warehouseId) : allWarehouses;
  const snapshot = await onHandSnapshot(
    { asOf: f.asOf, warehouseId: f.warehouseId, category: f.category, productId: f.productId },
    cost
  );
  const lines: string[] = [];
  lines.push("CanopyOS — On-hand snapshot");
  lines.push(row(["As of", d10(snapshot.asOf)]));
  lines.push("");
  lines.push(row(["Product", "Category", "Unit", ...warehouses.map((w) => w.name), "Total qty", "Unit cost", "Total value"]));
  for (const r of snapshot.rows) {
    lines.push(
      row([
        r.name,
        r.category,
        r.unit,
        ...warehouses.map((w) => r.byWarehouse[w.id] ?? 0),
        r.totalQty,
        m2(r.unitCost),
        m2(r.totalValue),
      ])
    );
  }
  lines.push(
    row([
      "Grand total",
      "",
      "",
      ...warehouses.map((w) => m2(snapshot.byWarehouseValue[w.id]?.value ?? 0)),
      snapshot.grandTotalQty,
      "",
      m2(snapshot.grandTotalValue),
    ])
  );
  return respond(lines, "clements-onhand.csv");
}
