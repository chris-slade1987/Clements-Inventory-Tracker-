import "server-only";
import { prisma } from "@/lib/prisma";
import { applyReceiptFile, removeReceiptLines, type ReceiptFile } from "@/lib/receipts-core";
import { surfaceHiddenReceivedStock, type SurfacedProduct } from "@/lib/received-product";
import { postSystemThread } from "@/lib/threads";
import { superAdminRecipients } from "@/lib/product-requests";
import { appUrl } from "@/lib/app-url";
import r20261103orlando from "@/prisma/data/receipts/2026-11-03-orlando-siteone.json";
import r20261103vero from "@/prisma/data/receipts/2026-11-03-vero-siteone.json";
import r20261104vero from "@/prisma/data/receipts/2026-11-04-vero-siteone.json";

// Runtime loader for distributor receipts reported from PestPac transfer exports.
// Production only accepts RUNTIME writes (the build-time seed doesn't reach the
// live DB — the same reason the 10/30 baseline and catalog load here), so each
// committed receipts file is applied on the first request after deploy.
//
// To add a shipment: commit prisma/data/receipts/<date>-<branch>-<vendor>.json and
// add it to FILES below. Each file is marked done in a Setting once posted; lines
// are idempotent (fixed externalRef), so a retry or a concurrent run posts nothing
// twice. Never edits or deletes existing movements. Non-fatal.

const FILES: ReceiptFile[] = [r20261103orlando as ReceiptFile, r20261103vero as ReceiptFile, r20261104vero as ReceiptFile];

let _run: Promise<void> | null = null;

export function ensureReceiptsLoaded(): Promise<void> {
  if (!_run) _run = run().catch(() => { _run = null; });
  return _run;
}

// Bump to re-run the one-time "surface hidden received stock" repair.
const SURFACE_REVISION = "2026-11-23";

/** Tell the super admins (Julie, Chris, April) which received products now need
 *  their approval before they can be checked out. Non-fatal. */
async function notifySurfaced(list: SurfacedProduct[]): Promise<void> {
  if (list.length === 0) return;
  try {
    const recipients = await superAdminRecipients();
    if (recipients.length === 0) return;
    const confirm = list.filter((p) => p.queue === "confirm");
    const request = list.filter((p) => p.queue === "request");
    const lines = [
      ...(confirm.length ? [`On the approved catalog — confirm in Catalog Admin → Review (${appUrl()}/manage/confirm):`, ...confirm.map((p) => `• ${p.name}`), ""] : []),
      ...(request.length ? [`Not on the approved catalog — approve, merge or decline in Catalog Admin → Requests (${appUrl()}/manage/product-requests):`, ...request.map((p) => `• ${p.name}`)] : []),
    ];
    await postSystemThread({
      subject: `${list.length} received product${list.length === 1 ? "" : "s"} need approval before check-out`,
      body:
        `Stock was received on an invoice for ${list.length === 1 ? "a product that was" : "products that were"} off the catalog. ` +
        `${list.length === 1 ? "It is" : "They are"} back on and visible at check-out, but can't be dispensed until approved.\n\n` +
        lines.join("\n"),
      recipients,
      contextType: "alert",
      contextLabel: "Product approval request",
      contextHref: confirm.length ? "/manage/confirm" : "/manage/product-requests",
      branch: null,
    });
  } catch (e) {
    console.error("ensureReceiptsLoaded: approval notice failed (non-fatal):", e);
  }
}

async function run(): Promise<void> {
  let pending = false;
  const surfaced: SurfacedProduct[] = [];
  for (const f of FILES) {
    const marker = `receipts_loaded:${f.key}`;
    try {
      if (await prisma.setting.findUnique({ where: { key: marker } })) continue;
      const r = await applyReceiptFile(prisma, f, { apply: true });
      if (!r.ready) { pending = true; continue; } // warehouse/catalog not there yet — retry later
      surfaced.push(...r.surfaced);
      const summary = JSON.stringify({ at: new Date().toISOString(), posted: r.posted, skipped: r.skippedExisting, unmatched: r.unmatched, alreadyReceived: r.alreadyReceived, lines: r.detail });
      await prisma.setting.upsert({ where: { key: marker }, update: { value: summary }, create: { key: marker, value: summary } });
      console.log(`ensureReceiptsLoaded: ${f.key} (${f.warehouse}) — ${r.posted} posted, ${r.skippedExisting} already loaded${r.unmatched.length ? `; UNMATCHED: ${r.unmatched.join(", ")}` : ""}${r.alreadyReceived.length ? `; SKIPPED (already received): ${r.alreadyReceived.join(", ")}` : ""}.`);
    } catch (e) {
      pending = true;
      console.error(`ensureReceiptsLoaded: ${f.key} failed (non-fatal, will retry):`, e);
    }
  }
  // Lines later flagged `remove` (COO review) — reverse them if they were posted.
  // Runs after the loads above; once per file (Setting marker), self-retries.
  for (const f of FILES) {
    if (!f.lines.some((l) => l.remove)) continue;
    const marker = `receipts_removed:${f.key}:${f.lines.map((l, i) => (l.remove ? i + 1 : "")).filter(Boolean).join(",")}`;
    try {
      if (await prisma.setting.findUnique({ where: { key: marker } })) continue;
      if (!(await prisma.setting.findUnique({ where: { key: `receipts_loaded:${f.key}` } }))) { pending = true; continue; }
      const n = await removeReceiptLines(prisma, f);
      const value = JSON.stringify({ at: new Date().toISOString(), reversed: n });
      await prisma.setting.upsert({ where: { key: marker }, update: { value }, create: { key: marker, value } });
      console.log(`ensureReceiptsLoaded: ${f.key} — ${n} removed line(s) reversed.`);
    } catch (e) {
      pending = true;
      console.error(`ensureReceiptsLoaded: removing lines from ${f.key} failed (non-fatal, will retry):`, e);
    }
  }
  // One-time repair: stock already received onto products that were off the catalog
  // (e.g. LESCO 16-0-8 Spar Tech, Vero 11/4) — turn them back on and queue them for
  // approval. Once per revision (Setting marker); self-retries on failure.
  const surfaceMarker = `received_products_surfaced:${SURFACE_REVISION}`;
  try {
    if (!(await prisma.setting.findUnique({ where: { key: surfaceMarker } }))) {
      const healed = await surfaceHiddenReceivedStock(prisma);
      surfaced.push(...healed);
      const value = JSON.stringify({ at: new Date().toISOString(), surfaced: healed });
      await prisma.setting.upsert({ where: { key: surfaceMarker }, update: { value }, create: { key: surfaceMarker, value } });
      console.log(`ensureReceiptsLoaded: surfaced ${healed.length} received product(s) that were off the catalog${healed.length ? `: ${healed.map((p) => p.name).join(", ")}` : ""}.`);
    }
  } catch (e) {
    pending = true;
    console.error("ensureReceiptsLoaded: surfacing received products failed (non-fatal, will retry):", e);
  }
  await notifySurfaced(surfaced);
  if (pending) _run = null; // allow a later request to retry
}
