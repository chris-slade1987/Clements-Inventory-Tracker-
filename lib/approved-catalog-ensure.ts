import "server-only";
import { prisma } from "@/lib/prisma";
import { seedApprovedProducts } from "@/prisma/seed-products-approved";

// Runtime healer: reconcile the CEO's approved product catalog into the LIVE DB.
// The build-time seed doesn't reliably reach the prod runtime DB, so in production
// most approved products were missing — which meant the 10/30 on-hand baseline
// could only attach stock to the ~20 products that happened to exist, leaving ~95
// sheet rows unmatched. This upserts the full approved catalog (by normalized name,
// idempotent, never deletes a product or touches stock movements). It MUST run
// before ensureOnHandBaseline so the baseline can match every counted product.
// Revisioned (Setting `approved_catalog_rev`); runs once per revision; non-fatal.

const REVISION = "2026-11-04";
let _ran = false;

export async function ensureApprovedCatalog(): Promise<void> {
  if (_ran) return;
  try {
    const key = "approved_catalog_rev";
    const marker = await prisma.setting.findUnique({ where: { key } });
    if (marker?.value === REVISION) { _ran = true; return; }
    const r = await seedApprovedProducts(prisma);
    await prisma.setting.upsert({ where: { key }, update: { value: REVISION }, create: { key, value: REVISION } });
    _ran = true;
    console.log(`ensureApprovedCatalog: ${r.created} created, ${r.updated} updated, ${r.demoted} demoted (${r.approvedTotal} approved).`);
  } catch (e) {
    console.error("ensureApprovedCatalog failed (non-fatal):", e);
  }
}
