import { prisma } from "@/lib/prisma";

// MBR (Monthly Board Report) ingestion. Upload the PDF each month → Claude reads
// it (document vision, same path as the invoice reader) → preview → commit.
// NO manager compensation is ever extracted or stored.

export const KPI_KEYS = [
  "net_revenue", "operating_income", "ebitda", "ebitda_pct", "route_contrib",
  "route_contrib_pct", "ending_cash", "production", "book_value", "new_sales",
  "attrition", "attrition_rate", "tech_wages", "fuel", "chemical_expense",
  "vehicle_rm", "sga", "net_income",
] as const;

export const SCOPES = ["company", "vero", "stuart", "orlando", "naples"] as const;
export const BASES = ["month", "ytd", "cy_forecast"] as const;

export type ParsedKpi = { key: string; scope: string; basis: string; actual: number | null; budget: number | null };
export type ParsedLob = { scope: string; lob: string; revenue: number };
export type ParsedTech = { scope: string; name: string; lob: string | null; actual: number; budget: number };
export type ParsedMbr = {
  year: number;
  month: number;
  label: string;
  kpis: ParsedKpi[];
  lob: ParsedLob[];
  techProduction: ParsedTech[];
  source: "claude" | "json";
};

const EXTRACT_PROMPT = `You are extracting KPIs from a pest-control company's Monthly Board Report (MBR) PDF for a management dashboard.

Return ONLY a JSON object (no prose, no code fences) with this exact shape:
{
  "year": number,            // e.g. 2026 (the financials year, not the meeting month)
  "month": number,           // 1-12, the month the financials cover (e.g. May financials = 5)
  "label": string,           // e.g. "May 2026"
  "kpis": [ { "key": string, "scope": string, "basis": string, "actual": number|null, "budget": number|null } ],
  "lob": [ { "scope": string, "lob": string, "revenue": number } ],
  "techProduction": [ { "scope": string, "name": string, "lob": string|null, "actual": number, "budget": number } ]
}

Allowed kpi keys (use ONLY these): ${KPI_KEYS.join(", ")}.
Allowed scope values: company, vero, stuart, orlando, naples (map "Vero Beach"->vero, "Stuart/PB"->stuart, "Orlando"->orlando, "Naples"->naples).
Allowed basis values: month (the reporting month), ytd (year-to-date), cy_forecast (full calendar-year forecast).

Rules:
- Percentages as plain numbers (9.7 for 9.7%, not 0.097). Dollars as plain numbers (562499, no $ or commas).
- Provide company-scope month values for every KPI you can find; add ytd where the report shows a YTD column.
- Provide per-branch values where the report breaks them out (production, route_contrib, route_contrib_pct, new_sales, attrition).
- "lob" = revenue by line of business (Pest, Fertilizer, L&O, Termite, Rat, Ant, Mosquito, Other) per scope. Combine small categories (Bat, Bee, Wildlife, Unknown) into "Other".
- "techProduction" = per-technician production Actual vs Budget for the month, with branch scope and line (PC/LO/Service). Use first names/labels as shown.
- CRITICAL: NEVER include manager compensation, manager wages, or any per-manager pay. Do not output a "manager_wages" or "total_comp" KPI. Technician PRODUCTION (revenue) is fine; compensation is not.
- Omit anything you cannot find rather than guessing.`;

export async function claudeExtractMbr(base64: string, mime: string): Promise<ParsedMbr> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY not set");
  const model = process.env.ANTHROPIC_MODEL || "claude-opus-4-8";

  const fileBlock =
    mime === "application/pdf"
      ? { type: "document", source: { type: "base64", media_type: "application/pdf", data: base64 } }
      : { type: "image", source: { type: "base64", media_type: mime, data: base64 } };

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({
      model,
      max_tokens: 8000,
      messages: [{ role: "user", content: [fileBlock, { type: "text", text: EXTRACT_PROMPT }] }],
    }),
  });
  if (!res.ok) throw new Error(`Anthropic API error ${res.status}: ${await res.text()}`);
  const data = (await res.json()) as { content?: { text?: string }[] };
  const text = data.content?.map((c) => c.text ?? "").join("") ?? "";
  return normalize(extractJson(text), "claude");
}

function extractJson(text: string): Record<string, unknown> {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = fenced ? fenced[1] : text;
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start === -1 || end === -1) throw new Error("No JSON found in response");
  return JSON.parse(candidate.slice(start, end + 1));
}

function num(v: unknown): number | null {
  if (v == null) return null;
  const n = typeof v === "string" ? parseFloat(v.replace(/[^0-9.\-]/g, "")) : (v as number);
  return typeof n === "number" && Number.isFinite(n) ? n : null;
}

const MANAGER_COMP = /manager.*(wage|comp|pay|salary)|total_comp/i;

export function normalize(raw: Record<string, unknown>, source: "claude" | "json"): ParsedMbr {
  const year = num(raw.year);
  const month = num(raw.month);
  if (!year || !month || month < 1 || month > 12) throw new Error("Missing/invalid year or month");
  const keySet = new Set<string>(KPI_KEYS);
  const scopeSet = new Set<string>(SCOPES);
  const basisSet = new Set<string>(BASES);

  const kpis: ParsedKpi[] = (Array.isArray(raw.kpis) ? raw.kpis : [])
    .map((r) => r as Record<string, unknown>)
    .map((r) => ({
      key: String(r.key ?? ""),
      scope: String(r.scope ?? "company"),
      basis: String(r.basis ?? "month"),
      actual: num(r.actual),
      budget: num(r.budget),
    }))
    // Enforce allowlist + strip any manager-comp leakage.
    .filter((r) => keySet.has(r.key) && scopeSet.has(r.scope) && basisSet.has(r.basis) && !MANAGER_COMP.test(r.key))
    .filter((r) => r.actual != null || r.budget != null);

  const lob: ParsedLob[] = (Array.isArray(raw.lob) ? raw.lob : [])
    .map((r) => r as Record<string, unknown>)
    .map((r) => ({ scope: String(r.scope ?? "company"), lob: String(r.lob ?? ""), revenue: num(r.revenue) ?? 0 }))
    .filter((r) => scopeSet.has(r.scope) && r.lob && r.revenue > 0);

  const techProduction: ParsedTech[] = (Array.isArray(raw.techProduction) ? raw.techProduction : [])
    .map((r) => r as Record<string, unknown>)
    .map((r) => ({
      scope: String(r.scope ?? ""),
      name: String(r.name ?? "").trim(),
      lob: r.lob != null ? String(r.lob) : null,
      actual: num(r.actual) ?? 0,
      budget: num(r.budget) ?? 0,
    }))
    .filter((r) => scopeSet.has(r.scope) && r.scope !== "company" && r.name);

  return {
    year, month,
    label: raw.label ? String(raw.label) : `${month}/${year}`,
    kpis, lob, techProduction, source,
  };
}

/** Write a parsed MBR into the DB, replacing any existing data for that month. */
export async function commitMbr(p: ParsedMbr): Promise<{ periodId: string; kpis: number; lob: number; techs: number }> {
  const period = await prisma.reportPeriod.upsert({
    where: { year_month: { year: p.year, month: p.month } },
    create: { year: p.year, month: p.month, label: p.label },
    update: { label: p.label },
  });
  // Replace this month's data so re-uploading corrects rather than duplicates.
  await prisma.kpiValue.deleteMany({ where: { periodId: period.id } });
  await prisma.lobRevenue.deleteMany({ where: { periodId: period.id } });
  await prisma.techProduction.deleteMany({ where: { periodId: period.id } });

  for (const k of p.kpis) {
    await prisma.kpiValue.create({
      data: { periodId: period.id, kpiKey: k.key, scope: k.scope, basis: k.basis, actual: k.actual, budget: k.budget },
    });
  }
  for (const l of p.lob) {
    await prisma.lobRevenue.create({ data: { periodId: period.id, scope: l.scope, lob: l.lob, revenue: l.revenue } }).catch(() => {});
  }
  for (const t of p.techProduction) {
    await prisma.techProduction.create({
      data: { periodId: period.id, scope: t.scope, techName: t.name, lob: t.lob, actual: t.actual, budget: t.budget },
    });
  }
  return { periodId: period.id, kpis: p.kpis.length, lob: p.lob.length, techs: p.techProduction.length };
}
