import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth";
import { canManageAccessRights } from "@/lib/access";
import { normalizeProductName, PRODUCT_ALIASES } from "@/lib/product-aliases";
import baseline from "@/prisma/data/inventory-counts/2026-10-30.json";

export const runtime = "nodejs";
export const maxDuration = 30;

// On-hand baseline diagnostics (super-admin only). Compares the LIVE on-hand
// (SUM of stock movements) at each warehouse against the 10/30 count sheet, so we
// can prove the baseline landed: how many products are set, any that still don't
// match the sheet, any sheet rows that matched no catalog product, and any
// negative balances (there should be none). No writes.

const TAB_TO_WAREHOUSE: Record<string, string> = {
  "Vero Beach": "Vero Beach (HQ)",
  Stuart: "Stuart",
  Orlando: "Orlando",
  Naples: "Naples",
};

export async function GET() {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!canManageAccessRights(user)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const marker = await prisma.setting.findUnique({ where: { key: "onhand_baseline_2026-10-30" } }).catch(() => null);
  const products = await prisma.product.findMany({ select: { id: true, name: true, approved: true } });
  const byNorm = new Map<string, { id: string; name: string; approved: boolean }>();
  for (const p of products) {
    const n = normalizeProductName(p.name);
    const prev = byNorm.get(n);
    if (!prev || (!prev.approved && p.approved)) byNorm.set(n, p);
  }
  const resolve = (s: string) => {
    const n = normalizeProductName(s);
    const d = byNorm.get(n);
    if (d) return d;
    const a = (PRODUCT_ALIASES as Record<string, string>)[n];
    if (a) return byNorm.get(normalizeProductName(a)) ?? null;
    return null;
  };

  const branches = (baseline as { branches: Record<string, Record<string, number>> }).branches;
  const perBranch: Record<string, unknown> = {};
  let totalMismatch = 0;
  let totalUnmatched = 0;
  let totalNegatives = 0;

  for (const [tab, counts] of Object.entries(branches)) {
    const whName = TAB_TO_WAREHOUSE[tab];
    const wh = whName ? await prisma.warehouse.findFirst({ where: { name: whName }, select: { id: true } }) : null;
    if (!wh) { perBranch[tab] = { error: `warehouse "${whName}" not found` }; continue; }

    const target = new Map<string, number>();
    const unmatched: { name: string; qty: number }[] = [];
    for (const [raw, q] of Object.entries(counts)) {
      const qn = Number(q) || 0;
      if (qn === 0) continue;
      const p = resolve(raw);
      if (!p) { unmatched.push({ name: raw, qty: qn }); continue; }
      target.set(p.id, (target.get(p.id) ?? 0) + qn);
    }

    const agg = await prisma.stockMovement.groupBy({ by: ["productId"], where: { warehouseId: wh.id }, _sum: { quantity: true } });
    const cur = new Map<string, number>();
    for (const a of agg) cur.set(a.productId, a._sum.quantity ?? 0);

    const mismatches: { product: string; sheet: number; onHand: number }[] = [];
    for (const [pid, want] of target) {
      const got = cur.get(pid) ?? 0;
      if (got !== want) mismatches.push({ product: products.find((p) => p.id === pid)?.name ?? pid, sheet: want, onHand: got });
    }
    const negatives = [...cur.entries()]
      .filter(([, q]) => q < 0)
      .map(([pid, q]) => ({ product: products.find((p) => p.id === pid)?.name ?? pid, onHand: q }));

    totalMismatch += mismatches.length;
    totalUnmatched += unmatched.length;
    totalNegatives += negatives.length;
    perBranch[tab] = {
      productsSet: target.size,
      onHandMatchesSheet: mismatches.length === 0,
      mismatches,
      unmatchedSheetRows: unmatched,
      negativeBalances: negatives,
    };
  }

  return NextResponse.json({
    note: "On-hand vs the 10/30 count sheet. No secrets, no writes.",
    baselineMarker: marker?.value ?? "(not applied yet)",
    expectedRevision: "2026-10-30.v2",
    summary: {
      allMatch: totalMismatch === 0,
      mismatches: totalMismatch,
      unmatchedSheetRows: totalUnmatched,
      negativeBalances: totalNegatives,
    },
    branches: perBranch,
    interpretation:
      marker?.value !== "2026-10-30.v2"
        ? "Baseline revision not yet applied on this deployment — load any app page as an admin to trigger the heal, then re-check."
        : totalMismatch === 0 && totalNegatives === 0
          ? "On-hand matches the 10/30 sheet at every warehouse, no negative balances."
          : "Applied, but see mismatches/negatives above (likely a catalog product missing in prod, or a sheet row with no catalog match).",
  });
}
