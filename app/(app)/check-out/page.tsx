import { redirect } from "next/navigation";
import { ensureCatalogCleanup } from "@/lib/catalog-cleanup";
import { PageHeader } from "@/components/ui";
import InventorySubnav from "@/components/InventorySubnav";
import RequestProductButton from "@/components/RequestProductButton";
import { requireUser, isBoardObserver } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { onHandMatrix } from "@/lib/inventory";
import { isCountReason } from "@/lib/stock-count";
import { uomCode } from "@/lib/uom";
import { ensureTechnicianRoster } from "@/lib/technician-roster-ensure";
import { routeNumberFor } from "@/lib/route-numbers";
import ScanCheckoutClient from "./ScanCheckoutClient";

export const dynamic = "force-dynamic";

// The single, consolidated Check-Out screen. Powered by the smart scan flow
// (scan → unknown-barcode linker → AI photo fallback → shelf QR → cart →
// review → optional signature → submit → success + 15-min undo), with the
// legacy flow's branch selection and over-on-hand escalation carried in.
export default async function CheckOutPage({
  searchParams,
}: {
  searchParams: Promise<{ branch?: string }>;
}) {
  const user = await requireUser();
  await ensureCatalogCleanup(); // catalog cleanup lands before we read products
  await ensureTechnicianRoster(); // every route-number holder is on the roster before we read it
  if (isBoardObserver(user)) redirect("/management/board");
  // Technicians (role employee) cannot check out; managers/admins can.
  if (user.role !== "admin" && user.role !== "manager") redirect("/me");

  const sp = await searchParams;
  const isAdmin = user.role === "admin";

  const [warehouses, technicians, products, matrix, adjustments, employees] = await Promise.all([
    prisma.warehouse.findMany({ where: { active: true }, orderBy: { name: "asc" } }),
    prisma.technician.findMany({ where: { active: true }, orderBy: { name: "asc" } }),
    prisma.product.findMany({ where: { active: true }, orderBy: [{ approved: "desc" }, { name: "asc" }] }),
    onHandMatrix(),
    prisma.stockMovement.findMany({ where: { type: "adjustment" }, select: { productId: true, warehouseId: true, reason: true } }),
    prisma.employee.findMany({ where: { status: "active" }, select: { name: true, nickname: true, routeNumber: true } }),
  ]);

  // PestPac tech/route # beside each name ("Brian Lasneski · 28") so managers can
  // find people the way PestPac lists them ("28 BRIAN L"). Profile route # wins,
  // then the phone list (lib/route-numbers), then a short numeric PestPac card #.
  const nk = (s: string | null | undefined) => (s ?? "").trim().toLowerCase().replace(/\s+/g, " ");
  const routeByName = new Map<string, string>();
  for (const e of employees) {
    if (!e.routeNumber?.trim()) continue;
    routeByName.set(nk(e.name), e.routeNumber.trim());
    if (e.nickname) routeByName.set(nk(e.nickname), e.routeNumber.trim());
  }
  const whName = new Map(warehouses.map((w) => [w.id, w.name]));
  const routeFor = (t: { name: string; homeWarehouseId: string; employeeIdCard: string | null }): string | null =>
    routeByName.get(nk(t.name)) ??
    routeNumberFor({ name: t.name, branch: whName.get(t.homeWarehouseId) ?? null }) ??
    (/^\d{1,3}$/.test(t.employeeIdCard?.trim() ?? "") ? t.employeeIdCard!.trim() : null);

  // Default branch: the user's own warehouse, else their BRANCH's warehouse (matched
  // by name — Warehouse has no branch column — so the Vero manager lands on Vero
  // Beach, not Naples/first-alphabetical), else the first warehouse. A requested
  // ?branch=<warehouseId> wins for anyone. Managers can toggle (branchLocked=false).
  const branchKey = (user.branch ?? "").trim().toLowerCase();
  const homeWarehouseId =
    user.warehouseId ||
    (branchKey ? warehouses.find((w) => w.name.toLowerCase().includes(branchKey))?.id : undefined) ||
    "";
  const requested = (sp.branch ?? "").trim();
  const defaultWarehouseId =
    warehouses.find((w) => w.id === requested)?.id || homeWarehouseId || warehouses[0]?.id || "";

  // on-hand matrix → plain object.
  const onHand: Record<string, Record<string, number>> = {};
  for (const [wid, m] of matrix) onHand[wid] = Object.fromEntries(m);

  // counted-at-branch sets (from count/reconciliation adjustments).
  const countedByWarehouse: Record<string, string[]> = {};
  const countedSets: Record<string, Set<string>> = {};
  for (const a of adjustments) {
    if (!isCountReason(a.reason)) continue;
    (countedSets[a.warehouseId] ??= new Set()).add(a.productId);
  }
  for (const [wid, set] of Object.entries(countedSets)) countedByWarehouse[wid] = [...set];

  return (
    <>
      <PageHeader
        title="Check-Out"
        subtitle="Scan or photograph a product and issue it to a technician's truck."
        actions={<RequestProductButton warehouseId={defaultWarehouseId} />}
      />
      <InventorySubnav isAdmin={isAdmin} />
      <ScanCheckoutClient
        branchLocked={false}
        defaultWarehouseId={defaultWarehouseId}
        warehouses={warehouses.map((w) => ({ id: w.id, name: w.name }))}
        technicians={technicians.map((t) => ({ id: t.id, name: t.name, homeWarehouseId: t.homeWarehouseId, routeNumber: routeFor(t) }))}
        products={products.map((p) => ({
          id: p.id,
          name: p.name,
          unit: uomCode(p.unitOfMeasure) ?? p.unitOfMeasure,
          distributorSku: p.distributorSku,
          manufacturer: p.manufacturer,
          category: p.category,
          approved: p.approved,
          confirmed: p.confirmed,
        }))}
        onHand={onHand}
        countedByWarehouse={countedByWarehouse}
      />
    </>
  );
}
