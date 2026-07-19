import { randomBytes } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { parseJson } from "@/lib/inspection";
import { branchLabel } from "@/lib/management";

// ---------------------------------------------------------------------------
// Pre-hire onboarding. HR builds a candidate profile, emails a magic link, and
// the candidate completes a step-by-step wizard with NO company login. On HR
// approval the pre-hire converts into an active Employee. PRE-EMPLOYMENT ONLY —
// nothing here collects SSN, tax, or bank details (Paychex owns that post-hire).
//
// PACKET CONTENT below is intentionally easy to edit: bodies and document lists
// are placeholders marked `HR to finalize`. Swap in the real language / attach
// the real handbook PDFs when they're ready — the wizard reads straight from
// PACKET_STEPS, so nothing else changes.
// ---------------------------------------------------------------------------

export type StepKind = "form" | "consent" | "acknowledgment";

export type StepField = {
  key: string;
  label: string;
  type?: "text" | "tel";
  required?: boolean;
  half?: boolean; // render two-up on wider screens
};

export type PacketStep = {
  key: string;
  title: string;
  kind: StepKind;
  requireSignature?: boolean;
  intro?: string;
  fields?: StepField[]; // kind === "form"
  body?: string; // kind === "consent"
  note?: string; // extra context under the body
  documents?: { key: string; label: string }[]; // kind === "acknowledgment"
  consentLabel?: string; // checkbox label for consent / acknowledgment
};

export const PACKET_STEPS: PacketStep[] = [
  {
    key: "personal",
    title: "Personal & emergency contact",
    kind: "form",
    intro: "Confirm how we reach you and who to contact in an emergency. This is not payroll or tax paperwork — that's handled separately after you're hired.",
    fields: [
      { key: "homeAddress", label: "Home address", required: true },
      { key: "city", label: "City", required: true, half: true },
      { key: "state", label: "State", required: true, half: true },
      { key: "zip", label: "ZIP", required: true, half: true },
      { key: "personalPhone", label: "Personal phone", type: "tel", required: true, half: true },
      { key: "emergencyName", label: "Emergency contact name", required: true, half: true },
      { key: "emergencyRelationship", label: "Relationship", required: true, half: true },
      { key: "emergencyPhone", label: "Emergency contact phone", type: "tel", required: true, half: true },
    ],
  },
  {
    key: "drug_test",
    title: "Drug test consent",
    kind: "consent",
    requireSignature: true,
    // HR to finalize — replace with the company's approved drug-screen consent language.
    body: "As a condition of employment, Clements Pest Control requires a pre-employment drug screen. By consenting below, you authorize Clements Pest Control and its designated collection facility to collect a specimen and to release the results to Clements Pest Control for the purpose of evaluating your eligibility for employment. You understand participation is voluntary but that declining may end the hiring process.",
    note: "Where & when: HR will contact you with the collection site and a window to complete your screen (typically within 48 hours of your accepted offer). HR to finalize the facility, hours, and any instructions.",
    consentLabel: "I have read the above and I consent to a pre-employment drug screen.",
  },
  {
    key: "background",
    title: "Background check authorization",
    kind: "consent",
    requireSignature: true,
    // HR to finalize — replace with counsel-approved FCRA disclosure + authorization.
    body: "DISCLOSURE: In connection with your application for employment, Clements Pest Control may obtain a consumer report and/or investigative consumer report (a background check) about you from a consumer reporting agency. This may include information about your criminal history, driving record, and prior employment, as permitted by law.\n\nAUTHORIZATION: By signing below, you authorize Clements Pest Control to obtain such reports throughout the application process and, if hired, during your employment to the extent permitted by law. You acknowledge you have received the disclosure above.",
    note: "This disclosure and authorization are placeholders. HR to finalize the exact FCRA disclosure/authorization language and any state-specific notices with counsel before go-live.",
    consentLabel: "I have read the disclosure and I authorize the background check described above.",
  },
  {
    key: "policies",
    title: "Policy & handbook acknowledgment",
    kind: "acknowledgment",
    requireSignature: true,
    intro: "Please review and acknowledge the following. Copies will be provided for your records. HR to finalize / attach the real documents.",
    // HR to finalize — attach the real PDFs and adjust this list.
    documents: [
      { key: "safety", label: "Safety Policy (HR to attach)" },
      { key: "conduct", label: "Code of Conduct (HR to attach)" },
      { key: "handbook", label: "Employee Handbook (HR to attach)" },
    ],
    consentLabel: "I acknowledge that I have received and reviewed each document listed above.",
  },
];

export function stepByKey(key: string): PacketStep | undefined {
  return PACKET_STEPS.find((s) => s.key === key);
}

export function stepIndex(key: string): number {
  return PACKET_STEPS.findIndex((s) => s.key === key);
}

export type Signature = { signedName: string; signedAt: string; consented: true };
export type StepResponse = Record<string, unknown> & { signature?: Signature; acknowledged?: Record<string, boolean> };
export type Responses = Record<string, StepResponse>;

const STATUS_LABELS: Record<string, string> = {
  invited: "Invited",
  in_progress: "In progress",
  submitted: "Submitted — needs review",
  approved: "Approved",
  hired: "Hired",
  rejected: "Rejected",
};

export function statusLabel(s: string): string {
  return STATUS_LABELS[s] ?? s;
}

const str = (v: unknown) => {
  const s = typeof v === "string" ? v.trim() : "";
  return s === "" ? null : s;
};

// ---- HR side ---------------------------------------------------------------

export async function createPreHire(
  data: { name: string; email: string; phone?: string | null; position?: string | null; branch?: string | null; targetStart?: string | null; packet?: string | null },
  createdByName: string | null,
) {
  const token = randomBytes(24).toString("hex"); // 48 hex chars — well over 32
  return prisma.preHire.create({
    data: {
      name: data.name.trim(),
      email: (data.email ?? "").trim().toLowerCase(),
      phone: str(data.phone),
      position: str(data.position),
      branch: str(data.branch),
      targetStart: data.targetStart ? new Date(data.targetStart) : null,
      packet: str(data.packet) ?? "standard",
      token,
      createdByName,
    },
  });
}

export async function preHireByToken(token: string) {
  return prisma.preHire.findUnique({ where: { token } });
}

export async function listPreHires() {
  return prisma.preHire.findMany({ orderBy: [{ createdAt: "desc" }] });
}

// ---- Candidate side --------------------------------------------------------

/** Whether the candidate is still allowed to edit their packet. */
export function isEditable(status: string): boolean {
  return status === "invited" || status === "in_progress";
}

export async function saveStep(token: string, stepKey: string, data: StepResponse) {
  const pre = await prisma.preHire.findUnique({ where: { token } });
  if (!pre) throw new Error("Invalid link.");
  if (!isEditable(pre.status)) throw new Error("This onboarding has already been submitted.");
  const idx = stepIndex(stepKey);
  if (idx < 0) throw new Error("Unknown step.");

  const responses = parseJson<Responses>(pre.responses, {});
  responses[stepKey] = data;

  return prisma.preHire.update({
    where: { token },
    data: {
      responses: JSON.stringify(responses),
      // Advance past the step just saved (never move backwards).
      currentStep: Math.max(pre.currentStep, idx + 1),
      startedAt: pre.startedAt ?? new Date(),
      status: pre.status === "invited" ? "in_progress" : pre.status,
    },
  });
}

export async function submitPreHire(token: string) {
  const pre = await prisma.preHire.findUnique({ where: { token } });
  if (!pre) throw new Error("Invalid link.");
  if (!isEditable(pre.status)) throw new Error("This onboarding has already been submitted.");

  const responses = parseJson<Responses>(pre.responses, {});
  const missing: string[] = [];
  for (const step of PACKET_STEPS) {
    const r = responses[step.key];
    if (!r) { missing.push(step.title); continue; }
    if (step.kind === "form") {
      for (const f of step.fields ?? []) {
        if (f.required && !str(r[f.key])) { missing.push(`${step.title}: ${f.label}`); }
      }
    }
    if (step.requireSignature && !r.signature?.signedName) {
      missing.push(`${step.title}: signature`);
    }
    if (step.kind === "acknowledgment") {
      const ack = r.acknowledged ?? {};
      for (const d of step.documents ?? []) {
        if (!ack[d.key]) missing.push(`${step.title}: ${d.label}`);
      }
    }
  }
  if (missing.length) throw new Error(`Please complete: ${missing.join("; ")}`);

  return prisma.preHire.update({
    where: { token },
    data: { status: "submitted", submittedAt: new Date(), currentStep: PACKET_STEPS.length },
  });
}

// ---- Conversion ------------------------------------------------------------

/** Build the human-readable onboarding summary stored on the new Employee. */
function conversionNotes(pre: { name: string; responses: string }): string {
  const responses = parseJson<Responses>(pre.responses, {});
  const lines: string[] = ["Pre-hire onboarding completed via candidate portal."];

  const personal = responses.personal;
  if (personal) {
    const addr = [personal.homeAddress, personal.city, personal.state, personal.zip].map((v) => str(v)).filter(Boolean).join(", ");
    if (addr) lines.push(`Home address: ${addr}`);
    const emg = [str(personal.emergencyName), str(personal.emergencyRelationship), str(personal.emergencyPhone)].filter(Boolean).join(" · ");
    if (emg) lines.push(`Emergency contact: ${emg}`);
  }

  for (const step of PACKET_STEPS) {
    if (!step.requireSignature) continue;
    const sig = responses[step.key]?.signature;
    if (sig?.signedName) {
      lines.push(`${step.title}: signed by ${sig.signedName} on ${new Date(sig.signedAt).toLocaleDateString("en-US")}.`);
    }
  }
  return lines.join("\n");
}

/**
 * Approve a submitted pre-hire and convert it into an active Employee, carrying
 * over name, personal email (a company email is assigned later), phone, branch,
 * and position. Signed consents/acknowledgments are recorded on the employee's
 * notes. Returns the new employee id.
 */
export async function approveAndConvert(id: string, reviewerName: string | null): Promise<string> {
  const pre = await prisma.preHire.findUnique({ where: { id } });
  if (!pre) throw new Error("Pre-hire not found.");
  if (pre.status !== "submitted") throw new Error("Only submitted pre-hires can be approved.");

  const employee = await prisma.employee.create({
    data: {
      name: pre.name,
      email: pre.email, // personal email for now; company email assigned later
      phone: pre.phone,
      branch: pre.branch,
      role: pre.position,
      title: pre.position,
      status: "active",
      hireDate: pre.targetStart ?? new Date(),
      notes: conversionNotes(pre),
    },
  });

  await prisma.preHire.update({
    where: { id },
    data: {
      status: "hired",
      employeeId: employee.id,
      approvedAt: new Date(),
      reviewedByName: reviewerName,
    },
  });

  return employee.id;
}

export async function rejectPreHire(id: string, reviewerName: string | null) {
  return prisma.preHire.update({
    where: { id },
    data: { status: "rejected", reviewedByName: reviewerName },
  });
}

// ---- Presentation helpers --------------------------------------------------

/** A flat, ordered list of a form step's answered fields for read-only display. */
export function formRows(step: PacketStep, resp: StepResponse | undefined): { label: string; value: string }[] {
  if (!resp) return [];
  return (step.fields ?? [])
    .map((f) => ({ label: f.label, value: str(resp[f.key]) ?? "—" }))
    .filter((r) => r.value !== "—");
}

export function branchName(key: string | null | undefined): string {
  return key ? branchLabel(key) : "—";
}
