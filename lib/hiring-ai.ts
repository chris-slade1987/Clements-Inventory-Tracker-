import "server-only";
import { ROLE_LABELS, type TemplateKind } from "@/lib/hiring-templates";
import { isResponseType, type ResponseType } from "@/lib/ats-config";

// ---------------------------------------------------------------------------
// AI-assist for the Hiring Template Library. Mirrors lib/insights.ts exactly:
// key = INSIGHTS_ANTHROPIC_API_KEY || ANTHROPIC_API_KEY, model = ANTHROPIC_MODEL
// || "claude-opus-4-8", POST https://api.anthropic.com/v1/messages with
// x-api-key + anthropic-version. It DRAFTS/REFINES interview & screening
// questions that are behavioral, role-grounded, and legally-mindful (no
// protected-class / ADA-risky wording). Degrades gracefully with no key — the
// caller returns a 200 + a "use the off-the-shelf bank" message, never a 500.
// ---------------------------------------------------------------------------

export function hasHiringAiKey(): boolean {
  return !!(process.env.INSIGHTS_ANTHROPIC_API_KEY || process.env.ANTHROPIC_API_KEY);
}

export type AiQuestionSuggestion = { section: string; text: string; responseType: ResponseType };

const SYSTEM_PROMPT = `You are an expert hiring-question writer for Clements Pest Control, a Florida pest-control company (field pest technicians, sales/service advisors, branch managers, and office CSRs). You draft interview and phone-screening questions that are:
- BEHAVIORAL and open-ended for interviews ("Tell me about a time…", "Describe how you…"); CRISP and confirmable for screening calls (availability, transportation, work authorization, comfort with the physical/outdoor + pesticide realities of the role).
- ROLE-GROUNDED in real pest-control work (safety & PPE, treatment thoroughness & documentation, at-the-door customer interaction, driving/route professionalism, reliability, coachability).
- LEGALLY MINDFUL and job-related. NEVER ask about or hint at protected classes or anything ADA-risky: no age, race, religion, national origin, marital/family status, pregnancy/children, disability or health conditions, medical history, workers'-comp history, genetic info, citizenship (you MAY ask "authorized to work in the US"), arrest records (a lawful conviction/background-check question is fine), or any disability-implying "can you physically…" phrasing. Assess job requirements by CONDITIONS ("This role requires lifting up to ~50 lb and working outdoors in Florida heat — are you able to meet that requirement with or without a reasonable accommodation?") rather than probing health.

Return ONLY a JSON array (no prose, no markdown fences) of 1–3 objects, each:
{"section": "<short competency/topic label>", "text": "<the question>", "responseType": "rating_1_5" | "yes_no" | "text" | "basics_yesno_unsure"}
Use "rating_1_5" for interview competencies the interviewer will rate, "text" for open behavioral prompts, "yes_no" for crisp screening confirmations, and "basics_yesno_unsure" for eligibility/basics checks.`;

/**
 * Call Anthropic to draft/refine hiring questions. Throws on no key or API
 * error — the route maps a missing key to a graceful 200 and any other error to
 * a 200 with an empty list + message, so the editor never 500s.
 */
export async function draftHiringQuestions(input: {
  kind: TemplateKind;
  role?: string | null;
  intent?: string | null;
  draft?: string | null;
}): Promise<AiQuestionSuggestion[]> {
  const apiKey = process.env.INSIGHTS_ANTHROPIC_API_KEY || process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("No Anthropic API key configured");
  const model = process.env.ANTHROPIC_MODEL || "claude-opus-4-8";

  const roleLabel = input.role ? ROLE_LABELS[input.role] ?? input.role : "any role";
  const parts = [
    `Template kind: ${input.kind === "screening" ? "HR phone screening call" : "in-person interview"}.`,
    `Role: ${roleLabel}.`,
  ];
  if (input.intent) parts.push(`What HR wants to assess: ${input.intent}`);
  if (input.draft) parts.push(`Refine this rough question (keep the intent, improve the wording, make it behavioral and legally-mindful): "${input.draft}"`);
  if (!input.intent && !input.draft) parts.push("Suggest strong questions for this kind + role.");
  parts.push("Return 1–3 polished question suggestions as the specified JSON array.");

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({
      model,
      max_tokens: 1000,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: parts.join("\n") }],
    }),
  });
  if (!res.ok) throw new Error(`Anthropic API error ${res.status}: ${await res.text()}`);
  const data = (await res.json()) as { content?: { text?: string }[] };
  const text = data.content?.map((c) => c.text ?? "").join("").trim() ?? "";
  return parseSuggestions(text);
}

/** Parse the model's JSON array, tolerating stray prose / code fences. */
function parseSuggestions(text: string): AiQuestionSuggestion[] {
  let body = text.trim();
  const fence = body.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) body = fence[1].trim();
  if (!body.startsWith("[")) {
    const start = body.indexOf("[");
    const end = body.lastIndexOf("]");
    if (start >= 0 && end > start) body = body.slice(start, end + 1);
  }
  let arr: unknown;
  try {
    arr = JSON.parse(body);
  } catch {
    return [];
  }
  if (!Array.isArray(arr)) return [];
  const out: AiQuestionSuggestion[] = [];
  for (const raw of arr) {
    if (!raw || typeof raw !== "object") continue;
    const o = raw as Record<string, unknown>;
    const t = typeof o.text === "string" ? o.text.trim() : "";
    if (!t) continue;
    const responseType: ResponseType = isResponseType(o.responseType) ? o.responseType : "text";
    const section = typeof o.section === "string" && o.section.trim() ? o.section.trim() : "General";
    out.push({ section, text: t, responseType });
    if (out.length >= 3) break;
  }
  return out;
}
