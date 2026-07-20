import "server-only";
import {
  BRANCHES,
  branchLabel,
  cell,
  kpiCatalog,
  listPeriods,
  lobRevenue,
  periodValues,
  type Cell,
  type KpiMeta,
} from "@/lib/management";

// Data context for the Insights assistant (conversational, grounded board Q&A).
// Assembles a compact, structured snapshot of the STORED management data so the
// model reasons over real numbers instead of guessing. Server-only.
//
// GUARDRAIL: manager/individual compensation is never stored and is never
// synthesized here — the snapshot only carries what the MBR ingestion keeps
// (company + branch KPIs, LOB revenue). Keep it that way.

/** True when an Anthropic key is available to power the assistant. */
export function hasInsightsKey(): boolean {
  return !!(process.env.INSIGHTS_ANTHROPIC_API_KEY || process.env.ANTHROPIC_API_KEY);
}

// How many months of history to include, and which KPIs to surface where.
const MAX_MONTHS = 8;
const DETAIL_MONTHS = 3; // full month + YTD detail for the most recent N months
const BRANCH_MONTHS = 2; // per-branch breakout for the most recent N months

// Company P&L / headline KPIs, in reading order, shown month + YTD.
const COMPANY_KPIS = [
  "net_revenue",
  "route_contrib",
  "route_contrib_pct",
  "sga",
  "operating_income",
  "ebitda",
  "ebitda_pct",
  "net_income",
  "tech_wages",
  "fuel",
  "chemical_expense",
  "vehicle_rm",
  "new_sales",
  "attrition",
  "attrition_rate",
  "production",
  "book_value",
  "ending_cash",
];

// KPIs the MBR breaks out per branch.
const BRANCH_KPIS = ["production", "route_contrib", "route_contrib_pct", "new_sales", "attrition", "attrition_rate"];

function fmtValue(v: number | null | undefined, unit: string): string {
  if (v == null) return "n/a";
  if (unit === "pct") return `${v.toFixed(1)}%`;
  if (unit === "pts") return `${v.toFixed(1)} pts`;
  if (unit === "count") return `${v.toLocaleString("en-US")}`;
  // usd (default)
  return `$${Math.round(v).toLocaleString("en-US")}`;
}

/** One "Actual X vs Budget Y (Δ favorable/unfavorable)" line for a KPI cell. */
function line(meta: KpiMeta | undefined, key: string, c: Cell): string | null {
  if (c.actual == null && c.budget == null) return null;
  const unit = meta?.unit ?? "usd";
  const label = meta?.label ?? key;
  let s = `- ${label}: actual ${fmtValue(c.actual, unit)}`;
  if (c.budget != null) s += `, budget ${fmtValue(c.budget, unit)}`;
  if (c.variance != null) {
    const sign = c.variance >= 0 ? "+" : "";
    const dir = c.favorable == null ? "" : c.favorable ? ", favorable" : ", UNFAVORABLE";
    s += `, variance ${sign}${fmtValue(c.variance, unit)}${dir}`;
  }
  return s;
}

/**
 * Build the DATA SNAPSHOT text block the model reasons over. Returns a friendly
 * "no data" note if nothing has been ingested yet.
 */
export async function buildInsightsContext(): Promise<string> {
  const [periods, cat] = await Promise.all([listPeriods(), kpiCatalog()]);
  if (periods.length === 0) {
    return "DATA SNAPSHOT: No Monthly Board Report data has been ingested yet. There are no figures to analyze.";
  }

  const recent = periods.slice(0, MAX_MONTHS); // newest first
  const latest = recent[0];

  // Load every period's KPI values once.
  const valuesByPeriod = new Map<string, Map<string, Cell>>();
  await Promise.all(
    recent.map(async (p) => {
      valuesByPeriod.set(p.id, await periodValues(p.id));
    })
  );

  const higherIsBetter = COMPANY_KPIS.map((k) => {
    const m = cat.get(k);
    return m ? `${m.label} (${m.higherIsBetter ? "higher is better" : "lower is better"})` : null;
  })
    .filter(Boolean)
    .join("; ");

  const out: string[] = [];
  out.push("DATA SNAPSHOT — Clements Pest Control management figures (from the Monthly Board Report).");
  out.push(
    "All figures are stored actuals vs budget. Variance is actual − budget; direction is flagged favorable/unfavorable per KPI. USD rounded to the dollar; percentages as stored (9.7 = 9.7%)."
  );
  out.push(`KPI direction reference: ${higherIsBetter}.`);
  out.push(`Periods available (newest first): ${periods.map((p) => p.label).join(", ")}.`);
  out.push("");

  // ---- Company-scope detail for the most recent months (month + YTD) --------
  recent.slice(0, DETAIL_MONTHS).forEach((p, idx) => {
    const values = valuesByPeriod.get(p.id)!;

    const monthLines = COMPANY_KPIS.map((k) => line(cat.get(k), k, cell(values, k, "company", "month"))).filter(
      Boolean
    ) as string[];
    if (monthLines.length) {
      out.push(`=== ${p.label} — Company (month) ===`);
      out.push(...monthLines);
      out.push("");
    }

    const ytdLines = COMPANY_KPIS.map((k) => line(cat.get(k), k, cell(values, k, "company", "ytd"))).filter(
      Boolean
    ) as string[];
    if (ytdLines.length) {
      out.push(`=== ${p.label} — Company (year-to-date) ===`);
      out.push(...ytdLines);
      out.push("");
    }

    // Full-year forecast, latest period only.
    if (idx === 0) {
      const fc: string[] = [];
      for (const k of ["net_revenue", "ebitda", "ebitda_pct", "net_income"]) {
        const l = line(cat.get(k), k, cell(values, k, "company", "cy_forecast"));
        if (l) fc.push(l);
      }
      if (fc.length) {
        out.push(`=== ${p.label} — Company (current-year forecast) ===`);
        out.push(...fc);
        out.push("");
      }
    }
  });

  // ---- Older months: compact company month-basis headline only --------------
  const older = recent.slice(DETAIL_MONTHS);
  if (older.length) {
    out.push("=== Prior months — Company (month basis, headline only) ===");
    for (const p of older) {
      const values = valuesByPeriod.get(p.id)!;
      const headline = ["net_revenue", "ebitda", "ebitda_pct", "net_income", "new_sales", "attrition"];
      const parts = headline
        .map((k) => {
          const c = cell(values, k, "company", "month");
          if (c.actual == null) return null;
          return `${cat.get(k)?.label ?? k} ${fmtValue(c.actual, cat.get(k)?.unit ?? "usd")}`;
        })
        .filter(Boolean);
      if (parts.length) out.push(`- ${p.label}: ${parts.join("; ")}`);
    }
    out.push("");
  }

  // ---- Per-branch breakout for the most recent months -----------------------
  recent.slice(0, BRANCH_MONTHS).forEach((p) => {
    const values = valuesByPeriod.get(p.id)!;
    let wroteHeader = false;
    for (const b of BRANCHES) {
      const lines = BRANCH_KPIS.map((k) => line(cat.get(k), k, cell(values, k, b.key, "month"))).filter(
        Boolean
      ) as string[];
      if (lines.length === 0) continue;
      if (!wroteHeader) {
        out.push(`=== ${p.label} — By branch (month) ===`);
        wroteHeader = true;
      }
      out.push(`${branchLabel(b.key)}:`);
      out.push(...lines);
    }
    if (wroteHeader) out.push("");
  });

  // ---- LOB revenue for the latest period (company + branches) ---------------
  const scopes: ("company" | (typeof BRANCHES)[number]["key"])[] = ["company", ...BRANCHES.map((b) => b.key)];
  const lobBlocks: string[] = [];
  for (const scope of scopes) {
    const rows = await lobRevenue(latest.id, scope);
    if (rows.length === 0) continue;
    const label = scope === "company" ? "Company" : branchLabel(scope);
    lobBlocks.push(`${label}: ${rows.map((r) => `${r.lob} $${Math.round(r.revenue).toLocaleString("en-US")}`).join("; ")}`);
  }
  if (lobBlocks.length) {
    out.push(`=== ${latest.label} — Revenue by line of business ===`);
    out.push(...lobBlocks);
    out.push("");
  }

  out.push(
    "NOTE ON COVERAGE: Only the figures above are stored. SG&A is a single total (no per-line-item breakdown). No per-account/per-stop chemical usage, and NO manager or individual compensation, is stored. If a question needs data not present here, say so plainly."
  );

  return out.join("\n");
}

const SYSTEM_PROMPT = `You are the financial/operations analyst for Clements Pest Control, a multi-branch (Vero Beach HQ, Stuart, Orlando, Naples) pest-control company. Answer the user's question using ONLY the DATA SNAPSHOT provided. Ground every claim in specific numbers (actual vs budget vs variance, and trends across months). When something isn't in the snapshot (e.g. individual SG&A line items — only the SG&A total is stored), say so plainly and suggest what data would be needed, rather than guessing. Never discuss or infer manager/individual compensation. Be concise and board-ready: lead with the answer, then the supporting figures.`;

export type InsightsMessage = { role: "user" | "assistant"; content: string };

/**
 * Call the Anthropic messages API with the data snapshot grounding the model.
 * Reuses the exact calling pattern used elsewhere in the app (see
 * lib/mbr/extract.ts). Throws on API error; caller maps that to a 400.
 */
export async function runInsightsChat(messages: InsightsMessage[]): Promise<string> {
  const apiKey = process.env.INSIGHTS_ANTHROPIC_API_KEY || process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("No Anthropic API key configured");
  const model = process.env.ANTHROPIC_MODEL || "claude-opus-4-8";

  const snapshot = await buildInsightsContext();

  // Sanitize the conversation to the two supported roles and drop empties.
  const convo = messages
    .filter((m) => (m.role === "user" || m.role === "assistant") && typeof m.content === "string" && m.content.trim())
    .map((m) => ({ role: m.role, content: m.content }));
  if (convo.length === 0) throw new Error("No message to answer");

  // Prepend the snapshot to the first user turn so it grounds the whole thread.
  const firstUserIdx = convo.findIndex((m) => m.role === "user");
  if (firstUserIdx >= 0) {
    convo[firstUserIdx] = {
      role: "user",
      content: `${snapshot}\n\n---\n\nQuestion: ${convo[firstUserIdx].content}`,
    };
  }

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({
      model,
      max_tokens: 1500,
      system: SYSTEM_PROMPT,
      messages: convo,
    }),
  });
  if (!res.ok) throw new Error(`Anthropic API error ${res.status}: ${await res.text()}`);
  const data = (await res.json()) as { content?: { text?: string }[] };
  const text = data.content?.map((c) => c.text ?? "").join("").trim() ?? "";
  return text || "I couldn't produce an answer for that. Try rephrasing the question.";
}
