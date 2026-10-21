/**
 * Apply the research-enriched product profiles (prisma/data/product-research.json)
 * onto the catalog: manufacturer, active ingredient, EPA #, physical form, and a
 * one-line "what it's used / approved for". Matched by normalized product name
 * against ACTIVE products. FILL-IF-NULL only, so a human's edits are never
 * clobbered. Idempotent + safe to re-run; no-ops cleanly if the file is absent.
 */
import type { PrismaClient } from "@prisma/client";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { normalizeProductName } from "../lib/product-aliases";

const JSON_PATH = join(process.cwd(), "prisma", "data", "product-research.json");

type Research = {
  name: string;
  manufacturer?: string | null;
  activeIngredient?: string | null;
  epaRegNo?: string | null;
  form?: string | null;
  usedFor?: string | null;
};

export async function applyProductResearch(prisma: PrismaClient): Promise<{ matched: number; updated: number; unmatched: string[] }> {
  if (!existsSync(JSON_PATH)) return { matched: 0, updated: 0, unmatched: [] };
  const rows = JSON.parse(readFileSync(JSON_PATH, "utf8")) as Research[];
  const products = await prisma.product.findMany({
    where: { active: true },
    select: { id: true, name: true, manufacturer: true, activeIngredient: true, epaRegNumber: true, form: true, usedFor: true },
  });
  const byNorm = new Map(products.map((p) => [normalizeProductName(p.name), p]));

  let matched = 0, updated = 0;
  const unmatched: string[] = [];
  for (const r of rows) {
    if (!r.name) continue;
    const p = byNorm.get(normalizeProductName(r.name));
    if (!p) { unmatched.push(r.name); continue; }
    matched++;
    const data: Record<string, string> = {};
    if (!p.manufacturer && r.manufacturer) data.manufacturer = r.manufacturer;
    if (!p.activeIngredient && r.activeIngredient) data.activeIngredient = r.activeIngredient;
    if (!p.epaRegNumber && r.epaRegNo) data.epaRegNumber = r.epaRegNo;
    if (!p.form && r.form) data.form = r.form;
    if (!p.usedFor && r.usedFor) data.usedFor = r.usedFor;
    if (Object.keys(data).length) { await prisma.product.update({ where: { id: p.id }, data }); updated++; }
  }
  return { matched, updated, unmatched };
}
