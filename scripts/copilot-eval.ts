/**
 * Canopy Copilot — retrieval eval (Theme 5, Wave A, §12).
 *
 * A fixed set of real questions that MUST retrieve the right company source, plus
 * out-of-scope questions that must retrieve NOTHING (so Wave B's cite-or-decline
 * has teeth), plus access-scope checks (an employee must not reach manager-only
 * sources). Runs OFFLINE against the seeded SQLite DB and prints pass/fail.
 *
 * How to run (from the repo root):
 *   1. Ensure the schema exists:   DATABASE_URL="file:./dev.db" npx prisma db push
 *   2. (optional) full seed:       npm run db:seed
 *   3. Run the eval:               DATABASE_URL="file:./dev.db" npx tsx scripts/copilot-eval.ts
 *
 * If the core corpora (manual, handbook, SOPs, checklists) aren't seeded yet, the
 * eval seeds just those (idempotent) so it is self-contained, then reindexes.
 * Exits non-zero if any case fails.
 */
import { prisma } from "../lib/prisma";
import { reindexKnowledge, knowledgeChunkCount } from "../lib/copilot/ingest";
import { retrieveForTags, accessTagsFromGrants, type RetrievedChunk } from "../lib/copilot/retrieve";
import { DEFAULT_GRANTS } from "../lib/access-catalog";

// Two principals, built straight from the catalog defaults (no auth imports, so
// this stays a plain-Node script). A super admin sees every accessTag; a branch
// employee sees only all-staff content + their branch.
const SUPERADMIN_TAGS = accessTagsFromGrants(DEFAULT_GRANTS.super_admin, { superadmin: true, allBranches: true, branch: null });
const EMPLOYEE_TAGS = accessTagsFromGrants(DEFAULT_GRANTS.employee, { superadmin: false, allBranches: false, branch: "vero" });

type Hit = RetrievedChunk;
const top = (hits: Hit[], n = 3) => hits.slice(0, n);
const summarize = (hits: Hit[]) =>
  hits.length === 0
    ? "(nothing)"
    : top(hits).map((h) => `${h.chunk.sourceType}:${h.chunk.sourceId}${h.chunk.sectionTitle ? ` › ${h.chunk.sectionTitle}` : ""} [${h.score.toFixed(2)}]`).join(" | ");

type Case = {
  kind: "in" | "out" | "scope";
  q: string;
  tags: string[];
  // in/scope-positive: at least one of the top-3 hits must satisfy `want`.
  // out: must return zero hits. scope-negative: none of the hits may satisfy `deny`.
  want?: (h: Hit) => boolean;
  deny?: (h: Hit) => boolean;
  note: string;
};

const CASES: Case[] = [
  // ---- in-scope: must cite the right source ---------------------------------
  { kind: "in", q: "how do I write someone up", tags: SUPERADMIN_TAGS, note: "→ Progressive Discipline / disciplinary action",
    want: (h) => ["manual", "handbook"].includes(h.chunk.sourceType) && /disciplin|progressive|write/i.test(`${h.chunk.sectionTitle} ${h.chunk.content}`) },
  { kind: "in", q: "progressive discipline policy for attendance", tags: SUPERADMIN_TAGS, note: "→ Handbook Progressive Discipline / Attendance",
    want: (h) => h.chunk.sourceType === "handbook" && /discipline|attendance/i.test(`${h.chunk.sectionTitle} ${h.chunk.content}`) },
  { kind: "in", q: "weekly oversight checklist", tags: SUPERADMIN_TAGS, note: "→ Weekly Oversight Checklist",
    want: (h) => /weekly/i.test(`${h.chunk.title} ${h.chunk.sectionTitle}`) && (h.chunk.sourceType === "checklist" || h.chunk.sourceType === "manual") },
  { kind: "in", q: "branch open and close procedure", tags: SUPERADMIN_TAGS, note: "→ SOP Branch Open / Close",
    want: (h) => h.chunk.sourceType === "sop" && h.chunk.sourceId === "branch-open-close" },
  { kind: "in", q: "new vehicle onboarding steps", tags: SUPERADMIN_TAGS, note: "→ SOP New-Vehicle Onboarding",
    want: (h) => h.chunk.sourceType === "sop" && h.chunk.sourceId === "new-vehicle-onboarding" },
  { kind: "in", q: "how do I request time off pto", tags: SUPERADMIN_TAGS, note: "→ PTO policy",
    want: (h) => /pto|paid time off|time off|vacation/i.test(`${h.chunk.sectionTitle} ${h.chunk.content}`) },
  { kind: "in", q: "warehouse safety inspection", tags: SUPERADMIN_TAGS, note: "→ Warehouse Safety",
    want: (h) => /warehouse safety/i.test(`${h.chunk.sectionTitle} ${h.chunk.content}`) },
  { kind: "in", q: "hurricane preparedness guidelines", tags: SUPERADMIN_TAGS, note: "→ Hurricane Preparedness",
    want: (h) => /hurricane/i.test(`${h.chunk.sectionTitle} ${h.chunk.content}`) },
  { kind: "in", q: "what are the brand colors and forest green", tags: SUPERADMIN_TAGS, note: "→ Brand Kit",
    want: (h) => h.chunk.sourceType === "doc" && h.chunk.sourceId === "brand-kit" },

  // ---- out-of-scope: must retrieve NOTHING ----------------------------------
  { kind: "out", q: "pizza toppings recipe", tags: SUPERADMIN_TAGS, note: "nonsense → decline" },
  { kind: "out", q: "world cup soccer scores", tags: SUPERADMIN_TAGS, note: "nonsense → decline" },
  { kind: "out", q: "famous jazz musicians biography", tags: SUPERADMIN_TAGS, note: "nonsense → decline" },

  // ---- access scope: an employee must not reach manager-only sources --------
  { kind: "scope", q: "branch open and close procedure", tags: EMPLOYEE_TAGS, note: "employee must NOT get the manager SOP",
    deny: (h) => ["sop", "manual", "checklist", "doc"].includes(h.chunk.sourceType) },
  { kind: "scope", q: "weekly oversight checklist", tags: EMPLOYEE_TAGS, note: "employee must NOT get the manager checklist",
    deny: (h) => ["sop", "manual", "checklist", "doc"].includes(h.chunk.sourceType) },
  // positive control: the employee CAN still reach the all-staff handbook.
  { kind: "in", q: "paid time off vacation policy", tags: EMPLOYEE_TAGS, note: "employee CAN reach the handbook PTO policy",
    want: (h) => h.chunk.sourceType === "handbook" && /pto|vacation|paid time off/i.test(`${h.chunk.sectionTitle} ${h.chunk.content}`) },
];

async function ensureCorpusSeeded() {
  const docs = await prisma.policyDocument.count().catch(() => {
    throw new Error("KnowledgeChunk/PolicyDocument tables not found. Run: DATABASE_URL=\"file:./dev.db\" npx prisma db push");
  });
  if (docs === 0) {
    console.log("copilot-eval: seeding core corpora (documents, checklists, SOPs)…");
    const { seedDocuments } = await import("../prisma/seed-documents");
    const { seedChecklists } = await import("../prisma/seed-checklists");
    const { seedSops } = await import("../prisma/seed-sops");
    await seedDocuments(prisma);
    await seedChecklists(prisma);
    await seedSops(prisma);
  }
}

async function main() {
  await ensureCorpusSeeded();
  const r = await reindexKnowledge();
  const live = await knowledgeChunkCount();
  console.log(`copilot-eval: index ready — ${live} live chunks (${r.created} created, ${r.unchanged} unchanged, ${r.retired} retired this run).`);

  // Idempotency check: a second reindex must change nothing.
  const r2 = await reindexKnowledge();
  const idempotent = r2.created === 0 && r2.updated === 0 && r2.retired === 0;
  console.log(`copilot-eval: idempotency — second reindex ${idempotent ? "OK (no changes)" : `FAILED (created=${r2.created}, updated=${r2.updated}, retired=${r2.retired})`}.`);

  console.log(`copilot-eval: superadmin tags = [${SUPERADMIN_TAGS.join(", ")}]`);
  console.log(`copilot-eval: employee  tags = [${EMPLOYEE_TAGS.join(", ")}]\n`);

  let passed = 0;
  let failed = 0;
  const run = (ok: boolean, label: string, detail: string) => {
    console.log(`${ok ? "PASS" : "FAIL"}  [${label}]  ${detail}`);
    ok ? passed++ : failed++;
  };

  if (!idempotent) run(false, "idempotent", "reindex is not idempotent");
  else run(true, "idempotent", "second reindex made no changes");

  for (const c of CASES) {
    const hits = await retrieveForTags(c.q, c.tags, { k: 5 });
    let ok: boolean;
    if (c.kind === "out") ok = hits.length === 0;
    else if (c.kind === "scope") ok = !hits.some((h) => c.deny!(h));
    else ok = top(hits).some((h) => c.want!(h));
    run(ok, c.kind, `"${c.q}" ${c.note}  →  ${summarize(hits)}`);
  }

  console.log(`\ncopilot-eval: ${passed} passed, ${failed} failed.`);
  await prisma.$disconnect();
  process.exit(failed === 0 ? 0 : 1);
}

main().catch(async (e) => {
  console.error("copilot-eval failed:", e);
  await prisma.$disconnect().catch(() => {});
  process.exit(1);
});
