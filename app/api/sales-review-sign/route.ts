import { NextResponse } from "next/server";
import { signSalesReview } from "@/lib/sales-review-store";

export const runtime = "nodejs";
export const maxDuration = 20;

// PUBLIC Sales Director signature endpoint — reached via the tokenized link
// emailed at release (no login required, same pattern as /api/scorecard-sign).
// Validates the token, records the Director's typed signature, files the review to
// their personnel record, and notifies HR + the super admins.
export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const token = typeof body?.token === "string" ? body.token : "";
  const typedName = typeof body?.typedName === "string" ? body.typedName.trim() : "";
  if (!token) return NextResponse.json({ error: "Missing token." }, { status: 400 });
  if (!typedName) return NextResponse.json({ error: "Type your full name to sign." }, { status: 400 });

  const r = await signSalesReview(token, typedName);
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.code });
  return NextResponse.json(r);
}
