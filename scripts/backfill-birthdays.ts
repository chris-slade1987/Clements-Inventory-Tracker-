/**
 * Employee birthday backfill — PREVIEW + APPLY.
 *
 * Reads prisma/data/employee-birthdays.json (the HR "Employee Listings" export)
 * and sets Employee.birthMonth / birthDay / birthYear on each matched profile.
 * The birth YEAR is stored but stays HR-only (never shown on the bulletin/team
 * views) — same rule as the rest of the birthday feature.
 *
 * MATCHING (active employees): for each sheet row, in order —
 *   1) exact normalized full-name match on `name`
 *   2) exact normalized full-name match on `aka` (the formal HR name)
 * Normalization lower-cases, drops punctuation, suffixes (Jr/Sr/II…) and
 * single-letter middle initials. A row that matches nothing — or matches more
 * than one employee — is reported, never guessed (no fuzzy/last-name fallback:
 * putting the wrong birthday on the wrong person is worse than leaving it unset).
 * Each employee is matched at most once (a second row targeting the same person
 * is flagged).
 *
 * IDEMPOTENT: re-running sets the same values. Safe to re-run.
 *
 *   Preview:  DATABASE_URL=... tsx scripts/backfill-birthdays.ts
 *   Apply:    DATABASE_URL=... tsx scripts/backfill-birthdays.ts apply
 */
import type { PrismaClient } from "@prisma/client";
import { readFileSync } from "node:fs";
import { join } from "node:path";

type Row = { name: string; aka?: string; month: number; day: number; year: number };
type Doc = { source?: string; note?: string; people: Row[] };

export type BirthdayBackfillResult = {
  mode: "preview" | "apply";
  matched: Array<{ sheet: string; employee: string; via: string; md: string }>;
  unmatched: Array<{ sheet: string; reason: string }>;
  total: number;
};

function norm(s: string): string {
  return (s || "")
    .toLowerCase()
    .replace(/[.,]/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .filter((t) => !/^(jr|sr|ii|iii|iv|v)$/.test(t)) // drop generational suffixes
    .filter((t) => t.length > 1) // drop single-letter middle initials
    .join(" ")
    .trim();
}
export const BIRTHDAY_REPORT_KEY = "employee_birthdays_report";

export async function backfillBirthdays(
  prisma: PrismaClient,
  opts: { apply: boolean } = { apply: false },
): Promise<BirthdayBackfillResult> {
  const doc = JSON.parse(readFileSync(join(process.cwd(), "prisma", "data", "employee-birthdays.json"), "utf8")) as Doc;
  const result: BirthdayBackfillResult = { mode: opts.apply ? "apply" : "preview", matched: [], unmatched: [], total: doc.people.length };

  const employees = await prisma.employee.findMany({ where: { status: "active" }, select: { id: true, name: true } });
  const byName = new Map<string, { id: string; name: string }[]>();
  for (const e of employees) {
    const n = norm(e.name);
    (byName.get(n) ?? byName.set(n, []).get(n)!).push(e);
  }

  const usedEmployeeIds = new Set<string>();

  for (const row of doc.people) {
    const tryKeys: Array<[string, string]> = [["name", row.name]];
    if (row.aka) tryKeys.push(["aka", row.aka]);

    let hit: { id: string; name: string } | null = null;
    let via = "";
    for (const [label, value] of tryKeys) {
      const cands = byName.get(norm(value));
      if (cands && cands.length === 1) { hit = cands[0]; via = `exact ${label}`; break; }
      if (cands && cands.length > 1) { via = `AMBIGUOUS ${label}`; break; }
    }

    if (!hit) {
      result.unmatched.push({ sheet: `${row.name}${row.aka ? ` (${row.aka})` : ""}`, reason: via.startsWith("AMBIGUOUS") ? `multiple employees match (${via})` : "no active employee match" });
      continue;
    }
    if (usedEmployeeIds.has(hit.id)) {
      result.unmatched.push({ sheet: row.name, reason: `${hit.name} already matched by an earlier row` });
      continue;
    }
    usedEmployeeIds.add(hit.id);
    result.matched.push({ sheet: row.name, employee: hit.name, via, md: `${row.month}/${row.day}/${row.year}` });

    if (opts.apply) {
      await prisma.employee.update({ where: { id: hit.id }, data: { birthMonth: row.month, birthDay: row.day, birthYear: row.year } });
    }
  }

  // Persist a readable summary (admin diagnostics surfaces this) so the prod
  // result can be confirmed and stragglers mopped up without DB access.
  if (opts.apply) {
    const report = JSON.stringify({
      at: new Date().toISOString(),
      total: result.total,
      matchedCount: result.matched.length,
      unmatched: result.unmatched,
      matched: result.matched.map((m) => `${m.sheet} -> ${m.employee}`),
    });
    await prisma.setting
      .upsert({ where: { key: BIRTHDAY_REPORT_KEY }, update: { value: report }, create: { key: BIRTHDAY_REPORT_KEY, value: report } })
      .catch(() => {});
  }

  return result;
}

function printReport(r: BirthdayBackfillResult): void {
  console.log(`\n=== Employee birthday backfill — ${r.mode.toUpperCase()} ===`);
  console.log(`Matched ${r.matched.length}/${r.total}; unmatched ${r.unmatched.length}.`);
  for (const m of r.matched) console.log(`  ✓ ${m.sheet} -> ${m.employee}  [${m.via}]  ${m.md}`);
  if (r.unmatched.length) {
    console.log(`\n  UNMATCHED (not set — needs review):`);
    for (const u of r.unmatched) console.log(`     ✗ ${u.sheet} — ${u.reason}`);
  }
}

if (process.argv[1] && /backfill-birthdays\.ts$/.test(process.argv[1])) {
  const apply = process.argv.slice(2).some((a) => a === "apply" || a === "--apply");
  (async () => {
    const { PrismaClient } = await import("@prisma/client");
    const prisma = new PrismaClient();
    try {
      const r = await backfillBirthdays(prisma, { apply });
      printReport(r);
    } finally {
      await prisma.$disconnect();
    }
  })().catch((e) => { console.error(e); process.exit(1); });
}
