import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { finalizeScorecard } from "@/lib/scorecard";

export const runtime = "nodejs";
export const maxDuration = 20;

// PUBLIC manager-signature endpoint. The manager reaches this via the tokenized
// link emailed at publish time — no login required. Validates the token, records
// the manager's typed signature, and (both signatures now present) completes the
// scorecard: score, file to the profile + branch hub, notify HR to pay the bonus.
export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const token = typeof body?.token === "string" ? body.token : "";
  const typedName = typeof body?.typedName === "string" ? body.typedName.trim() : "";
  const title = typeof body?.title === "string" && body.title.trim() ? body.title.trim() : "Branch Manager";
  if (!token) return NextResponse.json({ error: "Missing token." }, { status: 400 });
  if (!typedName) return NextResponse.json({ error: "Type your full name to sign." }, { status: 400 });

  const review = await prisma.scorecardReview.findUnique({ where: { signToken: token }, include: { signatures: true } });
  if (!review) return NextResponse.json({ error: "This signing link is not valid." }, { status: 404 });
  if (review.status === "archived") return NextResponse.json({ error: "This scorecard is already complete and signed." }, { status: 409 });
  if (review.signatures.some((s) => s.role === "manager"))
    return NextResponse.json({ error: "A manager signature is already on file for this scorecard." }, { status: 409 });

  await prisma.scorecardSignature.create({ data: { reviewId: review.id, role: "manager", typedName, title } });
  // Consume the token so the link can't be reused, then complete.
  await prisma.scorecardReview.update({ where: { id: review.id }, data: { signToken: null } });
  const r = await finalizeScorecard(review.id, typedName).catch((e) => ({ error: String(e) }));
  if ((r as { error?: string }).error) return NextResponse.json({ error: "Signed, but completion failed — an admin will finalize." }, { status: 200 });
  return NextResponse.json({ ok: true, ...r });
}
