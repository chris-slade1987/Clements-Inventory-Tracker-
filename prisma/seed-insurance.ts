import { PrismaClient } from "@prisma/client";
import { generateInstallments, type ScheduleItem } from "../lib/insurance";

// Seeds Clements' real insurance policies (2025-26 and 2026-27 terms) extracted
// from the carrier declarations / ACORD applications / IPFS payment schedule.
// Idempotent: matched by (line, name). Installments are regenerated each run.

const D = (s: string | null) => (s ? new Date(`${s}T00:00:00.000Z`) : null);

type Seed = {
  line: string; name: string; carrier?: string; policyNumber?: string; agent?: string; status?: string;
  effectiveDate?: string; expirationDate?: string; annualPremium?: number; notes?: string;
  coverages?: { name: string; limit?: string; deductible?: string; premium?: number }[];
  paymentMethod?: string; paymentFrequency?: string; downPayment?: number; financedAmount?: number; financeCharge?: number;
  numberOfPayments?: number; paymentAmount?: number; apr?: number; financeCompany?: string; financeAccount?: string;
  needsReview?: boolean; schedule?: ScheduleItem[];
};

const POLICIES: Seed[] = [
  {
    line: "commercial_auto", name: "Fleet Commercial Auto — Auto-Owners", carrier: "Auto-Owners Insurance Company",
    policyNumber: "53-543-687-00", agent: "Brown & Brown Insurance", status: "active",
    effectiveDate: "2025-09-29", expirationDate: "2026-09-29", annualPremium: 165564.78, paymentFrequency: "annual",
    notes: "Whole-fleet commercial auto. Billing account 019176406. Source: 2526 Auto Policy.",
  },
  {
    line: "general_liability", name: "General Liability — Accelerant National", carrier: "Accelerant National Insurance Company",
    policyNumber: "N0094GL000803-00", agent: "LIPCA Inc / Brown & Brown", status: "active",
    effectiveDate: "2025-09-27", expirationDate: "2026-09-27", annualPremium: 32528.06,
    paymentMethod: "financed", paymentFrequency: "financed", downPayment: 3252.81, financedAmount: 29275.25,
    financeCharge: 1685.76, numberOfPayments: 11, paymentAmount: 2823.96, apr: 11.3,
    financeCompany: "IPFS Corporation", financeAccount: "FLS-296815",
    notes: "Pest Control Operations and/or Lawn Care. Premium $32,206 + FIGA assessment $322.06. Financed via IPFS.",
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
  },
  {
    line: "management_liability", name: "Private Company Multi-Coverage — Travelers", carrier: "Travelers Casualty and Surety Company of America",
    status: "application", needsReview: true,
    notes: "Application (2627 term) covering D&O, Employment Practices, Fiduciary, Crime, Kidnap & Ransom, and Identity Fraud. Effective date & premium TBD.",
  },
  {
    line: "directors_officers", name: "Directors & Officers — Great American", carrier: "Great American Insurance Company",
    policyNumber: "TBD", agent: "Brown & Brown (Ashley Ridenour)", status: "application",
    effectiveDate: "2026-04-13", expirationDate: "2027-04-13", annualPremium: 2450.0, paymentFrequency: "annual",
    notes: "ACORD 125 application. Bind to move from application → active.",
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
  }
  console.log(`Seeded insurance: ${created} created, ${updated} updated (${POLICIES.length} policies).`);
  return { created, updated, total: POLICIES.length };
}

if (process.argv[1] && process.argv[1].includes("seed-insurance")) {
  const prisma = new PrismaClient();
  seedInsurance(prisma).catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
}
