/**
 * Regenerate prisma/data/hosted-courses.json — the code→URL manifest of hosted
 * interactive course pages in public/courses. Run after adding/removing course
 * files so the runtime reseed links them:  npx tsx scripts/gen-hosted-courses.ts
 */
import { readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const dir = join(process.cwd(), "public", "courses");
const out: Record<string, string> = {};
for (const f of readdirSync(dir).sort()) {
  if (!f.endsWith(".html")) continue;
  const m = f.match(/^([a-z]+-(?:\d+|fld))-/i);
  if (m) out[m[1].toUpperCase()] = `/courses/${f}`;
}
writeFileSync(join(process.cwd(), "prisma", "data", "hosted-courses.json"), JSON.stringify(out, null, 2) + "\n");
console.log(`wrote prisma/data/hosted-courses.json — ${Object.keys(out).length} courses.`);
