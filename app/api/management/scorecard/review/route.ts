import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUser, branchLocked } from "@/lib/auth";
import { branchLabel } from "@/lib/management";
import {
  hasRequiredSignatures,
  matchBranchManagerEmployee,
  scoreFromSaved,
} from "@/lib/scorecard";
import { notifyList } from "@/lib/personnel";
import { sendEmail } from "@/lib/email";

export const runtime = "nodejs";

const str = (v: unknown) => { const s = typeof v === "string" ? v.trim() : ""; return s === "" ? null : s; };
const base = () => process.env.APP_URL || process.env.NEXT_PUBLIC_APP_URL || "";

// Completion-lifecycle actions for a quarterly manager-scorecard review:
//  - save     : upsert the header + four narrative fields (draft only)
//  - sign     : append a typed-signature attestation (reviewer | manager)
//  - finalize : requires ≥2 reviewer + 1 manager signatures → compute the
//               weighted score, archive, and file a PersonnelRecord on the
//               manager's employee. Immutable thereafter.
//  - reopen   : admin-only un-archive (logged) so a mistake can be corrected.
export async function POST(req: Request) {
  const user = await getSessionUser();
  if (!user || (user.role !== "admin" && user.role !== "manager"))
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = await req.json().catch(() => null);
  const action = str(body?.action);
  const year = Number(body?.year);
  const quarter = Number(body?.quarter);
  const branch = String(body?.branch ?? "");
  if (!action || !year || !quarter || !branch)
    return NextResponse.json({ error: "Missing action or period." }, { status: 400 });

  // Branch managers may only touch their own branch's review.
  if (branchLocked(user) && user.branch !== branch)
    return NextResponse.json({ error: "Not your branch." }, { status: 403 });

  const existing = await prisma.scorecardReview.findUnique({
    where: { year_quarter_branch: { year, quarter, branch } },
    include: { signatures: true },
  });
  const isArchived = existing?.status === "archived";

  // ---- reopen (admin only) ------------------------------------------------
  if (action === "reopen") {
    if (user.role !== "admin") return NextResponse.json({ error: "Admin only." }, { status: 403 });
    if (!existing || existing.status !== "archived")
      return NextResponse.json({ error: "Only an archived review can be reopened." }, { status: 400 });
    await prisma.scorecardReview.update({
      where: { id: existing.id },
      data: {
        status: hasRequiredSignatures(existing.signatures) ? "signed" : "draft",
        archivedAt: null,
        finalizedAt: null,
        reopenedAt: new Date(),
        reopenedBy: user.name,
        reopenNote: str(body?.note),
      },
    });
    return NextResponse.json({ ok: true });
  }

  // Every other action is blocked once archived (immutable).
  if (isArchived)
    return NextResponse.json({ error: "This review is archived and locked. An admin must reopen it to make changes." }, { status: 409 });

  // ---- save (header + narrative) ------------------------------------------
  if (action === "save") {
    // Only admins edit narrative/header (managers view read-only, per the
    // existing scorecard-scoring gate).
    if (user.role !== "admin") return NextResponse.json({ error: "Admin only." }, { status: 403 });
    const data: Record<string, unknown> = {};
    if ("managerName" in body) data.managerName = str(body.managerName);
    if ("reviewerName" in body) data.reviewerName = str(body.reviewerName);
    if ("reviewDate" in body) { const d = str(body.reviewDate); const dt = d ? new Date(d) : null; data.reviewDate = dt && !isNaN(dt.getTime()) ? dt : null; }
    if ("overallNotes" in body) data.overallNotes = str(body.overallNotes);
    if ("strengths" in body) data.strengths = str(body.strengths);
    if ("areas" in body) data.areas = str(body.areas);
    if ("goals" in body) data.goals = str(body.goals);
    await prisma.scorecardReview.upsert({
      where: { year_quarter_branch: { year, quarter, branch } },
      create: { year, quarter, branch, ...data },
      update: data,
    });
    return NextResponse.json({ ok: true });
  }

  // ---- sign (append a typed-signature attestation) ------------------------
  if (action === "sign") {
    const role = str(body?.role);
    const typedName = str(body?.typedName);
    const title = str(body?.title);
    if (role !== "reviewer" && role !== "manager")
      return NextResponse.json({ error: "Signature role must be reviewer or manager." }, { status: 400 });
    if (!typedName) return NextResponse.json({ error: "Type the signer's full name." }, { status: 400 });

    // Ensure the review row exists.
    const review = existing ?? await prisma.scorecardReview.create({ data: { year, quarter, branch } });

    // Slot limits: at most two reviewers and one manager.
    const sigs = existing?.signatures ?? [];
    if (role === "reviewer" && sigs.filter((s) => s.role === "reviewer").length >= 2)
      return NextResponse.json({ error: "Both reviewer signatures are already captured." }, { status: 400 });
    if (role === "manager" && sigs.filter((s) => s.role === "manager").length >= 1)
      return NextResponse.json({ error: "The manager signature is already captured." }, { status: 400 });

    await prisma.scorecardSignature.create({ data: { reviewId: review.id, role, typedName, title } });

    // Promote to "signed" once all three attestations are present.
    const after = await prisma.scorecardSignature.findMany({ where: { reviewId: review.id } });
    if (hasRequiredSignatures(after) && review.status === "draft")
      await prisma.scorecardReview.update({ where: { id: review.id }, data: { status: "signed" } });

    return NextResponse.json({ ok: true });
  }

  // ---- finalize & archive (admin) -----------------------------------------
  if (action === "finalize") {
    if (user.role !== "admin") return NextResponse.json({ error: "Admin only." }, { status: 403 });
    if (!existing) return NextResponse.json({ error: "Nothing to finalize yet." }, { status: 400 });
    if (!hasRequiredSignatures(existing.signatures))
      return NextResponse.json({ error: "Finalizing needs all three signatures: two reviewers and the manager." }, { status: 400 });

    const score = await scoreFromSaved(year, quarter, branch);

    // File onto the manager's personnel record, if we can match one.
    const emp = await matchBranchManagerEmployee(branch, existing.managerName);
    let personnelRecordId: string | null = null;
    if (emp) {
      const title = `Q${quarter} ${year} manager scorecard — score ${score}%`;
      const bodyText = [
        existing.overallNotes ? `Overall performance: ${existing.overallNotes}` : null,
        existing.strengths ? `Strengths: ${existing.strengths}` : null,
        existing.areas ? `Areas for improvement: ${existing.areas}` : null,
        existing.goals ? `Goals for next quarter: ${existing.goals}` : null,
      ].filter(Boolean).join("\n\n") || null;
      const rec = await prisma.personnelRecord.create({
        data: {
          employeeId: emp.id,
          branch,
          type: "note",
          category: "scorecard",
          title,
          body: bodyText,
          details: JSON.stringify({ kind: "manager_scorecard", year, quarter, branch, score, reviewId: existing.id }),
          authorId: user.id,
          authorName: user.name,
        },
      });
      personnelRecordId = rec.id;
    }

    await prisma.scorecardReview.update({
      where: { id: existing.id },
      data: {
        status: "archived",
        score,
        employeeId: emp?.id ?? null,
        personnelRecordId,
        finalizedAt: new Date(),
        archivedAt: new Date(),
      },
    });

    // Notify HR + leadership that a manager review was filed (best-effort).
    const b = branchLabel(branch);
    const recipients = await notifyList("note");
    await sendEmail({
      to: recipients,
      subject: `Manager scorecard archived: ${b} Q${quarter} ${year} — ${score}%`,
      kind: "scorecard_archived",
      relatedType: "scorecard_review",
      relatedId: existing.id,
      text: `The Q${quarter} ${year} manager scorecard for ${b} was finalized and archived by ${user.name}. Weighted score: ${score}%.${emp ? `\n\nFiled to ${emp.name}'s personnel record.` : ""}\n\n${base()}/management/scorecards?year=${year}&quarter=${quarter}&branch=${branch}\n\n— CanopyOS`,
      html: `<p>The <strong>Q${quarter} ${year}</strong> manager scorecard for <strong>${b}</strong> was finalized and archived by ${user.name}. Weighted score: <strong>${score}%</strong>.</p>${emp ? `<p>Filed to <strong>${emp.name}</strong>'s personnel record.</p>` : ""}<p><a href="${base()}/management/scorecards?year=${year}&quarter=${quarter}&branch=${branch}">View scorecard →</a></p><p>— CanopyOS</p>`,
    }).catch(() => null);

    return NextResponse.json({ ok: true, score, filed: !!emp, personnelRecordId });
  }

  return NextResponse.json({ error: "Unknown action." }, { status: 400 });
}
