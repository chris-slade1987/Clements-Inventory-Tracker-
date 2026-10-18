import "server-only";
import type { SessionUser } from "@/lib/auth";
import { retrieve, type RetrievedChunk } from "@/lib/copilot/retrieve";
import { buildSystemPrompt, type CopilotScreen } from "@/lib/copilot/system-prompt";
import {
  COPILOT_TOOLS,
  COPILOT_TOOL_MAP,
  resolveToolContext,
  type ToolContext,
} from "@/lib/copilot/tools";

// ===========================================================================
// Canopy Copilot — the agent loop (CanopyOS Theme 5, Wave B, plan §8).
// ===========================================================================
//
// resolve user + screen → RETRIEVE top-k company passages (access-filtered, Wave A)
// → call Claude with the tool schema + retrieved passages + conversation → execute
// any tool calls (each re-checks scope server-side) → return the grounded answer +
// citations + any proposed action cards. Reuses the exact Anthropic plumbing the
// rest of the app uses (raw fetch, ANTHROPIC_MODEL || "claude-opus-4-8").
//
// A deterministic fallback (no API key / model error) returns a retrieval-only
// answer so the panel always helps. `grounded` is true only when retrieval or a
// tool actually supported the answer.

// ---- the shared API contract (Wave C builds the UI against this EXACTLY) -----

export type CopilotCitation = { title: string; section?: string; href: string };

export type CopilotAction =
  | { kind: "link"; label: string; href: string }
  | { kind: "confirm"; label: string; endpoint: string; method: string; params?: Record<string, unknown>; confirmNote?: string };

export type CopilotResult = {
  reply: string;
  citations: CopilotCitation[];
  actions: CopilotAction[];
  grounded: boolean;
};

export type CopilotMessage = { role: "user" | "assistant"; content: string };

export type CopilotInput = {
  user: SessionUser;
  messages: CopilotMessage[];
  screen?: CopilotScreen;
};

// ---- config -----------------------------------------------------------------

const MODEL = process.env.ANTHROPIC_MODEL || "claude-opus-4-8";
const MAX_TOOL_ITERATIONS = 5; // cap on tool-use round trips
const RETRIEVE_K = 6;

/** True when an Anthropic key is available (same keys as the rest of the app). */
export function hasCopilotKey(): boolean {
  return !!(process.env.ANTHROPIC_API_KEY || process.env.INSIGHTS_ANTHROPIC_API_KEY);
}

// Only existing, safe write endpoints may back a one-click `confirm` action. The
// server still authorizes the real call when the user clicks; this just stops the
// model proposing a confirm against anything we haven't vetted. Everything else
// must be a `link` deep-link. (Plan §7 / §10: propose, human clicks, server decides.)
const ALLOWED_CONFIRM_ENDPOINTS = new Set<string>(["/api/reminders"]);

// ---- helpers ----------------------------------------------------------------

function sanitize(messages: CopilotMessage[]): CopilotMessage[] {
  return messages
    .filter((m) => (m.role === "user" || m.role === "assistant") && typeof m.content === "string" && m.content.trim())
    .map((m) => ({ role: m.role, content: m.content.trim() }));
}

function lastUserText(messages: CopilotMessage[]): string {
  for (let i = messages.length - 1; i >= 0; i--) if (messages[i].role === "user") return messages[i].content;
  return "";
}

function toCitations(chunks: RetrievedChunk[]): CopilotCitation[] {
  const seen = new Set<string>();
  const out: CopilotCitation[] = [];
  for (const c of chunks) {
    if (seen.has(c.citation.href)) continue;
    seen.add(c.citation.href);
    const cit: CopilotCitation = { title: c.citation.title, href: c.citation.href };
    if (c.citation.sectionTitle) cit.section = c.citation.sectionTitle;
    out.push(cit);
  }
  return out;
}

/** The company-sources block injected alongside the user's question. */
function groundingBlock(chunks: RetrievedChunk[], screen?: CopilotScreen): string {
  const lines: string[] = [];
  if (screen?.path) lines.push(`[The user is on ${screen.path}${screen.entityType ? ` viewing ${screen.entityType} ${screen.entityId ?? ""}` : ""}.]`, "");
  if (chunks.length === 0) {
    lines.push("COMPANY SOURCES: (no passages matched this question). If your tools can't answer it either, decline and point to who owns the answer.");
  } else {
    lines.push("COMPANY SOURCES (the ONLY documents you may cite — quote/cite by title + section):");
    chunks.forEach((c, i) => {
      lines.push("", `[${i + 1}] ${c.citation.title}${c.citation.sectionTitle ? ` — ${c.citation.sectionTitle}` : ""} (link: ${c.citation.href})`, c.chunk.content.trim());
    });
  }
  return lines.join("\n");
}

// ---- Anthropic tool-use message types (minimal) -----------------------------

type TextBlock = { type: "text"; text: string };
type ToolUseBlock = { type: "tool_use"; id: string; name: string; input: Record<string, unknown> };
type ToolResultBlock = { type: "tool_result"; tool_use_id: string; content: string; is_error?: boolean };
type ContentBlock = TextBlock | ToolUseBlock | ToolResultBlock | { type: string; [k: string]: unknown };
type ApiMessage = { role: "user" | "assistant"; content: string | ContentBlock[] };

// The orchestration-only action tool (plan §7 action wiring). Not a data tool, so
// it lives here, not in tools.ts. Its "handler" validates + records the proposed
// action; it performs NO write (the panel calls the real endpoint on user click).
const PROPOSE_ACTION_SCHEMA = {
  name: "propose_action",
  description:
    "Propose ONE action card for the user (you never act yourself; the human clicks). kind:'link' opens an internal portal page (href starting with '/') — use this to open a real form pre-filled for a sensitive write (write-up, accident report), or as a deep-link. kind:'confirm' asks the user to confirm a low-risk bounded call to an EXISTING endpoint (currently only /api/reminders, e.g. clearing a reminder). If a confirm isn't allowed, it will be rejected and you should propose a link instead.",
  input_schema: {
    type: "object" as const,
    properties: {
      kind: { type: "string", enum: ["link", "confirm"] },
      label: { type: "string", description: "The button label the user sees." },
      href: { type: "string", description: "kind:link only — internal path starting with '/'." },
      endpoint: { type: "string", description: "kind:confirm only — an existing API path, e.g. /api/reminders." },
      method: { type: "string", description: "kind:confirm only — HTTP method, e.g. POST." },
      params: { type: "object", description: "kind:confirm only — the JSON body to send on confirm." },
      confirmNote: { type: "string", description: "kind:confirm only — a short note shown before the user confirms." },
    },
    required: ["kind", "label"],
  },
};

function recordAction(input: Record<string, unknown>, out: CopilotAction[]): { recorded: boolean; reason?: string } {
  const kind = typeof input.kind === "string" ? input.kind : "";
  const label = typeof input.label === "string" && input.label.trim() ? input.label.trim() : "";
  if (!label) return { recorded: false, reason: "Missing label." };

  if (kind === "link") {
    const href = typeof input.href === "string" ? input.href.trim() : "";
    if (!href.startsWith("/")) return { recorded: false, reason: "A link action needs an internal href starting with '/'." };
    out.push({ kind: "link", label, href });
    return { recorded: true };
  }
  if (kind === "confirm") {
    const endpoint = typeof input.endpoint === "string" ? input.endpoint.trim() : "";
    const method = (typeof input.method === "string" && input.method.trim() ? input.method.trim() : "POST").toUpperCase();
    if (!ALLOWED_CONFIRM_ENDPOINTS.has(endpoint)) {
      return { recorded: false, reason: `Confirm actions are only allowed against: ${[...ALLOWED_CONFIRM_ENDPOINTS].join(", ")}. Propose a link deep-link instead.` };
    }
    const action: CopilotAction = { kind: "confirm", label, endpoint, method };
    if (input.params && typeof input.params === "object") action.params = input.params as Record<string, unknown>;
    if (typeof input.confirmNote === "string" && input.confirmNote.trim()) action.confirmNote = input.confirmNote.trim();
    out.push(action);
    return { recorded: true };
  }
  return { recorded: false, reason: "kind must be 'link' or 'confirm'." };
}

async function anthropic(body: Record<string, unknown>): Promise<{ content: ContentBlock[]; stop_reason: string }> {
  const apiKey = process.env.ANTHROPIC_API_KEY || process.env.INSIGHTS_ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("No Anthropic API key configured");
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Anthropic API error ${res.status}: ${await res.text()}`);
  return (await res.json()) as { content: ContentBlock[]; stop_reason: string };
}

// ---- the model path ---------------------------------------------------------

/**
 * Run the full agent loop against Claude with tool use. Throws on API failure so
 * the route can fall back to the deterministic reply.
 */
export async function runCopilotAgent(inp: CopilotInput): Promise<CopilotResult> {
  const convo = sanitize(inp.messages);
  if (convo.length === 0) throw new Error("No message to answer");
  const query = lastUserText(convo);

  const ctx: ToolContext = await resolveToolContext(inp.user);
  const retrieved = await retrieve(query, { user: inp.user, k: RETRIEVE_K });

  // Inject the company-sources grounding into the latest user turn.
  const apiMessages: ApiMessage[] = convo.map((m) => ({ role: m.role, content: m.content }));
  for (let i = apiMessages.length - 1; i >= 0; i--) {
    if (apiMessages[i].role === "user") {
      apiMessages[i] = { role: "user", content: `${groundingBlock(retrieved, inp.screen)}\n\n---\n\nQuestion: ${convo[i].content}` };
      break;
    }
  }

  const tools = [...COPILOT_TOOLS.map((t) => t.schema), PROPOSE_ACTION_SCHEMA];
  const system = buildSystemPrompt(inp.user, inp.screen);

  const actions: CopilotAction[] = [];
  let toolUsed = false;
  let finalText = "";

  for (let iter = 0; iter < MAX_TOOL_ITERATIONS; iter++) {
    const resp = await anthropic({ model: MODEL, max_tokens: 1800, system, tools, messages: apiMessages });
    const blocks = Array.isArray(resp.content) ? resp.content : [];

    const text = blocks.filter((b): b is TextBlock => b.type === "text").map((b) => b.text).join("").trim();
    if (text) finalText = text;

    const toolUses = blocks.filter((b): b is ToolUseBlock => b.type === "tool_use");
    if (resp.stop_reason !== "tool_use" || toolUses.length === 0) break;

    apiMessages.push({ role: "assistant", content: blocks });

    const results: ToolResultBlock[] = [];
    for (const tu of toolUses) {
      if (tu.name === "propose_action") {
        const r = recordAction(tu.input ?? {}, actions);
        results.push({ type: "tool_result", tool_use_id: tu.id, content: JSON.stringify(r), is_error: !r.recorded });
        continue;
      }
      const tool = COPILOT_TOOL_MAP.get(tu.name);
      if (!tool) {
        results.push({ type: "tool_result", tool_use_id: tu.id, content: JSON.stringify({ error: `Unknown tool: ${tu.name}` }), is_error: true });
        continue;
      }
      try {
        const out = await tool.handler(tu.input ?? {}, ctx);
        // A tool that returned real data (not an access/empty error) counts as grounding.
        if (!out || typeof out !== "object" || !("error" in (out as Record<string, unknown>))) toolUsed = true;
        results.push({ type: "tool_result", tool_use_id: tu.id, content: JSON.stringify(out) });
      } catch (e) {
        results.push({ type: "tool_result", tool_use_id: tu.id, content: JSON.stringify({ error: (e as Error).message || "tool failed" }), is_error: true });
      }
    }
    apiMessages.push({ role: "user", content: results });
  }

  const grounded = retrieved.length > 0 || toolUsed;
  return {
    reply: finalText || "I couldn't put together an answer for that. Try rephrasing, or tell me what you're trying to do.",
    citations: toCitations(retrieved),
    actions,
    grounded,
  };
}

// ---- the deterministic fallback (no key / model error) ----------------------

/**
 * A retrieval-only answer so the panel always helps even with no Anthropic key.
 * Summarizes the top passages, returns their citations, and offers a deep-link to
 * the best source. `grounded` follows retrieval alone.
 */
export async function deterministicCopilotReply(inp: CopilotInput): Promise<CopilotResult> {
  const convo = sanitize(inp.messages);
  const query = lastUserText(convo);
  const retrieved = query ? await retrieve(query, { user: inp.user, k: 4 }) : [];

  if (retrieved.length === 0) {
    return {
      reply:
        "I don't have a grounded answer to that from the company's materials, and the AI assistant isn't connected right now. For policy, check the Employee Handbook or ask HR; for branch operations, the Manager Operating Manual or your branch manager; for numbers, the relevant dashboard.",
      citations: [],
      actions: [],
      grounded: false,
    };
  }

  const top = retrieved[0];
  const titles = Array.from(new Set(retrieved.map((r) => r.citation.title)));
  const lines: string[] = [];
  lines.push(`Here's what I found in the company's materials (${titles.join("; ")}):`, "");
  for (const r of retrieved.slice(0, 3)) {
    const excerpt = r.chunk.content.replace(/\s+/g, " ").trim().slice(0, 320);
    lines.push(`• ${r.citation.title}${r.citation.sectionTitle ? ` — ${r.citation.sectionTitle}` : ""}: ${excerpt}${excerpt.length >= 320 ? "…" : ""}`);
  }
  lines.push("", "(The AI assistant isn't connected, so this is a direct pull from the sources below — open one to read it in full.)");

  return {
    reply: lines.join("\n"),
    citations: toCitations(retrieved),
    actions: [{ kind: "link", label: `Open ${top.citation.title}`, href: top.citation.href }],
    grounded: true,
  };
}
