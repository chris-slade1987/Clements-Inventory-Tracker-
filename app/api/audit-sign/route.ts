import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { finalizeAudit } from "@/lib/audit-finalize";

export const runtime = "nodejs";
export const maxDuration = 20;

// PUBLIC branch-manager signature endpoint. The manager reaches this via the
// tokenized link emailed when the Director of Field Ops signs — no login. Records
// the manager's typed signature and (second signature now present) finalizes the
// audit: file to the Branch Hub + both profiles, credit the auditor, notify.
export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const token = typeof body?.token === "string" ? body.token : "";
  const typedName = typeof body?.typedName === "string" ? body.typedName.trim() : "";
  const title = typeof body?.title === "string" && body.title.trim() ? body.title.trim() : "Branch Manager";
  if (!token) return NextResponse.json({ error: "Missing token." }, { status: 400 });
  if (!typedName) return NextResponse.json({ error: "Type your full name to sign." }, { status: 400 });

  const audit = await prisma.branchAudit.findUnique({ where: { managerSignToken: token } });
  if (!audit) return NextResponse.json({ error: "This signing link is not valid." }, { status: 404 });
  if (audit.status === "signed" || audit.managerSignedAt)
    return NextResponse.json({ error: "This audit is already signed and on file." }, { status: 409 });

  // Record the signature + consume the token so the link can't be reused.
  await prisma.branchAudit.update({
    where: { id: audit.id },
    data: { managerSignedName: typedName, managerSignedTitle: title, managerSignedAt: new Date(), managerSignToken: null },
  });

  const r = await finalizeAudit(audit.id, typedName).catch((e) => ({ error: String(e) }));
  if ((r as { error?: string }).error)
    return NextResponse.json({ ok: true, warning: "Signed, but filing failed — an admin will finalize." }, { status: 200 });
  return NextResponse.json({ ok: true });
}
