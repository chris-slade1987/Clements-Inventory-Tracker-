import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { signatureRoles } from "@/lib/personnel";

export const runtime = "nodejs";

// Public token-based signing — no login. The unguessable token is the capability.
export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const token = typeof body?.token === "string" ? body.token : "";
  const signerName = typeof body?.signerName === "string" ? body.signerName.trim() : "";
  const agree = body?.agree === true;
  if (!token) return NextResponse.json({ error: "Invalid link." }, { status: 400 });
  if (!signerName) return NextResponse.json({ error: "Type your full name to sign." }, { status: 400 });
  if (!agree) return NextResponse.json({ error: "You must agree to the statement to sign." }, { status: 400 });

  const request = await prisma.signatureRequest.findUnique({ where: { token }, include: { record: true } });
  if (!request) return NextResponse.json({ error: "This link is not valid." }, { status: 404 });
  if (request.signedAt) return NextResponse.json({ error: "This has already been signed." }, { status: 409 });

  const roleDef = signatureRoles(request.record.type).find((r) => r.key === request.role);

  try {
    if (request.role !== "witness") await prisma.personnelSignature.deleteMany({ where: { recordId: request.recordId, role: request.role } });
    await prisma.personnelSignature.create({
      data: { recordId: request.recordId, role: request.role, signerName, statement: roleDef?.statement ?? null },
    });
    await prisma.signatureRequest.update({ where: { id: request.id }, data: { signedAt: new Date(), signerName } });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
