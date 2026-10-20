import { appUrl } from "@/lib/app-url";
import { fail } from "@/lib/http";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getHrEmail } from "@/lib/personnel";
import {
  REVIEW_LABEL,
  getReviewForm,
  templateForEmployee,
  parseResponses,
  incompleteQuestionsForRole,
  ownedKeys,
} from "@/lib/review";
import { branchLabel } from "@/lib/management";
import { sendEmail } from "@/lib/email";

export const runtime = "nodejs";
export const maxDuration = 20;

const base = () => appUrl();

// Public, token-based employee flow for a new-hire review — no login. The
// unguessable token is the capability. The reviewee can SAVE their own answers
// and then SIGN here; only the employee-owned questions are writable from this
// surface, and only the employee signature is captured. If the reviewer has
// already signed, signing hands off to HR for approval.
export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const token = typeof body?.token === "string" ? body.token : "";
  const action = typeof body?.action === "string" ? body.action : "sign";
  if (!token) return NextResponse.json({ error: "Invalid link." }, { status: 400 });

  const review = await prisma.newHireReview.findUnique({
    where: { employeeToken: token },
    include: {
      employee: {
        select: { name: true, branch: true, role: true, title: true, user: { select: { accessLevel: true } } },
      },
    },
  });
  if (!review) return NextResponse.json({ error: "This link is not valid." }, { status: 404 });

  const resolvedTemplate = review.template ?? templateForEmployee(review.employee) ?? "technician";
  const form = getReviewForm(resolvedTemplate, review.type);

  try {
    // ---- save: the reviewee fills in their own (employee-owned) questions ------
    if (action === "save") {
      if (review.employeeSignedAt)
        return NextResponse.json({ error: "You have already signed this review; answers are locked." }, { status: 409 });
      const incoming = body?.responses && typeof body.responses === "object" ? (body.responses as Record<string, unknown>) : {};
      // Only the employee's own questions are writable here — never the reviewer's
      // answers. Merge the allowed keys over whatever is already stored.
      const allowed = new Set(ownedKeys(form, "employee"));
      const current = parseResponses(review.responses);
      const merged = { ...current };
      for (const [k, v] of Object.entries(incoming)) {
        if (!allowed.has(k)) continue;
        merged[k] = typeof v === "string" ? v : v == null ? "" : String(v);
      }
      await prisma.newHireReview.update({
        where: { id: review.id },
        data: {
          responses: JSON.stringify(merged),
          status: review.status === "sent" || review.status === "due" ? "in_progress" : review.status,
        },
      });
      return NextResponse.json({ ok: true });
    }

    // ---- sign (default): capture the employee signature -----------------------
    const signerName = typeof body?.signerName === "string" ? body.signerName.trim() : "";
    const agree = body?.agree === true;
    if (!signerName) return NextResponse.json({ error: "Type your full name to sign." }, { status: 400 });
    if (!agree) return NextResponse.json({ error: "You must agree to the statement to sign." }, { status: 400 });
    if (review.employeeSignedAt) return NextResponse.json({ error: "You have already signed this review." }, { status: 409 });

    // Must have answered all employee-owned questions first (same rule as in-app).
    if (incompleteQuestionsForRole(form, parseResponses(review.responses), "employee").length > 0)
      return NextResponse.json({ error: "Answer all of your questions before signing." }, { status: 400 });

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
        text: `${review.employee.name}${b} and their reviewer have both signed the ${label}. Please review and give final approval:\n${base()}/reviews/${review.id}\n\n— CanopyOS`,
        html: `<p><strong>${review.employee.name}</strong>${b} and their reviewer have both signed the <strong>${label}</strong>.</p><p><a href="${base()}/reviews/${review.id}">Review &amp; give final approval →</a></p><p>— CanopyOS</p>`,
      });
    }
    return NextResponse.json({ ok: true });
  } catch (e) {
    return fail(e);
  }
}
