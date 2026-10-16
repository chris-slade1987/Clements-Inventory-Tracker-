import "server-only";
import { branchLabel } from "@/lib/management";
import { diagnoseFunnel, projectClose, type AdvisorFunnel } from "@/lib/sales-funnel";
import { heatMapFacts, sourceFacts, type HeatMap, type SourcePerformance } from "@/lib/sales-leads";

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
  "You are a sales coach for Clements Pest Control service advisors. Using ONLY the funnel figures provided, write 2–3 short sentences of specific, encouraging coaching: name what's working, the single biggest lever to pull, and one concrete action. When a Focus Plan is provided, reference the advisor's own planned actions and their logged outcomes (e.g. praise a networking win, or nudge an overdue follow-up). Pest-control sales terms (leads, consultations/inspections, proposals, close rate). Never mention pay, commission, or compensation. Plain, direct, no fluff.";

/** A coaching note + month-end projection line for one advisor. `focusFacts` is
 *  the advisor's Focus Plan summary (from focusFactsForAdvisor), appended when set. */
export async function coachAdvisor(r: AdvisorFunnel, pace: number, focusFacts = ""): Promise<{ text: string; projection: number; ai: boolean }> {
  const diag = diagnoseFunnel(r, pace);
  const projection = projectClose(r, pace);
  const prompt = funnelFacts(r, pace) + (focusFacts ? `\n\n${focusFacts}` : "") + "\n\nWrite the coaching note.";
  const ai = await callClaude(ADVISOR_SYSTEM, prompt, 400);
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

// ---- Lead heat-map insight ---------------------------------------------------
const HEATMAP_DIRECTOR_SYSTEM =
  "You are the analyst for a pest-control Sales Director. Using ONLY the geographic lead figures provided, write 2–3 short sentences: name the densest and highest-converting neighborhoods/zips to double down on, call out any high-volume area with a weak close rate to fix, and give one concrete territory action. Reference real area/zip labels from the data. Never mention pay, commission, or compensation.";
const HEATMAP_ADVISOR_SYSTEM =
  "You are a sales coach for a pest-control service advisor. Using ONLY the advisor's own geographic lead figures, write 2–3 short sentences: name their densest and best-closing neighborhood/zip to concentrate on, flag any area worth more attention, and give one concrete action (e.g. 'work 32960 Vero Beach harder'). Reference real area/zip labels. Never mention pay, commission, or compensation.";

function deterministicHeatInsight(h: HeatMap, scope: "team" | "advisor"): string {
  if (h.clusters.length === 0) return "No lead locations in this date range yet. Once leads are logged with addresses, the densest and best-performing areas will surface here.";
  const byClosed = [...h.clusters].sort((a, b) => b.closedValue - a.closedValue);
  const best = byClosed[0];
  const densest = h.clusters[0];
  const weak = [...h.clusters].filter((c) => c.total >= 3 && c.closeRate < 0.2).sort((a, b) => b.total - a.total)[0];
  const who = scope === "advisor" ? "you" : "the team";
  const parts = [
    `${densest.area} is ${scope === "advisor" ? "your" : "the"} densest area at ${densest.total} leads.`,
    best && best.closedValue > 0 ? `${best.area} is converting best — $${Math.round(best.closedValue).toLocaleString("en-US")} closed at a ${Math.round(best.closeRate * 100)}% close rate, so ${who} should concentrate there.` : "",
    weak ? `${weak.area} has volume (${weak.total}) but only a ${Math.round(weak.closeRate * 100)}% close rate — worth a closer look at follow-up there.` : "",
  ].filter(Boolean);
  return parts.join(" ");
}

/** AI insight over the lead heat map — company-wide (director) or personal (advisor). */
export async function heatMapInsight(h: HeatMap, scope: "team" | "advisor", scopeLabel: string): Promise<{ text: string; ai: boolean }> {
  const facts = heatMapFacts(h, scopeLabel);
  const ai = await callClaude(scope === "team" ? HEATMAP_DIRECTOR_SYSTEM : HEATMAP_ADVISOR_SYSTEM, facts + "\n\nWrite the insight.", 320);
  return { text: ai ?? deterministicHeatInsight(h, scope), ai: !!ai };
}

// ---- Lead-source insight -----------------------------------------------------
const SOURCE_DIRECTOR_SYSTEM =
  "You are the analyst for a pest-control Sales Director. Using ONLY the lead-source figures provided, write 2–3 short sentences: name the best-performing channel by close rate and dollars, compare company-provided vs self-generated lead performance, and give one concrete action on where to invest. Never mention pay, commission, or compensation.";
const SOURCE_ADVISOR_SYSTEM =
  "You are a sales coach for a pest-control service advisor. Using ONLY the advisor's own lead-source figures, write 2–3 short sentences: name which source works best for them, note how their self-generated leads compare to company-provided ones, and give one concrete action. Never mention pay, commission, or compensation.";

function deterministicSourceInsight(s: SourcePerformance, scope: "team" | "advisor"): string {
  if (s.sources.length === 0) return "No lead-source data in this date range yet. Once leads are logged with a source, channel performance will appear here.";
  const best = [...s.sources].sort((a, b) => b.closeRate - a.closeRate || b.closedValue - a.closedValue)[0];
  const prov = s.buckets.find((b) => b.key === "provided");
  const self = s.buckets.find((b) => b.key === "self");
  const who = scope === "advisor" ? "your" : "the team's";
  const parts = [`${best.label} is ${who} strongest source — ${Math.round(best.closeRate * 100)}% close rate on ${best.total} leads.`];
  if (prov && self && (prov.total > 0 || self.total > 0)) {
    const better = prov.closeRate >= self.closeRate ? "company-provided" : "self-generated";
    parts.push(`Company-provided leads close at ${Math.round(prov.closeRate * 100)}% vs ${Math.round(self.closeRate * 100)}% for self-generated — ${better} is pulling ahead right now.`);
  }
  return parts.join(" ");
}

/** AI insight over lead-source performance — company (director) or personal (advisor). */
export async function sourceInsight(s: SourcePerformance, scope: "team" | "advisor", scopeLabel: string): Promise<{ text: string; ai: boolean }> {
  const facts = sourceFacts(s, scopeLabel);
  const ai = await callClaude(scope === "team" ? SOURCE_DIRECTOR_SYSTEM : SOURCE_ADVISOR_SYSTEM, facts + "\n\nWrite the insight.", 320);
  return { text: ai ?? deterministicSourceInsight(s, scope), ai: !!ai };
}
