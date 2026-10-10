import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { fail } from "@/lib/http";
import { EXIT_INTERNAL_KEYS, parseJson } from "@/lib/separation";

export const runtime = "nodejs";
export const maxDuration = 20;

// PUBLIC (no login): a former employee submits their exit interview via the
// tokenized link emailed to their personal address. Validated only by the
// unguessable token. HR-internal answers are never accepted here.
export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => null);
    const token = typeof body?.token === "string" ? body.token : "";
    if (!token) return NextResponse.json({ error: "Missing token." }, { status: 400 });

    const sep = await prisma.employeeSeparation.findUnique({ where: { exitToken: token } });
    if (!sep) return NextResponse.json({ error: "This link is not valid or has expired." }, { status: 404 });
    if (sep.exitStatus === "completed")
      return NextResponse.json({ error: "This exit interview has already been submitted." }, { status: 409 });

    const incoming = body?.responses && typeof body.responses === "object" ? (body.responses as Record<string, unknown>) : {};
    // Preserve HR's internal fields; accept only non-internal answers from the submitter.
    const merged = parseJson<Record<string, string>>(sep.exitResponses, {});
    for (const [k, v] of Object.entries(incoming)) {
      if (EXIT_INTERNAL_KEYS.includes(k)) continue;
      merged[k] = String(v ?? "");
    }

    await prisma.employeeSeparation.update({
      where: { exitToken: token },
      data: {
        exitResponses: JSON.stringify(merged),
        exitStatus: "completed",
        exitInterviewAt: new Date(),
        exitInterviewBy: "Former employee (self-serve)",
      },
    });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return fail(e);
  }
}
