/**
 * CLI / deploy-time entry for distributor receipts reported from PestPac transfer
 * exports (prisma/data/receipts/*.json). The real work lives in lib/receipts-core.ts;
 * production applies the same files at RUNTIME via lib/receipts-ensure.ts (the
 * build-time seed doesn't reliably reach the live database).
 *
 * Usage: tsx scripts/load-receipts.ts [--apply]   (dry run without --apply)
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { PrismaClient } from "@prisma/client";
import { applyReceiptFile, type ReceiptFile, type ReceiptFileResult } from "../lib/receipts-core";

export type LoadReceiptsResult = { files: ReceiptFileResult[] };

export async function loadReceipts(prisma: PrismaClient, opts: { apply: boolean }): Promise<LoadReceiptsResult> {
  const dir = join(process.cwd(), "prisma", "data", "receipts");
  let names: string[] = [];
  try { names = readdirSync(dir).filter((f) => f.endsWith(".json")).sort(); } catch { return { files: [] }; }
  const files: ReceiptFileResult[] = [];
  for (const name of names) {
    const f = JSON.parse(readFileSync(join(dir, name), "utf8")) as ReceiptFile;
    files.push(await applyReceiptFile(prisma, f, opts));
  }
  return { files };
}

if (require.main === module) {
  (async () => {
    const { PrismaClient } = await import("@prisma/client");
    const prisma = new PrismaClient();
    try {
      console.log(JSON.stringify(await loadReceipts(prisma, { apply: process.argv.includes("--apply") }), null, 2));
    } finally { await prisma.$disconnect(); }
  })();
}
