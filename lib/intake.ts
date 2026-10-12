import "server-only";
import { prisma } from "@/lib/prisma";
import { matchDocVehicle } from "@/lib/documents";
import { readUpload } from "@/lib/storage";
import { parseInvoice } from "@/lib/invoice/parse";

// Universal Document Intake. A single drop-zone for ANY file: Claude reads it,
// the user explains what it is / where it goes in a chat, and Claude proposes a
// routing action the user approves. On approval the file is routed to the right
// portal module. This lib owns the reading, the destination registry, and the
// executors that actually file each kind. Server-only.

// ---- Destinations (the only places intake can route to) --------------------
export type DestinationKey = "vehicle_document" | "branch_document" | "mbr_handoff" | "inventory_checkin" | "general_file";

export const INTAKE_DESTINATIONS: {
  key: DestinationKey;
  label: string;
  blurb: string; // one line Claude is told about this destination
  adminOnly?: boolean; // executor also enforces this
  handoff?: boolean; // doesn't write — sends the user to an existing review screen
}[] = [
  { key: "vehicle_document", label: "Fleet · vehicle document", blurb: "Insurance, registration, title or inspection docs filed to a specific vehicle (sets renewal reminders)." },
  { key: "branch_document", label: "Branch document", blurb: "Licensing, leases or other paperwork filed to one of the four branches." },
  { key: "mbr_handoff", label: "MBR review (hand-off)", blurb: "A Monthly Board Report — hand off to the MBR reader for extract-and-confirm; never written silently.", adminOnly: true, handoff: true },
  { key: "inventory_checkin", label: "Inventory check-in (receive stock)", blurb: "A distributor invoice/bill for products received — hand off to the Check-In screen with the lines staged for review + Confirm; never posts stock on its own.", handoff: true },
  { key: "general_file", label: "Filed in intake (with tags)", blurb: "Anything else — keep the file here, tagged and optionally tied to a branch, as a searchable record. No data is pushed into other modules." },
];

export function destinationLabel(key: string | null | undefined): string {
  return INTAKE_DESTINATIONS.find((d) => d.key === key)?.label ?? "Filed";
}

// ---- AI reading ------------------------------------------------------------
export type IntakeAnalysis = {
  kind: string; // vehicle_insurance | vehicle_registration | vehicle_title | mbr | invoice | handbook | scorecard | other
  title: string;
  summary: string; // 1-2 sentences a manager reads to confirm
  fields: Record<string, string>; // flexible extracted values (dates, vendor, amount, vehicleHint, branchHint, period, …)
  source: "claude" | "mock";
};

export function intakeReaderMode(): "claude" | "mock" {
  return process.env.ANTHROPIC_API_KEY ? "claude" : "mock";
}

const BRANCHES = ["vero", "stuart", "orlando", "naples"] as const;

const READ_PROMPT = `You are the intake reader for a pest-control company's back-office portal. A manager just dropped in a file. Read it and return JSON with EXACTLY this shape and nothing else:

{
  "kind": "vehicle_insurance" | "vehicle_registration" | "vehicle_title" | "vehicle_inspection" | "mbr" | "invoice" | "handbook" | "scorecard" | "other",
  "title": string,            // short human title, e.g. "Progressive Commercial Auto Policy"
  "summary": string,          // 1-2 plain sentences a manager reads to confirm where it belongs
  "fields": {                 // include only the keys you actually find; omit the rest
    "vendor": string,         // issuer / insurer / vendor / distributor
    "doc_number": string,     // policy #, invoice #, etc.
    "amount": string,         // total dollar amount if it's a bill/invoice
    "effective_date": string, // ISO yyyy-mm-dd
    "expiration_date": string,// ISO yyyy-mm-dd
    "period": string,         // e.g. "September 2026" for a report
    "vehicle_hint": string,   // VIN / plate / unit # / year-make-model if a vehicle doc
    "driver_hint": string,    // insured / driver name if present
    "branch_hint": string     // one of: Vero Beach, Stuart, Orlando, Naples (if the doc points to a branch)
  }
}

Rules:
- Pick the single best "kind".
- Dates as ISO yyyy-mm-dd. Omit any field you cannot find.
- Respond with ONLY the JSON object — no prose, no code fences.`;

type Block =
  | { type: "text"; text: string }
  | { type: "image"; source: { type: "base64"; media_type: string; data: string } }
  | { type: "document"; source: { type: "base64"; media_type: "application/pdf"; data: string } };

async function claudeRead(base64: string, mime: string): Promise<IntakeAnalysis> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY not set");
  const model = process.env.ANTHROPIC_MODEL || "claude-opus-4-8";
  const fileBlock: Block =
    mime === "application/pdf"
      ? { type: "document", source: { type: "base64", media_type: "application/pdf", data: base64 } }
      : { type: "image", source: { type: "base64", media_type: mime, data: base64 } };

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({ model, max_tokens: 1500, messages: [{ role: "user", content: [fileBlock, { type: "text", text: READ_PROMPT }] }] }),
  });
  if (!res.ok) throw new Error(`Anthropic API error ${res.status}: ${await res.text()}`);
  const data = (await res.json()) as { content?: { type: string; text?: string }[] };
  const text = data.content?.map((c) => c.text ?? "").join("") ?? "";
  const raw = extractJson(text);
  const fieldsRaw = (raw.fields ?? {}) as Record<string, unknown>;
  const fields: Record<string, string> = {};
  for (const [k, v] of Object.entries(fieldsRaw)) {
    const s = v == null ? "" : String(v).trim();
    if (s && s.toLowerCase() !== "null") fields[k] = s;
  }
  return {
    kind: String(raw.kind ?? "other").trim() || "other",
    title: String(raw.title ?? "Document").trim() || "Document",
    summary: String(raw.summary ?? "").trim(),
    fields,
    source: "claude",
  };
}

function mockRead(fileName: string): IntakeAnalysis {
  const lower = fileName.toLowerCase();
  const kind = /insur|policy|progressive|geico/.test(lower) ? "vehicle_insurance"
    : /regist|tag|plate/.test(lower) ? "vehicle_registration"
    : /title/.test(lower) ? "vehicle_title"
    : /mbr|board\s*report/.test(lower) ? "mbr"
    : /invoice|bill|univar|veseris/.test(lower) ? "invoice"
    : "other";
  return {
    kind,
    title: fileName.replace(/\.[a-z0-9]+$/i, "").slice(0, 60) || "Document",
    summary: "Reader not configured — set ANTHROPIC_API_KEY for automatic reading. Tell me what this is and where it should go.",
    fields: {},
    source: "mock",
  };
}

export async function analyzeIntake(base64: string, mime: string, fileName: string): Promise<IntakeAnalysis> {
  if (!process.env.ANTHROPIC_API_KEY) return mockRead(fileName);
  return claudeRead(base64, mime);
}

// ---- Suggested destination + prefilled params ------------------------------
export type RouteParams = Record<string, string | boolean | null>;
export type Suggestion = { destination: DestinationKey; params: RouteParams; vehicleLabel?: string | null; confidence?: string | null };

function branchKeyFromHint(hint?: string): string | null {
  const h = (hint ?? "").toLowerCase();
  if (!h) return null;
  if (h.includes("vero")) return "vero";
  if (h.includes("stuart")) return "stuart";
  if (h.includes("orlando")) return "orlando";
  if (h.includes("naples")) return "naples";
  return null;
}

/** Best-guess destination from the analysis, with a matched vehicle where we can. */
export async function suggestDestination(a: IntakeAnalysis): Promise<Suggestion> {
  const f = a.fields;
  if (a.kind === "mbr") {
    return { destination: "mbr_handoff", params: { period: f.period ?? null } };
  }
  if (a.kind.startsWith("vehicle_")) {
    const category = a.kind === "vehicle_insurance" ? "insurance"
      : a.kind === "vehicle_registration" ? "registration"
      : a.kind === "vehicle_title" ? "title"
      : a.kind === "vehicle_inspection" ? "inspection" : "other";
    const vehicles = await prisma.vehicle.findMany({
      where: { status: "active" },
      select: { id: true, unitNumber: true, name: true, plate: true, vin: true, make: true, model: true, assignedTo: true, branch: true },
    });
    const match = matchDocVehicle({ vehicleHint: f.vehicle_hint ?? null, driverHint: f.driver_hint ?? null }, vehicles);
    const v = match ? vehicles.find((x) => x.id === match.id) ?? null : null;
    return {
      destination: "vehicle_document",
      confidence: match?.confidence ?? null,
      vehicleLabel: v ? `${v.unitNumber ? `#${v.unitNumber} · ` : ""}${v.name}${v.assignedTo ? ` (${v.assignedTo})` : ""}` : null,
      params: {
        vehicleId: match?.id ?? null,
        category,
        title: a.title,
        insurer: f.vendor ?? null,
        policyNumber: f.doc_number ?? null,
        effectiveDate: f.effective_date ?? null,
        expirationDate: f.expiration_date ?? null,
        remindHr: true,
      },
    };
  }
  // A distributor invoice/bill → hand off to Check-In (lines staged for review +
  // Confirm). It never posts stock here; the manager can still choose to file it
  // as a plain record instead.
  if (a.kind === "invoice") {
    return {
      destination: "inventory_checkin",
      params: { distributor: f.vendor ?? null, invoiceNumber: f.doc_number ?? null, invoiceDate: f.effective_date ?? null },
    };
  }
  // Everything else → file here with tags (never auto-touch inventory).
  const branch = branchKeyFromHint(f.branch_hint);
  const tags = [a.kind !== "other" ? a.kind : null, f.vendor ?? null].filter(Boolean).join(", ");
  return { destination: "general_file", params: { branch, title: a.title, tags: tags || null, notes: null } };
}

// ---- Executors (run after the human approves the proposal) -----------------
export type ExecResult = { ref: string | null; label: string; redirect?: string };

export async function execVehicleDocument(doc: { id: string; fileName: string | null; filePath: string | null; mimeType: string | null; fileSize: number | null; aiSummary: string | null }, p: RouteParams, user: { id: string; name: string }): Promise<ExecResult> {
  const vehicleId = str(p.vehicleId);
  if (!vehicleId) throw new Error("Choose which vehicle this belongs to.");
  const vehicle = await prisma.vehicle.findUnique({ where: { id: vehicleId }, select: { id: true, unitNumber: true, name: true } });
  if (!vehicle) throw new Error("That vehicle no longer exists.");
  const category = str(p.category) ?? "other";
  const expirationDate = dateOf(p.expirationDate);
  const created = await prisma.vehicleDocument.create({
    data: {
      vehicleId, category, title: str(p.title) ?? "Document",
      fileName: doc.fileName ?? "document", filePath: doc.filePath, fileSize: doc.fileSize, mimeType: doc.mimeType,
      insurer: str(p.insurer), policyNumber: str(p.policyNumber),
      effectiveDate: dateOf(p.effectiveDate), expirationDate,
      aiSummary: doc.aiSummary, aiSuggestedVehicleId: vehicleId, aiSuggestedCategory: category,
      remindHr: p.remindHr !== false, status: "filed",
      uploadedByUserId: user.id, uploadedByName: user.name,
    },
  });
  if (category === "registration" && expirationDate) {
    await prisma.vehicle.update({ where: { id: vehicleId }, data: { registrationRenewal: expirationDate } });
  }
  const label = `Vehicle ${vehicle.unitNumber ? `#${vehicle.unitNumber}` : vehicle.name}`;
  return { ref: created.id, label, redirect: `/fleet/${vehicleId}` };
}

export async function execBranchDocument(doc: { fileName: string | null; filePath: string | null; mimeType: string | null; fileSize: number | null }, p: RouteParams, user: { name: string }): Promise<ExecResult> {
  const branch = str(p.branch);
  if (!branch || !BRANCHES.includes(branch as (typeof BRANCHES)[number])) throw new Error("Choose a branch.");
  const CATS = new Set(["licensing", "lease", "other"]);
  const category = CATS.has(String(p.category)) ? String(p.category) : "other";
  const created = await prisma.branchDocument.create({
    data: {
      branch, category, title: str(p.title) ?? "Document",
      fileName: doc.fileName, filePath: doc.filePath, mimeType: doc.mimeType, fileSize: doc.fileSize,
      issueDate: dateOf(p.effectiveDate), expirationDate: dateOf(p.expirationDate),
      notes: str(p.notes), uploadedByName: user.name,
    },
  });
  return { ref: created.id, label: `Branch · ${branch}`, redirect: "/management/documents" };
}

export function execMbrHandoff(): ExecResult {
  // We never overwrite financials on our own — hand the manager to the MBR
  // reader to extract and confirm.
  return { ref: null, label: "MBR review", redirect: "/management/upload" };
}

// File types the invoice reader can parse. Mirrors the Check-In parse route.
const INVOICE_READABLE = ["application/pdf", "image/jpeg", "image/png", "image/webp"];

export async function execInventoryCheckin(
  doc: { id: string; filePath: string | null; mimeType: string | null },
  user: { id: string }
): Promise<ExecResult> {
  // HAND-OFF ONLY. We never post stock movements here — on-hand changes solely
  // through POST /api/check-in/confirm. We re-read the stored invoice, parse it
  // with the invoice reader, stage the lines as a CheckInDraft, and send the
  // manager to the Check-In screen to review (and chat-edit) before Confirm.
  let parsed: Awaited<ReturnType<typeof parseInvoice>> | null = null;
  const mime = doc.mimeType || "application/pdf";
  if (doc.filePath && INVOICE_READABLE.includes(mime)) {
    const bytes = await readUpload(doc.filePath);
    if (bytes) {
      try {
        parsed = await parseInvoice(bytes.toString("base64"), mime);
      } catch {
        parsed = null; // couldn't read it — stage an empty draft to fill by hand
      }
    }
  }
  const draft = await prisma.checkInDraft.create({
    data: {
      distributor: parsed?.distributor ?? null,
      invoiceNumber: parsed?.invoiceNumber ?? null,
      invoiceDate: parsed?.invoiceDate ?? null,
      subtotal: parsed?.subtotal ?? null,
      total: parsed?.total ?? null,
      lines: JSON.stringify(parsed?.lines ?? []),
      filePath: doc.filePath,
      source: "intake",
      intakeDocId: doc.id,
      createdByUserId: user.id,
    },
  });
  return { ref: draft.id, label: "Check-In", redirect: `/check-in?draft=${draft.id}` };
}

export function execGeneralFile(p: RouteParams): ExecResult {
  const branch = str(p.branch);
  return { ref: null, label: branch ? `Filed · ${branch}` : "Filed in intake", redirect: "/management/intake" };
}

// ---- Queries ---------------------------------------------------------------
export async function recentIntake(limit = 20) {
  return prisma.intakeDocument.findMany({ orderBy: { createdAt: "desc" }, take: limit });
}

// ---- helpers ---------------------------------------------------------------
function extractJson(text: string): Record<string, unknown> {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = fenced ? fenced[1] : text;
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start === -1 || end === -1) throw new Error("No JSON found in response");
  return JSON.parse(candidate.slice(start, end + 1));
}
function str(v: unknown): string | null {
  const s = v == null ? "" : String(v).trim();
  return s === "" || s.toLowerCase() === "null" ? null : s;
}
function dateOf(v: unknown): Date | null {
  const t = str(v);
  if (!t) return null;
  const d = new Date(t.length <= 10 ? `${t}T00:00:00Z` : t);
  return isNaN(d.getTime()) ? null : d;
}
