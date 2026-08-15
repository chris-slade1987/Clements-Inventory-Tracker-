import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth";
import { generateInstallments, INSURANCE_LINES, type ScheduleItem } from "@/lib/insurance";

export const runtime = "nodejs";
export const maxDuration = 60;

const s = (v: unknown) => { const t = typeof v === "string" ? v.trim() : ""; return t === "" ? null : t; };
const numOf = (v: unknown) => { if (v == null || v === "") return null; const n = Number(String(v).replace(/[$,]/g, "")); return Number.isFinite(n) ? n : null; };
const intOf = (v: unknown) => { const n = numOf(v); return n == null ? null : Math.round(n); };
const dateOf = (v: unknown) => { const t = s(v); if (!t) return null; const d = new Date(t.length <= 10 ? `${t}T00:00:00Z` : t); return isNaN(d.getTime()) ? null : d; };
const LINES = new Set<string>(INSURANCE_LINES.map((l) => l.key));

// Regenerate a policy's installment schedule from its terms (+ any explicit schedule).
async function rebuildInstallments(policyId: string, explicit: ScheduleItem[]) {
  const p = await prisma.insurancePolicy.findUnique({ where: { id: policyId } });
  if (!p) return;
  const rows = generateInstallments(
    { effectiveDate: p.effectiveDate, annualPremium: p.annualPremium, paymentFrequency: p.paymentFrequency, downPayment: p.downPayment, numberOfPayments: p.numberOfPayments, paymentAmount: p.paymentAmount },
    explicit,
  );
  await prisma.insuranceInstallment.deleteMany({ where: { policyId } });
  if (rows.length) await prisma.insuranceInstallment.createMany({ data: rows.map((r) => ({ policyId, dueDate: r.dueDate, amount: r.amount, label: r.label })) });
}

export async function POST(req: Request) {
  const user = await getSessionUser();
  if (!user || (user.role !== "admin" && user.role !== "manager")) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = await req.json().catch(() => null);
  const action = s(body?.action) ?? "create";

  try {
    if (action === "create" || action === "update") {
      const line = LINES.has(String(body?.line)) ? String(body?.line) : "other";
      const name = s(body?.name);
      if (!name) return NextResponse.json({ error: "Give the policy a name." }, { status: 400 });

      const coverages = Array.isArray(body?.coverages) ? JSON.stringify(body.coverages) : "[]";
      const data = {
        line,
        name,
        carrier: s(body?.carrier),
        policyNumber: s(body?.policyNumber),
        agent: s(body?.agent),
        status: s(body?.status) ?? "active",
        effectiveDate: dateOf(body?.effectiveDate),
        expirationDate: dateOf(body?.expirationDate),
        annualPremium: numOf(body?.annualPremium),
        notes: s(body?.notes),
        coverages,
        paymentMethod: s(body?.paymentMethod) ?? "direct",
        paymentFrequency: s(body?.paymentFrequency) ?? "annual",
        downPayment: numOf(body?.downPayment),
        financedAmount: numOf(body?.financedAmount),
        financeCharge: numOf(body?.financeCharge),
        numberOfPayments: intOf(body?.numberOfPayments),
        paymentAmount: numOf(body?.paymentAmount),
        apr: numOf(body?.apr),
        financeCompany: s(body?.financeCompany),
        financeAccount: s(body?.financeAccount),
        needsReview: !!body?.needsReview,
      };

      const explicit: ScheduleItem[] = Array.isArray(body?.schedule)
        ? (body.schedule as Record<string, unknown>[]).map((x) => ({ dueDate: s(x.dueDate) ?? "", amount: numOf(x.amount) ?? 0, label: s(x.label) ?? undefined })).filter((x) => x.dueDate && x.amount)
        : [];

      let policyId: string;
      if (action === "update") {
        const id = s(body?.id);
        if (!id) return NextResponse.json({ error: "Missing policy." }, { status: 400 });
        await prisma.insurancePolicy.update({ where: { id }, data });
        policyId = id;
      } else {
        const created = await prisma.insurancePolicy.create({ data: { ...data, aiSummary: s(body?.aiSummary), createdByUserId: user.id, createdByName: user.name } });
        policyId = created.id;
        const docId = s(body?.documentId);
        if (docId) await prisma.insuranceDocument.update({ where: { id: docId }, data: { policyId } }).catch(() => {});
      }

      await rebuildInstallments(policyId, explicit);
      return NextResponse.json({ ok: true, id: policyId });
    }

    const id = s(body?.id);
    if (!id) return NextResponse.json({ error: "Missing policy." }, { status: 400 });

    if (action === "delete") {
      await prisma.insurancePolicy.delete({ where: { id } });
      return NextResponse.json({ ok: true });
    }
    if (action === "status") {
      await prisma.insurancePolicy.update({ where: { id }, data: { status: s(body?.status) ?? "active" } });
      return NextResponse.json({ ok: true });
    }
    return NextResponse.json({ error: "Unknown action." }, { status: 400 });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
