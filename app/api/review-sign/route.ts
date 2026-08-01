import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getHrEmail } from "@/lib/personnel";
import { REVIEW_LABEL } from "@/lib/review";
import { branchLabel } from "@/lib/management";
import { sendEmail } from "@/lib/email";

export const runtime = "nodejs";

const base = () => process.env.APP_URL || process.env.NEXT_PUBLIC_APP_URL || "";

// Public, token-based employee signing for a new-hire review — no login. The
// unguessable token is the capability. Only the employee signature is captured
// here; if the reviewer has already signed, it hands off to HR for approval.
export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const token = typeof body?.token === "string" ? body.token : "";
  const signerName = typeof body?.signerName === "string" ? body.signerName.trim() : "";
  const agree = body?.agree === true;
  if (!token) return NextResponse.json({ error: "Invalid link." }, { status: 400 });
  if (!signerName) return NextResponse.json({ error: "Type your full name to sign." }, { status: 400 });
  if (!agree) return NextResponse.json({ error: "You must agree to the statement to sign." }, { status: 400 });

  const review = await prisma.newHireReview.findUnique({
    where: { employeeToken: token },
    include: { employee: { select: { name: true, branch: true } } },
  });
  if (!review) return NextResponse.json({ error: "This link is not valid." }, { status: 404 });
  if (review.employeeSignedAt) return NextResponse.json({ error: "You have already signed this review." }, { status: 409 });

  try {
    await prisma.newHireReview.update({ where: { id: review.id }, data: { employeeSignedName: signerName, employeeSignedAt: new Date() } });

    const fresh = await prisma.newHireReview.findUnique({ where: { id: review.id } });
    if (fresh && fresh.reviewerSignedAt && fresh.employeeSignedAt && fresh.status !== "pending_approval" && fresh.status !== "completed") {
      await prisma.newHireReview.update({ where: { id: review.id }, data: { status: "pending_approval" } });
      const label = REVIEW_LABEL[review.type] ?? "review";
      const b = review.branch ? ` (${branchLabel(review.branch)})` : "";
      await sendEmail({
        to: await getHrEmail(),
        subject: `Ready for approval: ${review.employee.name}'s ${label}`,
        kind: "review_pending_approval",
        relatedType: "newhire_review",
        relatedId: review.id,
        text: `${review.employee.name}${b} and their reviewer have both signed the ${label}. Please review and give final approval:\n${base()}/reviews/${review.id}\n\n— Canopy OS`,
        html: `<p><strong>${review.employee.name}</strong>${b} and their reviewer have both signed the <strong>${label}</strong>.</p><p><a href="${base()}/reviews/${review.id}">Review &amp; give final approval →</a></p><p>— Canopy OS</p>`,
      });
    }
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
