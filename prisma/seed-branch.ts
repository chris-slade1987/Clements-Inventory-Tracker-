import { PrismaClient } from "@prisma/client";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// Seeds branch documents — the certified pest operator licenses on file. A
// license is tied to the BRANCH it certifies and the employee who holds it
// (whose home branch may differ — Graham works out of Vero but is Orlando's
// certified operator). Source PDFs live in prisma/data/branch and are stored
// to durable storage at seed time, then served auth-gated.

const D = (s: string) => new Date(`${s}T00:00:00.000Z`);

async function storePdf(file: string): Promise<string | null> {
  let bytes: Buffer;
  try { bytes = readFileSync(join(process.cwd(), "prisma", "data", "branch", file)); } catch { return null; }
  const key = `branch-docs/${Date.now()}-${file}`;
  if (process.env.BLOB_READ_WRITE_TOKEN) {
    try {
      const { put } = await import("@vercel/blob");
      const res = await put(key, bytes, { access: "public", contentType: "application/pdf", token: process.env.BLOB_READ_WRITE_TOKEN, addRandomSuffix: false });
      return res.url;
    } catch { return null; }
  }
  try {
    const { mkdir, writeFile } = await import("node:fs/promises");
    const dir = join(process.cwd(), "public", "uploads");
    await mkdir(dir, { recursive: true });
    const stored = key.replace(/\//g, "__");
    await writeFile(join(dir, stored), bytes);
    return `/uploads/${stored}`;
  } catch { return null; }
}

type Lic = { employeeName: string; homeBranch?: string; branch: string; number?: string; categories?: string; issue?: string; expiration?: string; file?: string; notes?: string };

// The `branch` a license certifies can differ from where the holder works:
// Chris works out of Vero but certifies Naples; Graham works Vero, certifies
// Orlando. Vero is covered by Tim + Jason; Stuart by Adam.
const LICENSES: Lic[] = [
  { employeeName: "Christopher Slade", homeBranch: "vero", branch: "naples", number: "JF277259", categories: "GHP,LAWN,WDO", issue: "2026-05-08", expiration: "2027-06-01", file: "cpo-chris-slade.pdf" },
  { employeeName: "Timothy Slade", homeBranch: "vero", branch: "vero", number: "JF3528", categories: "GHP,WDO", issue: "2026-06-05", expiration: "2027-06-01", file: "cpo-tim-slade.pdf" },
  { employeeName: "Jason Colontrelle", branch: "vero", number: "JF197427", categories: "GHP,LAWN,WDO", issue: "2026-05-28", expiration: "2027-06-01", file: "cpo-jason-colontrelle.pdf" },
  { employeeName: "Graham Foster", branch: "orlando", number: "JF279724", categories: "GHP,LAWN,WDO", issue: "2026-05-20", expiration: "2027-06-01", file: "cpo-graham-foster.pdf" },
  // Stuart's certified operator — cert # known; upload the PDF for the full doc.
  { employeeName: "Adam Goetz", branch: "stuart", number: "JF264891", categories: "GHP,LAWN,WDO", notes: "Certified operator for Stuart — upload the license PDF to attach the document." },
];

// Branch-level FDACS business licenses (Ch. 482) — one per branch, separate from
// the individual certified-operator certs.
type BizLic = { branch: string; number: string; expiration: string };
const BUSINESS_LICENSES: BizLic[] = [
  { branch: "vero", number: "JB424", expiration: "2026-09-30" },
  { branch: "orlando", number: "JB348103", expiration: "2027-02-28" },
  { branch: "stuart", number: "JB345519", expiration: "2027-02-28" },
  { branch: "naples", number: "JB345509", expiration: "2026-08-31" },
];

export async function seedBranchHub(prisma: PrismaClient) {
  let created = 0;
  for (const l of LICENSES) {
    const emp = await prisma.employee.findFirst({ where: { name: l.employeeName } });
    // Some holders (Chris, Tim) have a null home branch — set it as noted.
    if (emp && l.homeBranch && !emp.branch) await prisma.employee.update({ where: { id: emp.id }, data: { branch: l.homeBranch } });

    const short = l.employeeName.replace("Christopher", "Chris").replace("Timothy", "Tim");
    const title = `CPO License — ${short}`;
    const existing = l.number
      ? await prisma.branchDocument.findFirst({ where: { branch: l.branch, licenseNumber: l.number } })
      : await prisma.branchDocument.findFirst({ where: { branch: l.branch, category: "licensing", holderName: l.employeeName } });
    const filePath = l.file ? await storePdf(l.file) : null;
    const data = {
      branch: l.branch, category: "licensing", title, employeeId: emp?.id ?? null, holderName: l.employeeName,
      licenseType: "cpo", licenseNumber: l.number ?? null, categories: l.categories ?? null,
      issueDate: l.issue ? D(l.issue) : null, expirationDate: l.expiration ? D(l.expiration) : null,
      fileName: l.file ?? null, filePath, mimeType: l.file ? "application/pdf" : null, notes: l.notes ?? null, uploadedByName: "Seed",
    };
    if (existing) await prisma.branchDocument.update({ where: { id: existing.id }, data });
    else { await prisma.branchDocument.create({ data }); created++; }
  }

  // FDACS business license per branch.
  for (const b of BUSINESS_LICENSES) {
    const data = {
      branch: b.branch, category: "licensing", title: "FDACS Business License", licenseType: "business",
      licenseNumber: b.number, expirationDate: D(b.expiration), uploadedByName: "Seed",
    };
    const existing = await prisma.branchDocument.findFirst({ where: { branch: b.branch, licenseNumber: b.number } });
    if (existing) await prisma.branchDocument.update({ where: { id: existing.id }, data });
    else { await prisma.branchDocument.create({ data }); created++; }
  }

  console.log(`Seeded branch hub: ${created} documents created (${LICENSES.length} operators + ${BUSINESS_LICENSES.length} business licenses).`);
  return { created, total: LICENSES.length + BUSINESS_LICENSES.length };
}

if (process.argv[1] && process.argv[1].includes("seed-branch")) {
  const prisma = new PrismaClient();
  seedBranchHub(prisma).catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
}
