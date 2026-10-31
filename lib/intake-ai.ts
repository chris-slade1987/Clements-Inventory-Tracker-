import "server-only";
import { aiModel } from "@/lib/ai-model";
import { branchLabel } from "@/lib/management";
import { INTAKE_DESTINATIONS, destinationLabel, suggestDestination, type DestinationKey, type IntakeAnalysis, type RouteParams, type Suggestion } from "@/lib/intake";

// The conversational, agentic layer over an uploaded intake document. Claude is
// told what the file is and the destinations it may route to, then it talks with
// the manager and — when it has enough to act — emits a structured PROPOSAL the
// UI shows as an approve/edit/cancel card. Nothing executes without the human's
// approval. Falls back to a deterministic suggestion when no API key is set.

export type ChatTurn = { role: "user" | "assistant"; content: string };
export type PlanLine = { label: string; value: string; warn?: boolean };
export type Proposal = { destination: DestinationKey; params: RouteParams; plan: PlanLine[]; handoff: boolean };
export type IntakeReply = { reply: string; proposal: Proposal | null; ai: boolean };

export function hasIntakeCoachKey(): boolean {
  return !!(process.env.SALES_ANTHROPIC_API_KEY || process.env.ANTHROPIC_API_KEY);
}

// Human-readable plan lines for a destination + params (used by the UI card and
// the deterministic fallback alike, so both read identically).
export function buildPlan(destination: DestinationKey, params: RouteParams, vehicleLabel?: string | null): PlanLine[] {
  const p = params;
  const v = (k: string) => (p[k] == null || p[k] === "" ? null : String(p[k]));
  if (destination === "vehicle_document") {
    return [
      { label: "Destination", value: "Fleet › Document Center" },
      { label: "Category", value: cap(v("category") ?? "other") },
      { label: "Vehicle", value: vehicleLabel ?? v("vehicleId") ?? "— choose a vehicle —", warn: !vehicleLabel && !v("vehicleId") },
      ...(v("expirationDate") ? [{ label: "Renewal reminder", value: `HR alerted before ${v("expirationDate")}` }] : []),
    ];
  }
  if (destination === "branch_document") {
    return [
      { label: "Destination", value: "Branch documents" },
      { label: "Branch", value: v("branch") ? branchLabel(String(v("branch"))) : "— choose a branch —", warn: !v("branch") },
      { label: "Category", value: cap(v("category") ?? "other") },
      ...(v("expirationDate") ? [{ label: "Expires", value: String(v("expirationDate")) }] : []),
    ];
  }
  if (destination === "mbr_handoff") {
    return [
      { label: "Destination", value: "Management › Upload MBR" },
      { label: "Action", value: `Extract & stage ${v("period") ?? "this report"}` },
      { label: "Dashboards", value: "Updated only after you confirm the figures", warn: true },
    ];
  }
  if (destination === "inventory_checkin") {
    return [
      { label: "Destination", value: "Inventory › Check-In" },
      { label: "Action", value: `Stage ${v("distributor") ? `${v("distributor")} ` : ""}invoice lines for review` },
      ...(v("invoiceNumber") ? [{ label: "Invoice #", value: String(v("invoiceNumber")) }] : []),
      { label: "Stock", value: "Posted only after you review and Confirm on Check-In", warn: true },
    ];
  }
  return [
    { label: "Destination", value: "Filed in intake" },
    { label: "Branch", value: v("branch") ? branchLabel(String(v("branch"))) : "Company-wide" },
    { label: "Tags", value: v("tags") ?? "—" },
    { label: "Other modules", value: "Nothing pushed — filed as a record only", warn: true },
  ];
}

function proposalFrom(sugg: Suggestion): Proposal {
  const dest = INTAKE_DESTINATIONS.find((d) => d.key === sugg.destination);
  return {
    destination: sugg.destination,
    params: sugg.params,
    plan: buildPlan(sugg.destination, sugg.params, sugg.vehicleLabel),
    handoff: !!dest?.handoff,
  };
}

const SYSTEM = `You are the Document Intake assistant for a pest-control company's back-office portal (four branches: Vero Beach, Stuart, Orlando, Naples). A manager has uploaded a file; it has already been read. Your job: have a short, practical conversation to confirm what the file is and where it should go, then propose a routing action the manager approves. You NEVER act on your own — approval is a button they press.

You may route to exactly these destinations:
{{DESTINATIONS}}

Guardrails:
- A Monthly Board Report (financials) must use "mbr_handoff" — never claim you updated dashboards; it hands off to the MBR reader for the manager to confirm.
- A distributor invoice/bill for products received should use "inventory_checkin": a HAND-OFF that stages the invoice lines on the Check-In screen for the manager to review and Confirm. It NEVER posts stock on its own — say the stock is added only after they confirm on Check-In. If the manager just wants it kept as a record (not received into stock), use "general_file" instead.
- Keep replies to 1-3 sentences, plain and direct. Ask a clarifying question only when you genuinely need one (e.g. which vehicle, which branch).

Respond with ONLY a JSON object, no prose or code fences:
{
  "reply": string,                      // what you say to the manager
  "proposal": null | {
    "destination": "vehicle_document" | "branch_document" | "mbr_handoff" | "inventory_checkin" | "general_file",
    "params": {                         // fill what you know; leave unknowns out
      "vehicleId": string,             // only if the manager named/confirmed a vehicle id you were given
      "category": string,              // vehicle: insurance|registration|title|inspection|other; branch: licensing|lease|other
      "title": string,
      "insurer": string, "policyNumber": string,
      "effectiveDate": string, "expirationDate": string,  // ISO yyyy-mm-dd
      "branch": string,                // vero|stuart|orlando|naples
      "tags": string,                  // comma-separated, for general_file
      "period": string,                // for mbr_handoff
      "distributor": string,           // for inventory_checkin
      "invoiceNumber": string,         // for inventory_checkin
      "remindHr": true                 // vehicle renewal reminder
    }
  }
}
Set "proposal" to null while you still need information. Emit a proposal once you can act.`;

function destinationsBlock(): string {
  return INTAKE_DESTINATIONS.map((d) => `- ${d.key}: ${d.label} — ${d.blurb}`).join("\n");
}

async function callClaude(analysis: IntakeAnalysis, vehicleLabel: string | null, history: ChatTurn[], userMessage: string): Promise<IntakeReply | null> {
  const apiKey = process.env.SALES_ANTHROPIC_API_KEY || process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return null;
  const model = aiModel.cheap();
  const context = `File read:\n- kind: ${analysis.kind}\n- title: ${analysis.title}\n- summary: ${analysis.summary}\n- extracted: ${JSON.stringify(analysis.fields)}${vehicleLabel ? `\n- best vehicle match: ${vehicleLabel}` : ""}`;
  const convo: ChatTurn[] = [
    { role: "user", content: `${context}\n\n---\nManager: ${userMessage}` },
    ...history.slice(-8).map((m) => ({ role: m.role, content: m.content })),
  ];
  // Put the freshest manager message last.
  const messages = history.length
    ? [...history.slice(-8), { role: "user" as const, content: `${context}\n\n---\nManager: ${userMessage}` }]
    : convo.slice(0, 1);

  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({ model, max_tokens: 900, system: SYSTEM.replace("{{DESTINATIONS}}", destinationsBlock()), messages }),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { content?: { text?: string }[] };
    const text = data.content?.map((c) => c.text ?? "").join("") ?? "";
    const raw = parseJson(text);
    if (!raw) return null;
    const reply = String(raw.reply ?? "").trim() || "Here's what I'd do.";
    let proposal: Proposal | null = null;
    const pr = raw.proposal as { destination?: string; params?: RouteParams } | null | undefined;
    if (pr && pr.destination && INTAKE_DESTINATIONS.some((d) => d.key === pr.destination)) {
      const destination = pr.destination as DestinationKey;
      const params = (pr.params ?? {}) as RouteParams;
      const dest = INTAKE_DESTINATIONS.find((d) => d.key === destination);
      proposal = { destination, params, plan: buildPlan(destination, params, vehicleLabel), handoff: !!dest?.handoff };
    }
    return { reply, proposal, ai: true };
  } catch {
    return null;
  }
}

/** Opening message when the file is first read (no user turn yet). */
export async function openingMessage(analysis: IntakeAnalysis): Promise<IntakeReply> {
  const sugg = await suggestDestination(analysis);
  const ai = await callClaude(analysis, sugg.vehicleLabel ?? null, [], "I just uploaded this. What is it and where would it go?");
  if (ai) return ai;
  // Deterministic opener.
  const label = destinationLabel(sugg.destination);
  const reply = `${analysis.summary || `This looks like ${analysis.title}.`} I'd route it to ${label}. Approve below, or tell me where it should go.`;
  return { reply, proposal: proposalFrom(sugg), ai: false };
}

/** A follow-up turn in the conversation. */
export async function intakeChat(analysis: IntakeAnalysis, history: ChatTurn[], userMessage: string): Promise<IntakeReply> {
  const sugg = await suggestDestination(analysis);
  const ai = await callClaude(analysis, sugg.vehicleLabel ?? null, history, userMessage);
  if (ai) return ai;
  // Deterministic fallback: acknowledge + re-propose the best guess.
  const label = destinationLabel(sugg.destination);
  return { reply: `Got it. I'll route this to ${label} — approve below or adjust the details.`, proposal: proposalFrom(sugg), ai: false };
}

function parseJson(text: string): Record<string, unknown> | null {
  try {
    const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
    const candidate = fenced ? fenced[1] : text;
    const start = candidate.indexOf("{");
    const end = candidate.lastIndexOf("}");
    if (start === -1 || end === -1) return null;
    return JSON.parse(candidate.slice(start, end + 1));
  } catch {
    return null;
  }
}
function cap(s: string): string {
  return s ? s[0].toUpperCase() + s.slice(1) : s;
}
