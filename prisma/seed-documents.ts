import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { PrismaClient } from "@prisma/client";

// Seed the document center from the Markdown sources in prisma/data. Idempotent
// upsert by slug: refreshes title/summary/body/effective/audience/kind without
// touching acknowledgments (append-only). The version is bumped ONLY when the
// `version` declared in DOCS below is raised deliberately — the seed moves the
// stored version forward to match (never downgrades), so an ordinary content
// tweak keeps the version while a real new edition re-prompts acknowledgers.

type DocSeed = {
  slug: string;
  title: string;
  kind: string; // "handbook" | "manual"
  audience: string; // "all" | "manager"
  file: string;
  summary: string;
  effective: string;
  // The intended published version. Bumped deliberately when the content
  // change is a new *published* version (re-prompts acknowledgers). The seed
  // only ever moves the stored version FORWARD (never downgrades), and never
  // touches the append-only acknowledgments.
  version: number;
};

const DOCS: DocSeed[] = [
  {
    slug: "employee-handbook",
    title: "Employee Handbook",
    kind: "handbook",
    audience: "all",
    file: "handbook.md",
    summary: "Clements Pest Control's employee handbook — policies, benefits, and expectations. Requires a typed-signature acknowledgment.",
    effective: "Version 2 · Effective July 21, 2026",
    // v2: PTO-request submission mechanic corrected to the Clements portal
    // (was "via Paychex Flex"); policy entitlements unchanged. Employees who
    // acknowledged v1 are re-prompted to acknowledge v2.
    version: 2,
  },
  {
    slug: "manager-manual",
    title: "Manager Operating Manual",
    kind: "manual",
    audience: "manager",
    file: "manager-manual.md",
    summary: "Manager-only operating reference, reconciled against what the Clements Command & Control portal does today.",
    effective: "Version 4 · Last updated July 23, 2026",
    // v4: added the GPS / Live Fleet Tracking subsection under Company Vehicles
    // (portal Live Map + per-vehicle location/trips from Verizon Connect Reveal;
    // near-real-time, credential-gated with a sample-data fallback).
    // v3: added the Attendance / Call-Outs tracking flow to the Technician
    // Absence Policy (call-outs logged on the employee profile; >2-day illness
    // medical-note rule; physical-injury → accident-report link).
    // v2: retired the last paper-form procedures (routine vehicle/equipment
    // maintenance logs, vehicle inspection form) in favor of the Fleet
    // "Log Service" + digital inspection workflows; escalation contacts fixed.
    version: 4,
  },
];

function readDoc(file: string): string {
  return readFileSync(join(process.cwd(), "prisma", "data", file), "utf8");
}

export async function seedDocuments(prisma: PrismaClient) {
  const results: { slug: string; version: number; length: number; created: boolean }[] = [];
  for (const d of DOCS) {
    const body = readDoc(d.file);
    const existing = await prisma.policyDocument.findUnique({ where: { slug: d.slug } });
    if (!existing) {
      const created = await prisma.policyDocument.create({
        data: {
          slug: d.slug,
          title: d.title,
          kind: d.kind,
          audience: d.audience,
          version: d.version,
          summary: d.summary,
          body,
          effective: d.effective,
          published: true,
        },
      });
      results.push({ slug: d.slug, version: created.version, length: body.length, created: true });
    } else {
      // Refresh content and move the version FORWARD to the declared version
      // when it's been deliberately bumped in DOCS. Never downgrades, and never
      // touches the append-only acknowledgments (a bump simply re-prompts).
      const nextVersion = Math.max(existing.version, d.version);
      const updated = await prisma.policyDocument.update({
        where: { slug: d.slug },
        data: {
          title: d.title,
          kind: d.kind,
          audience: d.audience,
          version: nextVersion,
          summary: d.summary,
          body,
          effective: d.effective,
          published: true,
        },
      });
      results.push({ slug: d.slug, version: updated.version, length: body.length, created: false });
    }
  }
  return results;
}

// Standalone sanity run: `tsx prisma/seed-documents.ts`
if (process.argv[1] && process.argv[1].endsWith("seed-documents.ts")) {
  (async () => {
    const { PrismaClient } = await import("@prisma/client");
    const prisma = new PrismaClient();
    try {
      const beforeAcks = await prisma.documentAcknowledgment.count();
      const res = await seedDocuments(prisma);
      const afterAcks = await prisma.documentAcknowledgment.count();
      for (const r of res) {
        const toc = await prisma.policyDocument.findUnique({ where: { slug: r.slug }, select: { body: true } });
        const tocCount = (toc?.body.match(/^- \[.+\]\(#.+\)$/gm) ?? []).length;
        console.log(
          `seed-documents: ${r.slug} — v${r.version}, body ${r.length} chars, ${tocCount} TOC entries (${r.created ? "created" : "updated"}).`,
        );
      }
      console.log(`seed-documents: acknowledgments ${beforeAcks} -> ${afterAcks} ${afterAcks === beforeAcks ? "UNCHANGED" : "CHANGED!"}.`);
    } finally {
      await prisma.$disconnect();
    }
  })().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
