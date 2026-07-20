import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { recordInAppAck, recordTokenAck } from "@/lib/policy-docs";

export const runtime = "nodejs";

// Acknowledge a policy document with a typed signature. Two modes:
//   1. Token-based (no login): { token, signedName } — used by the signed-link
//      page for existing staff. Validates the token, writes a "link" ack, marks
//      the token used.
//   2. Logged-in in-app: { slug, signedName } — the reader signs from the
//      handbook page. Writes an "in_app" ack for the current version.
export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const signedName = typeof body?.signedName === "string" ? body.signedName.trim() : "";
  if (!signedName) return NextResponse.json({ error: "Type your full name to acknowledge." }, { status: 400 });

  try {
    const token = typeof body?.token === "string" ? body.token : "";
    if (token) {
      const source = body?.source === "onboarding" ? "onboarding" : "link";
      const { document, ack } = await recordTokenAck({ token, signedName, source });
      return NextResponse.json({ ok: true, version: ack.version, slug: document.slug });
    }

    const slug = typeof body?.slug === "string" ? body.slug : "";
    if (!slug) return NextResponse.json({ error: "Missing document." }, { status: 400 });
    const user = await getSessionUser();
    if (!user) return NextResponse.json({ error: "Please sign in to acknowledge." }, { status: 401 });

    const { ack, already } = await recordInAppAck({
      slug,
      userId: user.id,
      employeeId: user.employeeId,
      signedName,
      email: user.email,
    });
    return NextResponse.json({ ok: true, version: ack.version, acknowledgedAt: ack.acknowledgedAt, already });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
