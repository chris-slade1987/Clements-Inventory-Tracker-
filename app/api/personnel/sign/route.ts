import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUser, branchLocked } from "@/lib/auth";
import { signatureRoles } from "@/lib/personnel";

export const runtime = "nodejs";

const str = (v: unknown) => { const s = typeof v === "string" ? v.trim() : ""; return s === "" ? null : s; };

export async function POST(req: Request) {
  const user = await getSessionUser();
  if (!user || (user.role !== "admin" && user.role !== "manager"))
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = await req.json().catch(() => null);
  const recordId = str(body?.recordId);
  const role = str(body?.role);
  const signerName = str(body?.signerName);
  if (!recordId || !role || !signerName)
    return NextResponse.json({ error: "Name is required to sign." }, { status: 400 });

  const record = await prisma.personnelRecord.findUnique({ where: { id: recordId }, include: { employee: { select: { branch: true } } } });
  if (!record) return NextResponse.json({ error: "Record not found." }, { status: 404 });
  if (branchLocked(user) && record.employee.branch !== user.branch)
    return NextResponse.json({ error: "Not your branch." }, { status: 403 });

  const roleDef = signatureRoles(record.type).find((r) => r.key === role);
  if (!roleDef) return NextResponse.json({ error: "Invalid signature role." }, { status: 400 });

  try {
    // One signature per role (except witness, which allows multiple).
    if (role !== "witness") await prisma.personnelSignature.deleteMany({ where: { recordId, role } });
    await prisma.personnelSignature.create({
      data: { recordId, role, signerName, statement: roleDef.statement, signedByUserId: user.id },
    });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
