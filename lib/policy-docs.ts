import { randomBytes } from "node:crypto";
import { prisma } from "@/lib/prisma";

// Document center helpers. The Employee Handbook (slug "employee-handbook") is
// readable by everyone and requires a typed-signature acknowledgment; the
// Manager Operating Manual (slug "manager-manual") is a manager-only read-only
// reference. Acknowledgments are append-only — we never update or delete one.

export const HANDBOOK_SLUG = "employee-handbook";
export const MANUAL_SLUG = "manager-manual";

export type AckSource = "onboarding" | "link" | "in_app";

export function getDocument(slug: string) {
  return prisma.policyDocument.findUnique({ where: { slug } });
}

/** Most recent acknowledgment a logged-in user has made for a document. */
export async function latestAckForUser(documentId: string, userId: string) {
  return prisma.documentAcknowledgment.findFirst({
    where: { documentId, userId },
    orderBy: { acknowledgedAt: "desc" },
  });
}

/** Most recent acknowledgment tied to an employee profile (onboarding / link). */
export async function latestAckForEmployee(documentId: string, employeeId: string) {
  return prisma.documentAcknowledgment.findFirst({
    where: { documentId, employeeId },
    orderBy: { acknowledgedAt: "desc" },
  });
}

/**
 * Record an in-app acknowledgment for the CURRENT version of a document by a
 * logged-in user. Idempotent-ish: if they already acknowledged this exact
 * version we return the existing row instead of stacking duplicates.
 */
export async function recordInAppAck(opts: {
  slug: string;
  userId: string;
  employeeId?: string | null;
  signedName: string;
  email?: string | null;
}) {
  const doc = await getDocument(opts.slug);
  if (!doc) throw new Error("Document not found.");
  const name = opts.signedName.trim();
  if (!name) throw new Error("Type your full name to acknowledge.");

  const existing = await prisma.documentAcknowledgment.findFirst({
    where: { documentId: doc.id, version: doc.version, userId: opts.userId },
  });
  if (existing) return { doc, ack: existing, already: true };

  const ack = await prisma.documentAcknowledgment.create({
    data: {
      documentId: doc.id,
      version: doc.version,
      userId: opts.userId,
      employeeId: opts.employeeId ?? null,
      signedName: name,
      email: opts.email ?? null,
      source: "in_app",
    },
  });
  return { doc, ack, already: false };
}

/** Generate a login-free, per-employee acknowledgment link for a document. */
export async function generateAckToken(slug: string, employeeId: string, name: string | null) {
  const doc = await getDocument(slug);
  if (!doc) throw new Error("Document not found.");
  const token = randomBytes(24).toString("hex"); // 48 hex chars
  const rec = await prisma.documentAckToken.create({
    data: { token, documentId: doc.id, employeeId, name },
  });
  return { token: rec.token, document: doc };
}

/** Look up a token + its document (for the public signing page). */
export async function ackTokenWithDoc(token: string) {
  return prisma.documentAckToken.findUnique({ where: { token }, include: { document: true } });
}

/**
 * Consume a token: record a typed-signature acknowledgment (source "link" or
 * "onboarding") and mark the token used. Rejects a token that was already used.
 */
export async function recordTokenAck(opts: { token: string; signedName: string; source: AckSource; email?: string | null }) {
  const name = opts.signedName.trim();
  if (!name) throw new Error("Type your full name to acknowledge.");
  const rec = await prisma.documentAckToken.findUnique({ where: { token: opts.token }, include: { document: true } });
  if (!rec) throw new Error("This link is not valid.");
  if (rec.usedAt) throw new Error("This acknowledgment has already been completed.");

  const ack = await prisma.documentAcknowledgment.create({
    data: {
      documentId: rec.documentId,
      version: rec.document.version,
      employeeId: rec.employeeId,
      signedName: name,
      email: opts.email ?? null,
      source: opts.source,
    },
  });
  await prisma.documentAckToken.update({ where: { id: rec.id }, data: { usedAt: new Date() } });
  return { ack, document: rec.document };
}

/**
 * Record an onboarding acknowledgment for a new hire (no login). Called when a
 * pre-hire completes the handbook step. Attributed to the employee profile once
 * one exists; before conversion we still capture the typed name + email.
 */
export async function recordOnboardingAck(opts: { slug: string; signedName: string; employeeId?: string | null; email?: string | null }) {
  const doc = await getDocument(opts.slug);
  if (!doc) throw new Error("Document not found.");
  const name = opts.signedName.trim();
  if (!name) throw new Error("Type your full name to acknowledge.");
  const ack = await prisma.documentAcknowledgment.create({
    data: {
      documentId: doc.id,
      version: doc.version,
      employeeId: opts.employeeId ?? null,
      signedName: name,
      email: opts.email ?? null,
      source: "onboarding",
    },
  });
  return { doc, ack };
}

export type RosterRow = {
  employeeId: string;
  name: string;
  branch: string | null;
  email: string | null;
  acknowledged: boolean;
  acknowledgedAt: Date | null;
  signedName: string | null;
  source: string | null;
  version: number | null;
};

/**
 * HR roster: for the CURRENT handbook version, which active employees have
 * acknowledged and which are still outstanding. An employee counts as
 * acknowledged if there is an ack for the current version tied to their employee
 * profile OR to their linked login (userId).
 */
export async function handbookAckRoster(): Promise<{ version: number; rows: RosterRow[] }> {
  const doc = await getDocument(HANDBOOK_SLUG);
  if (!doc) return { version: 0, rows: [] };

  const [employees, acks] = await Promise.all([
    prisma.employee.findMany({
      where: { status: "active" },
      select: { id: true, name: true, branch: true, email: true, user: { select: { id: true } } },
      orderBy: [{ branch: "asc" }, { name: "asc" }],
    }),
    prisma.documentAcknowledgment.findMany({
      where: { documentId: doc.id, version: doc.version },
      orderBy: { acknowledgedAt: "desc" },
    }),
  ]);

  const byEmployee = new Map<string, (typeof acks)[number]>();
  const byUser = new Map<string, (typeof acks)[number]>();
  for (const a of acks) {
    if (a.employeeId && !byEmployee.has(a.employeeId)) byEmployee.set(a.employeeId, a);
    if (a.userId && !byUser.has(a.userId)) byUser.set(a.userId, a);
  }

  const rows: RosterRow[] = employees.map((e) => {
    const ack = byEmployee.get(e.id) ?? (e.user ? byUser.get(e.user.id) : undefined) ?? null;
    return {
      employeeId: e.id,
      name: e.name,
      branch: e.branch,
      email: e.email,
      acknowledged: !!ack,
      acknowledgedAt: ack?.acknowledgedAt ?? null,
      signedName: ack?.signedName ?? null,
      source: ack?.source ?? null,
      version: ack?.version ?? null,
    };
  });
  return { version: doc.version, rows };
}
