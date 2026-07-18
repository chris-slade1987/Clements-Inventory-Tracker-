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

// Real-estate leases (base monthly rent; priorMonthlyRent left null so scheduled
// escalations don't fire a false "rent increased" alert — that fires only when a
// manager edits the rent upward). Counsel notes capture what to watch.
type LeaseSeed = { branch: string; title: string; category?: string; landlord?: string; monthlyRent?: number; leaseStart?: string; leaseEnd?: string; file?: string; notes?: string };
const LEASES: LeaseSeed[] = [
  {
    branch: "naples", title: "Warehouse & Office Lease — 1035-6 Collier Center Way", landlord: "ForeFront Collier Venture LLC",
    monthlyRent: 4238.5, leaseStart: "2023-07-01", leaseEnd: "2028-07-01", file: "naples-lease.pdf",
    notes: "2,450 SF office+warehouse; 10% pro-rata share. Base rent shown is $4,238.50 (7/1/26–6/30/27); ALSO pay OpEx/RE-tax deposit (~$1,122.92/mo) + FL rental tax (6.5%) → all-in ~$5,600/mo. Escalates ~3%/yr to $4,365.08 (7/1/27–6/30/28). Expires 7/1/2028 — plan renewal by early 2028.",
  },
  {
    branch: "orlando", title: "Warehouse & Office Lease — 8600 Commodity Cir, Ste 159", landlord: "South Park, LLC",
    monthlyRent: 2755.15, leaseStart: "2023-11-01", leaseEnd: "2026-10-31", file: "orlando-lease.pdf",
    notes: "2,499 SF. NNN — base $13.23/SF = $2,755.15/mo PLUS CAM + RE tax + 6% FL sales tax (CAM was ~$714/mo in 2020, likely higher now). ⚠ EXPIRES 10/31/2026 — start renewal/relocation NOW. Lease terms are confidential per §2 (don't share with other tenants/brokers).",
  },
  {
    branch: "stuart", title: "Warehouse & Office Lease — 7917 SW Jack James Dr, Ste 8 (3rd Amendment)", landlord: "Ted Glasrud Associates FL, LLC",
    monthlyRent: 3575.0, leaseStart: "2019-01-23", leaseEnd: "2029-02-28", file: "stuart-lease-amend3.pdf",
    notes: "2,600 SF, Treasure Coast Commerce Center. GROSS rent $3,575/mo (3/1/26–2/28/27) INCLUDES $4.50/SF est. operating expenses — subject to year-end OpEx reconciliation per ¶6 (watch for a true-up bill). Escalates to $3,683.33 then $3,793.83/mo. Expires 2/28/2029.",
  },
];
const REFERENCE_DOCS: { branch: string; category: string; title: string; file?: string; notes?: string }[] = [
  { branch: "orlando", category: "other", title: "Original LOI — 8600 Commodity Cir (2020)", file: "orlando-loi.pdf", notes: "Reference: original letter of intent, 3-yr initial term from 11/1/2020." },
  { branch: "stuart", category: "other", title: "Original Lease — Martin Co. (1/23/2019)", file: "stuart-lease-original.pdf", notes: "Reference: original 2019 lease; operative terms are in the 3rd Amendment." },
  { branch: "naples", category: "lease", title: "Rent Payment (ACH) Info — Collier", notes: "Landlord ACH/banking details for rent. Upload the document through the site to keep bank info out of the code repo." },
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

  // Leases.
  for (const l of LEASES) {
    const filePath = l.file ? await storePdf(l.file) : null;
    const data = {
      branch: l.branch, category: l.category ?? "lease", title: l.title, landlord: l.landlord ?? null,
      monthlyRent: l.monthlyRent ?? null, rentAsOf: l.monthlyRent != null ? D("2026-07-01") : null,
      leaseStart: l.leaseStart ? D(l.leaseStart) : null, leaseEnd: l.leaseEnd ? D(l.leaseEnd) : null,
      fileName: l.file ?? null, filePath, mimeType: l.file ? "application/pdf" : null, notes: l.notes ?? null, uploadedByName: "Seed",
    };
    const existing = await prisma.branchDocument.findFirst({ where: { branch: l.branch, category: "lease", title: l.title } });
    if (existing) await prisma.branchDocument.update({ where: { id: existing.id }, data });
    else { await prisma.branchDocument.create({ data }); created++; }
  }

  // Reference / supporting docs.
  for (const r of REFERENCE_DOCS) {
    const filePath = r.file ? await storePdf(r.file) : null;
    const data = { branch: r.branch, category: r.category, title: r.title, fileName: r.file ?? null, filePath, mimeType: r.file ? "application/pdf" : null, notes: r.notes ?? null, uploadedByName: "Seed" };
    const existing = await prisma.branchDocument.findFirst({ where: { branch: r.branch, title: r.title } });
    if (existing) await prisma.branchDocument.update({ where: { id: existing.id }, data });
    else { await prisma.branchDocument.create({ data }); created++; }
  }

  console.log(`Seeded branch hub: ${created} documents created (${LICENSES.length} operators + ${BUSINESS_LICENSES.length} business licenses + ${LEASES.length} leases + ${REFERENCE_DOCS.length} refs).`);
  return { created, total: LICENSES.length + BUSINESS_LICENSES.length + LEASES.length + REFERENCE_DOCS.length };
}

if (process.argv[1] && process.argv[1].includes("seed-branch")) {
  const prisma = new PrismaClient();
  seedBranchHub(prisma).catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
}
