import "server-only";
import { branchLabel } from "@/lib/management";
import { diagnoseFunnel, projectClose, type AdvisorFunnel } from "@/lib/sales-funnel";

// AI sales coach. Turns the deterministic funnel diagnosis into specific, human
// coaching for an advisor, and a team briefing for the director. Grounded in the
// real funnel numbers; motivation/performance only — never compensation. Degrades
// gracefully to the deterministic text when no Anthropic key is configured.

export function hasCoachKey(): boolean {
  return !!(process.env.SALES_ANTHROPIC_API_KEY || process.env.ANTHROPIC_API_KEY);
}

const money = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;
const pctOf = (n: number) => `${Math.round(n * 100)}%`;

async function callClaude(system: string, prompt: string, maxTokens: number): Promise<string | null> {
  const apiKey = process.env.SALES_ANTHROPIC_API_KEY || process.env.ANTHROPIC_API_KEY;
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

function funnelFacts(r: AdvisorFunnel, pace: number): string {
  return [
    `Advisor: ${r.advisor.name}${r.advisor.branch ? ` (${branchLabel(r.advisor.branch)})` : ""}`,
    `Month ${Math.round(pace * 100)}% elapsed.`,
    `Leads: ${r.leads} of ${r.leadsGoal} goal.`,
    `Proposals: ${r.proposals} of ${r.propGoal} goal. Lead→Proposal ${pctOf(r.lpRate)} vs ${pctOf(r.lpTarget)} target.`,
    `Deals closed: ${r.deals} of ${r.dealGoal} goal. Proposal→Close ${pctOf(r.pcRate)} vs ${pctOf(r.pcTarget)} target.`,
    `Closed $: ${money(r.closed)} of ${money(r.goal)} goal (${pctOf(r.goalPct)}).`,
    `Deterministic diagnosis: ${diagnoseFunnel(r, pace).head}.`,
  ].join("\n");
}

const ADVISOR_SYSTEM =
  "You are a sales coach for Clements Pest Control service advisors. Using ONLY the funnel figures provided, write 2–3 short sentences of specific, encouraging coaching: name what's working, the single biggest lever to pull, and one concrete action. Pest-control sales terms (leads, consultations/inspections, proposals, close rate). Never mention pay, commission, or compensation. Plain, direct, no fluff.";

/** A coaching note + month-end projection line for one advisor. */
export async function coachAdvisor(r: AdvisorFunnel, pace: number): Promise<{ text: string; projection: number; ai: boolean }> {
  const diag = diagnoseFunnel(r, pace);
  const projection = projectClose(r, pace);
  const ai = await callClaude(ADVISOR_SYSTEM, funnelFacts(r, pace) + "\n\nWrite the coaching note.", 400);
  return { text: ai ?? diag.msg, projection, ai: !!ai };
}

const TEAM_SYSTEM =
  "You are the analyst for a pest-control Sales Director. Using ONLY the per-advisor funnel figures, write a 3–4 sentence team briefing: who to coach first and why, name the specific bottleneck (lead-gen, consultation, or closing), and call out anyone pacing to beat goal. Ground every claim in the numbers. Never mention pay, commission, or compensation.";

/** A short team briefing for the director. */
export async function briefTeam(rows: AdvisorFunnel[], pace: number): Promise<{ text: string; ai: boolean }> {
  const active = rows.filter((r) => r.hasData || r.hasGoal);
  if (active.length === 0) return { text: "No advisor data yet this month. Once goals are set and activity is logged, a briefing will appear here.", ai: false };
  const facts = active.map((r) => {
    const d = diagnoseFunnel(r, pace);
    return `- ${r.advisor.name}${r.advisor.branch ? ` (${branchLabel(r.advisor.branch)})` : ""}: ${d.label}. Leads ${r.leads}/${r.leadsGoal}, proposals ${r.proposals}/${r.propGoal} (L→P ${pctOf(r.lpRate)} vs ${pctOf(r.lpTarget)}), closed ${money(r.closed)}/${money(r.goal)} (${pctOf(r.goalPct)}), close rate ${pctOf(r.pcRate)} vs ${pctOf(r.pcTarget)}.`;
  }).join("\n");
  const prompt = `Month ${Math.round(pace * 100)}% elapsed. Team funnel:\n${facts}\n\nWrite the briefing.`;
  const ai = await callClaude(TEAM_SYSTEM, prompt, 500);
  if (ai) return { text: ai, ai: true };
  // Deterministic fallback: tally the gaps.
  const tally: Record<string, string[]> = {};
  for (const r of active) { const l = diagnoseFunnel(r, pace).label; (tally[l] = tally[l] || []).push(r.advisor.name); }
  const parts = Object.entries(tally).filter(([k]) => k !== "Healthy" && k !== "No data yet").map(([k, names]) => `${names.length} ${k.toLowerCase()} (${names.join(", ")})`);
  return { text: parts.length ? `Focus areas this month: ${parts.join("; ")}. Start with the closing gaps — those are closest to revenue.` : "The team is healthy and on pace across the funnel.", ai: false };
}
