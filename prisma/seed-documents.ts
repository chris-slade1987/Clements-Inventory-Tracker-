import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { PrismaClient } from "@prisma/client";

// Seed the document center from the Markdown sources in prisma/data. Idempotent
// upsert by slug: refreshes title/summary/body/effective/audience/kind without
// touching acknowledgments (append-only) and WITHOUT bumping the version — the
// version is bumped deliberately, not on every content tweak. A brand-new doc is
// created at version 1.

type DocSeed = {
  slug: string;
  title: string;
  kind: string; // "handbook" | "manual"
  audience: string; // "all" | "manager"
  file: string;
  summary: string;
  effective: string;
};

const DOCS: DocSeed[] = [
  {
    slug: "employee-handbook",
    title: "Employee Handbook",
    kind: "handbook",
    audience: "all",
    file: "handbook.md",
    summary: "Clements Pest Control's employee handbook — policies, benefits, and expectations. Requires a typed-signature acknowledgment.",
    effective: "Version 1 · Effective July 20, 2026",
  },
  {
    slug: "manager-manual",
    title: "Manager Operating Manual",
    kind: "manual",
    audience: "manager",
    file: "manager-manual.md",
    summary: "Manager-only operating reference, updated to reflect what the Clements Command & Control portal does today.",
    effective: "Version 1 · Last updated July 20, 2026",
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
          version: 1,
          summary: d.summary,
          body,
          effective: d.effective,
          published: true,
        },
      });
      results.push({ slug: d.slug, version: created.version, length: body.length, created: true });
    } else {
      // Refresh content but keep the version + acknowledgments untouched.
      const updated = await prisma.policyDocument.update({
        where: { slug: d.slug },
        data: {
          title: d.title,
          kind: d.kind,
          audience: d.audience,
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
