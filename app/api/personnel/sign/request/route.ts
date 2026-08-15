import { NextResponse } from "next/server";
import { randomBytes } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { getSessionUser, branchLocked } from "@/lib/auth";
import { signatureRoles, recordTypeLabel } from "@/lib/personnel";
import { sendEmail } from "@/lib/email";

export const runtime = "nodejs";
export const maxDuration = 20;

const str = (v: unknown) => { const s = typeof v === "string" ? v.trim() : ""; return s === "" ? null : s; };
const base = () => process.env.APP_URL || process.env.NEXT_PUBLIC_APP_URL || "";

export async function POST(req: Request) {
  const user = await getSessionUser();
  if (!user || (user.role !== "admin" && user.role !== "manager"))
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = await req.json().catch(() => null);
  const recordId = str(body?.recordId);
  const role = str(body?.role);
  const email = str(body?.email)?.toLowerCase();
  if (!recordId || !role || !email) return NextResponse.json({ error: "Signer email is required." }, { status: 400 });

  const record = await prisma.personnelRecord.findUnique({ where: { id: recordId }, include: { employee: { select: { name: true, branch: true } } } });
  if (!record) return NextResponse.json({ error: "Record not found." }, { status: 404 });
  if (branchLocked(user) && record.employee.branch !== user.branch)
    return NextResponse.json({ error: "Not your branch." }, { status: 403 });

  const roleDef = signatureRoles(record.type).find((r) => r.key === role);
  if (!roleDef) return NextResponse.json({ error: "Invalid role." }, { status: 400 });

  // One active request per record+role: refresh the token/email if resending.
  await prisma.signatureRequest.deleteMany({ where: { recordId, role, signedAt: null } });
  const token = randomBytes(24).toString("hex");
  await prisma.signatureRequest.create({ data: { recordId, role, token, email, createdById: user.id } });

  const label = recordTypeLabel(record.type);
  const link = `${base()}/sign/${token}`;
  const res = await sendEmail({
    to: email,
    subject: `Signature needed: ${label} for ${record.employee.name}`,
    kind: "signature_request",
    relatedType: "personnel_record",
    relatedId: recordId,
    text: `You have a ${label.toLowerCase()} to review and sign as "${roleDef.label}".\n\nReview and e-sign here: ${link}\n\nPlease sign within 24 hours. You'll receive daily reminders until it's signed.\n\n— CanopyOS`,
    html: `<p>You have a <strong>${label.toLowerCase()}</strong> to review and sign as <strong>${roleDef.label}</strong>.</p><p><a href="${link}">Review &amp; e-sign →</a></p><p>Please sign within 24 hours. You'll receive daily reminders until it's signed.</p><p>— CanopyOS</p>`,
  });

  return NextResponse.json({ ok: true, emailStatus: res.status, link });
}
