import { PrismaClient } from "@prisma/client";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { generateInstallments, type ScheduleItem } from "../lib/insurance";

// Seeds Clements' real insurance policies (2025-26 and 2026-27 terms) extracted
// from the carrier declarations / ACORD applications / IPFS payment schedule.
// The source PDFs live in prisma/data/insurance and are stored to durable
// storage (Vercel Blob in prod) at seed time, then served auth-gated.
// Idempotent: matched by (line, name). Installments/documents regenerated.

const D = (s: string | null) => (s ? new Date(`${s}T00:00:00.000Z`) : null);

/** Store a committed insurance PDF and return the URL/path to save. */
async function storePdf(file: string): Promise<string | null> {
  let bytes: Buffer;
  try { bytes = readFileSync(join(process.cwd(), "prisma", "data", "insurance", file)); } catch { return null; }
  const key = `insurance-docs/${Date.now()}-${file}`;
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

type Seed = {
  line: string; name: string; carrier?: string; policyNumber?: string; agent?: string; status?: string;
  effectiveDate?: string; expirationDate?: string; annualPremium?: number; notes?: string;
  coverages?: { name: string; limit?: string; deductible?: string; premium?: number }[];
  paymentMethod?: string; paymentFrequency?: string; downPayment?: number; financedAmount?: number; financeCharge?: number;
  numberOfPayments?: number; paymentAmount?: number; apr?: number; financeCompany?: string; financeAccount?: string;
  needsReview?: boolean; schedule?: ScheduleItem[];
  docs?: { file: string; title: string; category: string }[];
};

const POLICIES: Seed[] = [
  {
    line: "commercial_auto", name: "Fleet Commercial Auto — Auto-Owners", carrier: "Auto-Owners Insurance Company",
    policyNumber: "53-543-687-00", agent: "Brown & Brown Insurance", status: "active",
    effectiveDate: "2025-09-29", expirationDate: "2026-09-29", annualPremium: 165564.78, paymentFrequency: "annual",
    notes: "Whole-fleet commercial auto. Billing account 019176406. Source: 2526 Auto Policy.",
    docs: [{ file: "auto-owners-2526.pdf", title: "Auto-Owners Auto Policy (2025-26)", category: "policy" }],
  },
  {
    line: "general_liability", name: "General Liability — Accelerant National", carrier: "Accelerant National Insurance Company",
    policyNumber: "N0094GL000803-00", agent: "LIPCA Inc / Brown & Brown", status: "active",
    effectiveDate: "2025-09-27", expirationDate: "2026-09-27", annualPremium: 32528.06,
    paymentMethod: "financed", paymentFrequency: "financed", downPayment: 3252.81, financedAmount: 29275.25,
    financeCharge: 1685.76, numberOfPayments: 11, paymentAmount: 2823.96, apr: 11.3,
    financeCompany: "IPFS Corporation", financeAccount: "FLS-296815",
    notes: "Pest Control Operations and/or Lawn Care. Premium $32,206 + FIGA assessment $322.06. Financed via IPFS.",
    docs: [
      { file: "gl-accelerant-2526.pdf", title: "General Liability Policy (2025-26)", category: "policy" },
      { file: "gl-payment-schedule.pdf", title: "IPFS Payment Schedule", category: "payment_schedule" },
    ],
    // IPFS acceptance 09/30/25: down payment then 11 monthly installments.
    schedule: [
      { dueDate: "2025-09-30", amount: 3252.81, label: "Down payment" },
      ...Array.from({ length: 11 }, (_, i) => {
        const m = 10 + i; const year = 2025 + Math.floor(m / 12); const month = (m % 12) + 1;
        return { dueDate: `${year}-${String(month).padStart(2, "0")}-30`, amount: 2823.96, label: `Installment ${i + 1}/11` };
      }),
    ],
  },
  {
    line: "inland_marine", name: "Inland Marine (Equipment / Tools)", status: "active",
    effectiveDate: "2025-09-27", expirationDate: "2026-09-27", needsReview: true,
    notes: "Source PDF is image-based — upload it through the reader (with an API key) or enter the carrier & premium. 2526 term.",
    docs: [{ file: "inland-marine-2526.pdf", title: "Inland Marine Policy (2025-26)", category: "policy" }],
  },
  {
    line: "management_liability", name: "Private Company Multi-Coverage — Travelers", carrier: "Travelers Casualty and Surety Company of America",
    status: "application", needsReview: true,
    notes: "Application (2627 term) covering D&O, Employment Practices, Fiduciary, Crime, Kidnap & Ransom, and Identity Fraud. Effective date & premium TBD.",
    docs: [{ file: "travelers-mgmt-liability-app.pdf", title: "Travelers Private-Co Multi-Coverage Application", category: "policy" }],
  },
  {
    line: "directors_officers", name: "Directors & Officers — Great American", carrier: "Great American Insurance Company",
    policyNumber: "TBD", agent: "Brown & Brown (Ashley Ridenour)", status: "application",
    effectiveDate: "2026-04-13", expirationDate: "2027-04-13", annualPremium: 2450.0, paymentFrequency: "annual",
    notes: "ACORD 125 application. Bind to move from application → active.",
    docs: [{ file: "great-american-do-acord125.pdf", title: "Great American D&O — ACORD 125", category: "policy" }],
  },
  {
    line: "commercial_auto", name: "Commercial Auto — Progressive (2018 Isuzu NPR)", carrier: "Progressive Express Ins Company",
    policyNumber: "876585273", agent: "Brown & Brown", status: "active",
    effectiveDate: "2026-07-06", expirationDate: "2027-07-06", annualPremium: 7279.0, paymentFrequency: "annual",
    coverages: [
      { name: "Bodily Injury & Property Damage Liability", limit: "$1,000,000 CSL", premium: 6583 },
      { name: "Personal Injury Protection (PIP)", premium: 116 },
      { name: "Medical Payments", premium: 32 },
      { name: "Comprehensive", deductible: "$1,000", premium: 196 },
      { name: "Collision", deductible: "$1,000", premium: 352 },
    ],
    notes: "Single unit: 2018 Isuzu NPR HD, VIN 54DC4W1B6JS809217. Blanket Additional Insured & Waiver of Subrogation apply.",
    docs: [{ file: "progressive-auto-2627.pdf", title: "Progressive Commercial Auto (2026-27)", category: "policy" }],
  },
];

export async function seedInsurance(prisma: PrismaClient) {
  let created = 0, updated = 0;
  for (const s of POLICIES) {
    const data = {
      line: s.line, name: s.name, carrier: s.carrier ?? null, policyNumber: s.policyNumber ?? null, agent: s.agent ?? null,
      status: s.status ?? "active", effectiveDate: D(s.effectiveDate ?? null), expirationDate: D(s.expirationDate ?? null),
      annualPremium: s.annualPremium ?? null, notes: s.notes ?? null, coverages: JSON.stringify(s.coverages ?? []),
      paymentMethod: s.paymentMethod ?? "direct", paymentFrequency: s.paymentFrequency ?? "annual",
      downPayment: s.downPayment ?? null, financedAmount: s.financedAmount ?? null, financeCharge: s.financeCharge ?? null,
      numberOfPayments: s.numberOfPayments ?? null, paymentAmount: s.paymentAmount ?? null, apr: s.apr ?? null,
      financeCompany: s.financeCompany ?? null, financeAccount: s.financeAccount ?? null, needsReview: !!s.needsReview,
    };
    const existing = await prisma.insurancePolicy.findFirst({ where: { line: s.line, name: s.name } });
    const policy = existing
      ? (updated++, await prisma.insurancePolicy.update({ where: { id: existing.id }, data }))
      : (created++, await prisma.insurancePolicy.create({ data }));

    const rows = generateInstallments(
      { effectiveDate: policy.effectiveDate, annualPremium: policy.annualPremium, paymentFrequency: policy.paymentFrequency, downPayment: policy.downPayment, numberOfPayments: policy.numberOfPayments, paymentAmount: policy.paymentAmount },
      s.schedule ?? [],
    );
    await prisma.insuranceInstallment.deleteMany({ where: { policyId: policy.id } });
    if (rows.length) await prisma.insuranceInstallment.createMany({ data: rows.map((r) => ({ policyId: policy.id, dueDate: r.dueDate, amount: r.amount, label: r.label })) });

    // Attach source PDFs (stored to durable storage).
    await prisma.insuranceDocument.deleteMany({ where: { policyId: policy.id } });
    for (const d of s.docs ?? []) {
      const filePath = await storePdf(d.file);
      await prisma.insuranceDocument.create({ data: { policyId: policy.id, title: d.title, fileName: d.file, filePath, category: d.category, mimeType: "application/pdf" } });
    }
  }
  console.log(`Seeded insurance: ${created} created, ${updated} updated (${POLICIES.length} policies).`);
  return { created, updated, total: POLICIES.length };
}

if (process.argv[1] && process.argv[1].includes("seed-insurance")) {
  const prisma = new PrismaClient();
  seedInsurance(prisma).catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
}
