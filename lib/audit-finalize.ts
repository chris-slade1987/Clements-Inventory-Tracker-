import { randomBytes } from "crypto";
import { prisma } from "@/lib/prisma";
import { branchLabel } from "@/lib/management";
import { sendEmail } from "@/lib/email";
import { auditTitle, managerEmployeeForBranch, fieldOpsEmployee } from "@/lib/audit";

// Server-only audit completion: signing-token mint + the finalize/filing that
// touches email. Split out of lib/audit.ts so the pure constants there can be
// imported by client components without pulling in the email/Google stack.

export function newSignToken(): string {
  return randomBytes(24).toString("base64url");
}

/** A short text body for the filed personnel record. */
function auditRecordBody(a: { year: number; quarter: number; branch: string; scorePct: number; auditorName: string | null; managerSignedName: string | null; visitDate: Date }, auditId: string): string {
  return [
    `${auditTitle(a)} — compliance score ${a.scorePct}%.`,
    `Visit ${a.visitDate.toLocaleDateString("en-US", { timeZone: "UTC" })}.`,
    `Conducted by ${a.auditorName ?? "Director of Field Ops"}; acknowledged by ${a.managerSignedName ?? "the branch manager"}.`,
    `Signed form: /management/audits/${auditId}`,
  ].join(" ");
}

/** Idempotently file the signed audit as a personnel record on one profile. */
async function fileAuditRecord(employeeId: string, branch: string, auditId: string, title: string, body: string, actorName: string, category: "branch_audit" | "field_ops_audit") {
  const details = JSON.stringify({ auditId, viewPath: `/management/audits/${auditId}` });
  const existing = await prisma.personnelRecord.findFirst({ where: { employeeId, category, details: { contains: auditId } }, select: { id: true } });
  if (existing) {
    await prisma.personnelRecord.update({ where: { id: existing.id }, data: { title, body, details, branch } });
    return existing.id;
  }
  const rec = await prisma.personnelRecord.create({ data: { employeeId, branch, type: "note", category, title, body, details, authorName: actorName } });
  return rec.id;
}

/**
 * Second signature received — complete the audit: mark signed, stamp filedAt,
 * and file the signed form to the branch manager's profile, the Director of
 * Field Ops' profile (quarterly-responsibility credit), and — via the signed
 * status — the Branch Hub. Notifies leadership. Idempotent per audit.
 */
export async function finalizeAudit(auditId: string, actorName: string) {
  const audit = await prisma.branchAudit.findUnique({ where: { id: auditId } });
  if (!audit) return { error: "Audit not found." };

  const title = auditTitle(audit);
  const body = auditRecordBody(audit, audit.id);

  const mgr = audit.managerEmployeeId
    ? await prisma.employee.findUnique({ where: { id: audit.managerEmployeeId }, select: { id: true, name: true } })
    : await managerEmployeeForBranch(audit.branch);
  const auditor = audit.auditorEmployeeId
    ? await prisma.employee.findUnique({ where: { id: audit.auditorEmployeeId }, select: { id: true, name: true } })
    : await fieldOpsEmployee();

  if (mgr) await fileAuditRecord(mgr.id, audit.branch, audit.id, title, body, actorName, "branch_audit");
  if (auditor) await fileAuditRecord(auditor.id, audit.branch, audit.id, `Conducted: ${title}`, body, actorName, "field_ops_audit");

  await prisma.branchAudit.update({
    where: { id: audit.id },
    data: {
      status: "signed",
      filedAt: new Date(),
      managerEmployeeId: audit.managerEmployeeId ?? mgr?.id ?? null,
      auditorEmployeeId: audit.auditorEmployeeId ?? auditor?.id ?? null,
    },
  });

  // Notify leadership that the audit is complete + filed (admins + auditor).
  const label = branchLabel(audit.branch);
  const admins = await prisma.user.findMany({ where: { role: "admin" }, select: { email: true } });
  const to = [...admins.map((a) => a.email), process.env.FIELD_OPS_EMAIL || "gfoster@clementspestcontrol.com"].filter(Boolean) as string[];
  await sendEmail({
    to,
    kind: "audit_signed",
    relatedType: "branch_audit",
    relatedId: audit.id,
    subject: `Q${audit.quarter} ${audit.year} Branch Audit signed & filed — ${label} (${audit.scorePct}%)`,
    text: `The Q${audit.quarter} ${audit.year} field-operations audit for ${label} is complete and signed.\n\nConducted by ${audit.auditorName ?? "the Director of Field Ops"} and acknowledged by ${audit.managerSignedName ?? mgr?.name ?? "the branch manager"}.\nBranch compliance score: ${audit.scorePct}%.\n\nFiled to the Branch Hub${mgr ? `, ${mgr.name}'s profile` : ""}${auditor ? `, and ${auditor.name}'s profile (quarterly responsibility credit)` : ""}.\n\n— CanopyOS`,
    html: `<p>The <strong>Q${audit.quarter} ${audit.year}</strong> field-operations audit for <strong>${label}</strong> is complete and signed.</p><p>Conducted by ${audit.auditorName ?? "the Director of Field Ops"} and acknowledged by ${audit.managerSignedName ?? mgr?.name ?? "the branch manager"}.<br/>Branch compliance score: <strong>${audit.scorePct}%</strong>.</p><p>Filed to the Branch Hub${mgr ? `, ${mgr.name}'s profile` : ""}${auditor ? `, and ${auditor.name}'s profile (quarterly responsibility credit)` : ""}.</p><p>— CanopyOS</p>`,
  }).catch(() => null);

  return { ok: true, filedManager: !!mgr, filedAuditor: !!auditor };
}
