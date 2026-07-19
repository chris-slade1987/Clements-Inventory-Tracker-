import { NextResponse } from "next/server";
import { saveStep, submitPreHire } from "@/lib/prehire";

export const runtime = "nodejs";

// PUBLIC — no login. The random token IS the credential. Editing is only
// allowed while the packet is still invited / in_progress; once submitted or
// approved, further writes are rejected.

export async function POST(req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const body = await req.json().catch(() => null);
  const action = typeof body?.action === "string" ? body.action : "";

  try {
    if (action === "save") {
      const stepKey = typeof body?.stepKey === "string" ? body.stepKey : "";
      const data = (body?.data && typeof body.data === "object") ? body.data : {};
      const pre = await saveStep(token, stepKey, data);
      return NextResponse.json({ ok: true, currentStep: pre.currentStep, status: pre.status });
    }

    if (action === "submit") {
      const pre = await submitPreHire(token);
      return NextResponse.json({ ok: true, status: pre.status });
    }

    return NextResponse.json({ error: "Unknown action." }, { status: 400 });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
