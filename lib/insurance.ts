import { prisma } from "@/lib/prisma";

// Insurance module: policy registry across all lines of business, renewal
// tracking, annual cost per line (with sublines broken out), and a monthly
// payment forecast built from each policy's installment schedule.

export const INSURANCE_LINES = [
  { key: "general_liability", label: "General Liability" },
  { key: "commercial_auto", label: "Commercial Auto" },
  { key: "workers_comp", label: "Workers' Comp" },
  { key: "property", label: "Property" },
  { key: "umbrella", label: "Umbrella / Excess" },
  { key: "inland_marine", label: "Inland Marine" },
  { key: "professional_eo", label: "Professional / E&O" },
  { key: "management_liability", label: "Management Liability" },
  { key: "directors_officers", label: "Directors & Officers" },
  { key: "epli", label: "Employment Practices (EPLI)" },
  { key: "cyber", label: "Cyber" },
  { key: "pollution", label: "Pollution / Environmental" },
  { key: "other", label: "Other" },
] as const;

export function lineLabel(key: string | null): string {
  return INSURANCE_LINES.find((l) => l.key === key)?.label ?? "Other";
}

/** Best-guess line from free text (carrier / title / filename). */
export function inferLine(text: string): string {
  const t = (text || "").toLowerCase();
  if (/(general liability|\bgl\b|premises)/.test(t)) return "general_liability";
  if (/(auto|vehicle|fleet|progressive|garage)/.test(t)) return "commercial_auto";
  if (/(workers.?comp|\bwc\b|comp\b)/.test(t)) return "workers_comp";
  if (/(property|building|bpp|business personal)/.test(t)) return "property";
  if (/(umbrella|excess)/.test(t)) return "umbrella";
  if (/(inland marine|equipment|tools|\bim\b)/.test(t)) return "inland_marine";
  if (/(professional|e&o|errors)/.test(t)) return "professional_eo";
  if (/(management liability|multi.?coverage|fiduciary|crime|kidnap)/.test(t)) return "management_liability";
  if (/(directors|officers|d&o)/.test(t)) return "directors_officers";
  if (/(employment practices|epli)/.test(t)) return "epli";
  if (/(cyber|data breach|privacy)/.test(t)) return "cyber";
  if (/(pollution|environmental)/.test(t)) return "pollution";
  return "other";
}

export const PAYMENT_FREQUENCIES = [
  { key: "annual", label: "Annual (one payment)" },
  { key: "semiannual", label: "Semi-annual" },
  { key: "quarterly", label: "Quarterly" },
  { key: "monthly", label: "Monthly" },
  { key: "financed", label: "Financed (premium finance)" },
] as const;

// ---- AI reader -------------------------------------------------------------

export type Coverage = { name: string; limit?: string; deductible?: string; premium?: number };
export type ScheduleItem = { dueDate: string; amount: number; label?: string };

export type InsuranceAnalysis = {
  line: string;
  name: string;
  carrier: string | null;
  policyNumber: string | null;
  agent: string | null;
  effectiveDate: string | null;
  expirationDate: string | null;
  annualPremium: number | null;
  coverages: Coverage[];
  paymentMethod: string;
  paymentFrequency: string;
  downPayment: number | null;
  numberOfPayments: number | null;
  paymentAmount: number | null;
  apr: number | null;
  financeCompany: string | null;
  schedule: ScheduleItem[];
  summary: string;
  source: "claude" | "mock";
};

export function insuranceReaderMode(): "claude" | "mock" {
  return process.env.ANTHROPIC_API_KEY ? "claude" : "mock";
}

const EXTRACT_PROMPT = `You are filing an insurance policy for a Florida pest-control company. Read the document (a policy declarations page, ACORD application, or premium-finance schedule) and return ONLY JSON with this exact shape:

{
  "line": "general_liability|commercial_auto|workers_comp|property|umbrella|inland_marine|professional_eo|management_liability|directors_officers|epli|cyber|pollution|other",
  "name": string,                  // short descriptor, e.g. "Fleet Auto — Auto-Owners"
  "carrier": string | null,        // insurer, e.g. "Auto-Owners Insurance Company"
  "policy_number": string | null,
  "agent": string | null,          // broker / agency
  "effective_date": string | null, // ISO yyyy-mm-dd
  "expiration_date": string | null,// ISO yyyy-mm-dd (renewal)
  "annual_premium": number | null, // total annual premium in dollars
  "coverages": [ { "name": string, "limit": string | null, "deductible": string | null, "premium": number | null } ],
  "payment_method": "direct|financed|agency_bill",
  "payment_frequency": "annual|semiannual|quarterly|monthly|financed",
  "down_payment": number | null,
  "number_of_payments": number | null,
  "payment_amount": number | null, // per-installment amount
  "apr": number | null,
  "finance_company": string | null,
  "schedule": [ { "due_date": "yyyy-mm-dd", "amount": number, "label": string | null } ],
  "summary": string                // 1-2 sentences for a manager to confirm
}
Return every field; use null / [] when unknown. Output JSON only.`;

type Block =
  | { type: "text"; text: string }
  | { type: "image"; source: { type: "base64"; media_type: string; data: string } }
  | { type: "document"; source: { type: "base64"; media_type: "application/pdf"; data: string } };

const num = (v: unknown): number | null => {
  if (v == null) return null;
  const n = Number(String(v).replace(/[$,]/g, ""));
  return Number.isFinite(n) ? n : null;
};
const str = (v: unknown): string | null => {
  const t = typeof v === "string" ? v.trim() : v == null ? "" : String(v);
  return t === "" || t === "null" ? null : t;
};
function extractJson(text: string): Record<string, unknown> {
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) return {};
  try { return JSON.parse(m[0]); } catch { return {}; }
}

async function claudeAnalyze(base64: string, mime: string): Promise<InsuranceAnalysis> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY not set");
  const model = process.env.ANTHROPIC_MODEL || "claude-3-5-sonnet-latest";
  const fileBlock: Block =
    mime === "application/pdf"
      ? { type: "document", source: { type: "base64", media_type: "application/pdf", data: base64 } }
      : { type: "image", source: { type: "base64", media_type: mime, data: base64 } };
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({ model, max_tokens: 2000, messages: [{ role: "user", content: [fileBlock, { type: "text", text: EXTRACT_PROMPT }] }] }),
  });
  if (!res.ok) throw new Error(`Anthropic API error ${res.status}: ${await res.text()}`);
  const data = (await res.json()) as { content?: { type: string; text?: string }[] };
  const raw = extractJson(data.content?.map((c) => c.text ?? "").join("") ?? "");
  const line = String(raw.line ?? "").toLowerCase();
  const coverages = Array.isArray(raw.coverages) ? (raw.coverages as Record<string, unknown>[]).map((c) => ({ name: String(c.name ?? "").trim(), limit: str(c.limit) ?? undefined, deductible: str(c.deductible) ?? undefined, premium: num(c.premium) ?? undefined })).filter((c) => c.name) : [];
  const schedule = Array.isArray(raw.schedule) ? (raw.schedule as Record<string, unknown>[]).map((s) => ({ dueDate: str(s.due_date) ?? "", amount: num(s.amount) ?? 0, label: str(s.label) ?? undefined })).filter((s) => s.dueDate && s.amount) : [];
  return {
    line: INSURANCE_LINES.some((l) => l.key === line) ? line : inferLine(`${raw.name ?? ""} ${raw.carrier ?? ""}`),
    name: String(raw.name ?? "Policy").trim() || "Policy",
    carrier: str(raw.carrier),
    policyNumber: str(raw.policy_number),
    agent: str(raw.agent),
    effectiveDate: str(raw.effective_date),
    expirationDate: str(raw.expiration_date),
    annualPremium: num(raw.annual_premium),
    coverages,
    paymentMethod: String(raw.payment_method ?? "direct"),
    paymentFrequency: String(raw.payment_frequency ?? "annual"),
    downPayment: num(raw.down_payment),
    numberOfPayments: num(raw.number_of_payments),
    paymentAmount: num(raw.payment_amount),
    apr: num(raw.apr),
    financeCompany: str(raw.finance_company),
    schedule,
    summary: String(raw.summary ?? "").trim(),
    source: "claude",
  };
}

function mockAnalyze(fileName: string): InsuranceAnalysis {
  return {
    line: inferLine(fileName),
    name: fileName.replace(/\.[a-z0-9]+$/i, "").replace(/[_-]+/g, " ").slice(0, 60) || "Policy",
    carrier: null, policyNumber: null, agent: null, effectiveDate: null, expirationDate: null,
    annualPremium: null, coverages: [], paymentMethod: "direct", paymentFrequency: "annual",
    downPayment: null, numberOfPayments: null, paymentAmount: null, apr: null, financeCompany: null, schedule: [],
    summary: "Reader not configured — set ANTHROPIC_API_KEY for automatic reading. Please confirm the line and enter the policy details.",
    source: "mock",
  };
}

export async function analyzeInsurance(base64: string, mime: string, fileName: string): Promise<InsuranceAnalysis> {
  if (!process.env.ANTHROPIC_API_KEY) return mockAnalyze(fileName);
  return claudeAnalyze(base64, mime);
}

// ---- Installment generation ------------------------------------------------

type PolicyLike = {
  effectiveDate: Date | null;
  annualPremium: number | null;
  paymentFrequency: string;
  downPayment: number | null;
  numberOfPayments: number | null;
  paymentAmount: number | null;
};

/**
 * Build a payment schedule for the monthly forecast. Uses an explicit finance
 * schedule when present; a financed policy expands to down payment + N monthly
 * installments; otherwise the premium is spread across the term by frequency.
 * For periodic (non-financed) policies we lay down TWO consecutive terms from
 * the effective date so the next 12 months always include the upcoming
 * renewal's payment, wherever "now" falls in the current term.
 */
export function generateInstallments(p: PolicyLike, explicit: ScheduleItem[] = []): { dueDate: Date; amount: number; label: string | null }[] {
  if (explicit.length > 0) {
    return explicit.map((s) => ({ dueDate: new Date(`${s.dueDate}T00:00:00Z`), amount: s.amount, label: s.label ?? null }));
  }
  const start = p.effectiveDate ?? null;
  const out: { dueDate: Date; amount: number; label: string | null }[] = [];
  const add = (monthsOffset: number, amount: number, label: string | null) => {
    if (!start) return;
    const d = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + monthsOffset, start.getUTCDate()));
    out.push({ dueDate: d, amount, label });
  };
  if (p.paymentFrequency === "financed" && p.numberOfPayments && p.paymentAmount) {
    if (p.downPayment) add(0, p.downPayment, "Down payment");
    for (let i = 0; i < p.numberOfPayments; i++) add(i + 1, p.paymentAmount, `Installment ${i + 1}/${p.numberOfPayments}`);
    return out;
  }
  if (!start || !p.annualPremium) return [];
  const counts: Record<string, number> = { annual: 1, semiannual: 2, quarterly: 4, monthly: 12 };
  const n = counts[p.paymentFrequency] ?? 1;
  const step = 12 / n;
  const each = p.annualPremium / n;
  // Two terms so the forecast window always catches the renewal payment.
  for (let cycle = 0; cycle < 2; cycle++) {
    for (let i = 0; i < n; i++) {
      const label = n === 1 ? (cycle === 0 ? "Annual premium" : "Renewal premium") : `Payment ${i + 1}/${n}${cycle === 1 ? " (renewal)" : ""}`;
      add(Math.round(cycle * 12 + i * step), each, label);
    }
  }
  return out;
}

// ---- Queries ---------------------------------------------------------------

export async function listPoliciesByLine() {
  const policies = await prisma.insurancePolicy.findMany({
    where: { status: { not: "cancelled" } },
    include: { documents: true, installments: true },
    orderBy: [{ line: "asc" }, { effectiveDate: "desc" }],
  });
  const groups = INSURANCE_LINES.map((l) => ({
    key: l.key as string,
    label: l.label,
    policies: policies.filter((p) => p.line === l.key),
  })).filter((g) => g.policies.length > 0);
  return groups;
}

export type LineCost = { key: string; label: string; total: number; policies: { id: string; name: string; carrier: string | null; premium: number | null; status: string; needsReview: boolean }[] };

/** Annual cost per line, with each policy (subline) broken out. */
export async function annualCostByLine(): Promise<{ lines: LineCost[]; grandTotal: number }> {
  const policies = await prisma.insurancePolicy.findMany({
    where: { status: { in: ["active", "pending"] } },
    select: { id: true, line: true, name: true, carrier: true, annualPremium: true, status: true, needsReview: true },
    orderBy: { annualPremium: "desc" },
  });
  const lines: LineCost[] = INSURANCE_LINES.map((l) => {
    const inLine = policies.filter((p) => p.line === l.key);
    return {
      key: l.key as string,
      label: l.label,
      total: inLine.reduce((s, p) => s + (p.annualPremium ?? 0), 0),
      policies: inLine.map((p) => ({ id: p.id, name: p.name, carrier: p.carrier, premium: p.annualPremium, status: p.status, needsReview: p.needsReview })),
    };
  }).filter((l) => l.policies.length > 0)
    .sort((a, b) => b.total - a.total);
  return { lines, grandTotal: lines.reduce((s, l) => s + l.total, 0) };
}

export async function upcomingRenewals(days = 90) {
  const now = new Date();
  const horizon = new Date(now.getTime() + days * 864e5);
  const rows = await prisma.insurancePolicy.findMany({
    where: { status: { in: ["active", "pending", "application"] }, expirationDate: { not: null } },
    orderBy: { expirationDate: "asc" },
  });
  return rows
    .filter((p) => p.expirationDate! <= horizon)
    .map((p) => ({ ...p, daysOut: Math.round((p.expirationDate!.getTime() - now.getTime()) / 864e5) }));
}

/** Sum installments by month over the next `months` for budget forecasting. */
export async function monthlyForecast(months = 12) {
  const now = new Date();
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + months, 1));
  const installments = await prisma.insuranceInstallment.findMany({
    where: { dueDate: { gte: start, lt: end }, policy: { status: { in: ["active", "pending"] } } },
    include: { policy: { select: { name: true, line: true } } },
    orderBy: { dueDate: "asc" },
  });
  const buckets = new Map<string, { total: number; items: { name: string; line: string; amount: number; label: string | null }[] }>();
  for (let i = 0; i < months; i++) {
    const d = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + i, 1));
    buckets.set(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`, { total: 0, items: [] });
  }
  for (const inst of installments) {
    const k = `${inst.dueDate.getUTCFullYear()}-${String(inst.dueDate.getUTCMonth() + 1).padStart(2, "0")}`;
    const b = buckets.get(k);
    if (!b) continue;
    b.total += inst.amount;
    b.items.push({ name: inst.policy.name, line: inst.policy.line, amount: inst.amount, label: inst.label });
  }
  const series = [...buckets.entries()].map(([month, b]) => ({ month, total: b.total, items: b.items }));
  return { series, total: series.reduce((s, m) => s + m.total, 0) };
}

export async function insuranceSummary() {
  const [active, renewals90, forecast] = await Promise.all([
    prisma.insurancePolicy.findMany({ where: { status: { in: ["active", "pending"] } }, select: { annualPremium: true } }),
    upcomingRenewals(90),
    monthlyForecast(1),
  ]);
  return {
    totalAnnual: active.reduce((s, p) => s + (p.annualPremium ?? 0), 0),
    activeCount: active.length,
    renewalsCount: renewals90.length,
    thisMonthDue: forecast.series[0]?.total ?? 0,
  };
}
