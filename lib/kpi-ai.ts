import "server-only";
import { cell, branchLabel, type Cell, type Scope } from "@/lib/management";

// AI KPI summary. Turns a loaded period's budget-vs-actual KPI map into a short,
// scope-aware management read-out — company-wide for admins/exec, or a single
// branch for a branch manager / the branch view. Grounded ONLY in the real
// numbers; degrades gracefully to a deterministic summary when no Anthropic key
// is set. Mirrors the sales team's "AI team briefing" (lib/sales-ai.ts).

export function hasKpiKey(): boolean {
  return !!(process.env.KPI_ANTHROPIC_API_KEY || process.env.ANTHROPIC_API_KEY);
}

const money = (n: number | null) => (n == null ? "—" : `$${Math.round(n).toLocaleString("en-US")}`);
const pct = (n: number | null) => (n == null ? "—" : `${n.toFixed(1)}%`);

async function callClaude(system: string, prompt: string, maxTokens: number): Promise<string | null> {
  const apiKey = process.env.KPI_ANTHROPIC_API_KEY || process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return null;
  const model = process.env.ANTHROPIC_MODEL || "claude-opus-4-8";
  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({ model, max_tokens: maxTokens, system, messages: [{ role: "user", content: prompt }] }),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { content?: { text?: string }[] };
    const text = data.content?.map((c) => c.text ?? "").join("").trim() ?? "";
    return text || null;
  } catch {
    return null;
  }
}

// The KPIs to read, per scope. "pct" KPIs are percentages; the rest are dollars
// unless marked count. `costLikelihood` flips the favorable sense for the
// deterministic read (a cost over budget is unfavorable).
type KpiDef = { key: string; label: string; unit: "usd" | "pct" | "count"; cost?: boolean };
const COMPANY_KPIS: KpiDef[] = [
  { key: "net_revenue", label: "Net revenue", unit: "usd" },
  { key: "production", label: "Production", unit: "usd" },
  { key: "net_after_labor", label: "Net after labor", unit: "usd" },
  { key: "margin_pct", label: "Margin %", unit: "pct" },
  { key: "new_sales", label: "New sales", unit: "usd" },
  { key: "attrition", label: "Attrition", unit: "usd", cost: true },
  { key: "tech_wages", label: "Technician wages", unit: "usd", cost: true },
  { key: "fuel", label: "Fuel", unit: "usd", cost: true },
  { key: "chemical_expense", label: "Chemical expense", unit: "usd", cost: true },
];
const BRANCH_KPIS: KpiDef[] = [
  { key: "production", label: "Production", unit: "usd" },
  { key: "net_after_labor", label: "Net after labor", unit: "usd" },
  { key: "margin_pct", label: "Margin %", unit: "pct" },
  { key: "stops", label: "Stops completed", unit: "count" },
  { key: "new_sales", label: "New sales", unit: "usd" },
  { key: "attrition", label: "Attrition", unit: "usd", cost: true },
  { key: "tech_wages", label: "Technician wages", unit: "usd", cost: true },
];

type Values = Parameters<typeof cell>[0];

function fmt(v: number | null, unit: KpiDef["unit"]): string {
  if (v == null) return "—";
  if (unit === "pct") return pct(v);
  if (unit === "count") return Math.round(v).toLocaleString("en-US");
  return money(v);
}

type Line = { def: KpiDef; c: Cell };

function collect(values: Values, scope: Scope, basis: "month" | "ytd"): Line[] {
  const defs = scope === "company" ? COMPANY_KPIS : BRANCH_KPIS;
  return defs
    .map((def) => ({ def, c: cell(values, def.key, scope, basis) }))
    .filter((l) => l.c.actual != null);
}

function factsBlock(lines: Line[], scopeLabel: string, basisLabel: string): string {
  const rows = lines.map((l) => {
    const a = fmt(l.c.actual, l.def.unit);
    const b = fmt(l.c.budget, l.def.unit);
    const v = l.c.variance;
    const vStr = v == null ? "" : ` (variance ${v >= 0 ? "+" : ""}${fmt(v, l.def.unit)}, ${l.c.favorable ? "favorable" : "unfavorable"})`;
    return `- ${l.def.label}: actual ${a} vs budget ${b}${vStr}`;
  });
  return `Scope: ${scopeLabel} · ${basisLabel}\n${rows.join("\n")}`;
}

function deterministic(lines: Line[], scopeLabel: string): string {
  if (lines.length === 0) return `No KPI data loaded for ${scopeLabel} in this period yet.`;
  const withVar = lines.filter((l) => l.c.variance != null && l.c.favorable != null);
  const favorable = withVar.filter((l) => l.c.favorable).sort((a, b) => Math.abs(b.c.variance ?? 0) - Math.abs(a.c.variance ?? 0));
  const unfavorable = withVar.filter((l) => !l.c.favorable).sort((a, b) => Math.abs(b.c.variance ?? 0) - Math.abs(a.c.variance ?? 0));
  const parts: string[] = [];
  if (favorable[0]) parts.push(`Ahead of plan on ${favorable[0].def.label.toLowerCase()} (${fmt(favorable[0].c.actual, favorable[0].def.unit)} vs ${fmt(favorable[0].c.budget, favorable[0].def.unit)}).`);
  if (unfavorable[0]) parts.push(`Watch ${unfavorable[0].def.label.toLowerCase()} — ${fmt(unfavorable[0].c.actual, unfavorable[0].def.unit)} vs a ${fmt(unfavorable[0].c.budget, unfavorable[0].def.unit)} budget.`);
  if (unfavorable[1]) parts.push(`Also behind on ${unfavorable[1].def.label.toLowerCase()}.`);
  if (parts.length === 0) return `${scopeLabel} is tracking to budget across the loaded KPIs.`;
  return parts.join(" ");
}

const SYSTEM =
  "You are the analyst for the leadership team at Clements Pest Control, a Florida pest-control company. Using ONLY the budget-vs-actual KPI figures provided, write a 3–4 sentence management read-out: lead with the headline (are we ahead of or behind plan overall), name the 1–2 biggest favorable drivers and the 1–2 biggest misses by their real numbers, and end with the single thing to watch. Plain, direct, numbers-grounded, no fluff. Never invent figures not in the data. Never mention individual employee pay or compensation.";

/**
 * A short scope-aware KPI summary. `scope` is "company" or a branch key; the
 * summary reads the matching KPI set from the loaded period's values.
 */
export async function summarizeKpis(
  values: Values,
  scope: Scope,
  basis: "month" | "ytd",
  periodLabel: string,
): Promise<{ text: string; ai: boolean }> {
  const scopeLabel = scope === "company" ? "Company (all branches)" : branchLabel(scope);
  const basisLabel = basis === "ytd" ? "Year-to-date" : periodLabel;
  const lines = collect(values, scope, basis);
  if (lines.length === 0) return { text: `No KPI data loaded for ${scopeLabel} in this period yet.`, ai: false };
  const ai = await callClaude(SYSTEM, factsBlock(lines, scopeLabel, basisLabel) + "\n\nWrite the read-out.", 450);
  return { text: ai ?? deterministic(lines, scopeLabel), ai: !!ai };
}
