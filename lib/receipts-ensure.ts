import "server-only";
import { prisma } from "@/lib/prisma";
import { applyReceiptFile, removeReceiptLines, type ReceiptFile } from "@/lib/receipts-core";
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

async function run(): Promise<void> {
  let pending = false;
  for (const f of FILES) {
    const marker = `receipts_loaded:${f.key}`;
    try {
      if (await prisma.setting.findUnique({ where: { key: marker } })) continue;
      const r = await applyReceiptFile(prisma, f, { apply: true });
      if (!r.ready) { pending = true; continue; } // warehouse/catalog not there yet — retry later
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
  if (pending) _run = null; // allow a later request to retry
}
