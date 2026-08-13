import { NextResponse } from "next/server";
import { randomBytes } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { getSessionUser, branchLocked } from "@/lib/auth";
import {
  hasRequiredSignatures,
  finalizeScorecard,
  sendManagerSignEmail,
} from "@/lib/scorecard";

export const runtime = "nodejs";

const str = (v: unknown) => { const s = typeof v === "string" ? v.trim() : ""; return s === "" ? null : s; };

// Completion-lifecycle actions for a quarterly manager-scorecard review:
//  - save     : upsert header + four narrative fields (DRAFT only, admin)
//  - publish  : draft → "final". The supervisor signs, editing locks, a manager
//               sign-token is minted and emailed. (admin)
//  - resend   : re-email the manager the sign link for a FINAL (awaiting-signature)
//               review — reuses the live token, mints one if cleared. (admin)
//  - unpublish: FINAL → draft so an unsigned, mistaken, or un-received scorecard
//               can be corrected and re-published; clears the supervisor
//               signature + token (nothing was filed yet). (admin)
//  - sign     : append a typed signature (reviewer=supervisor | manager). When
//               BOTH are present the review auto-archives (score, file to the
//               manager's profile + branch hub, notify HR to pay the bonus).
//  - reopen   : admin-only un-archive of a completed review, behind an explicit
//               confirm on the client; flags it so the next archive notifies all
//               stakeholders that the published version changed.
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

  // ---- reopen (admin only) — un-archive a completed review to edit it --------
  if (action === "reopen") {
    if (user.role !== "admin") return NextResponse.json({ error: "Admin only." }, { status: 403 });
    if (!existing || existing.status !== "archived")
      return NextResponse.json({ error: "Only an archived review can be reopened." }, { status: 400 });
    // Clear signatures + token: an edit invalidates the prior sign-off, so both
    // parties must re-sign. Flag editedAfterArchive so re-archiving notifies all.
    await prisma.scorecardSignature.deleteMany({ where: { reviewId: existing.id } });
    await prisma.scorecardReview.update({
      where: { id: existing.id },
      data: {
        status: "draft",
        signToken: null,
        publishedAt: null,
        archivedAt: null,
        finalizedAt: null,
        editedAfterArchive: true,
        reopenedAt: new Date(),
        reopenedBy: user.name,
        reopenNote: str(body?.note),
      },
    });
    return NextResponse.json({ ok: true });
  }

  // Every other action is blocked once archived (immutable until reopened).
  if (isArchived)
    return NextResponse.json({ error: "This review is archived and locked. An admin must reopen it to make changes." }, { status: 409 });

  // ---- save (header + narrative) — DRAFT only --------------------------------
  if (action === "save") {
    if (user.role !== "admin") return NextResponse.json({ error: "Admin only." }, { status: 403 });
    if (existing && existing.status !== "draft")
      return NextResponse.json({ error: "Published — reopen to a draft before editing." }, { status: 409 });
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

  // ---- publish (draft → final) — supervisor signs, manager is emailed --------
  if (action === "publish") {
    if (user.role !== "admin") return NextResponse.json({ error: "Admin only." }, { status: 403 });
    const supervisorName = str(body?.supervisorName) ?? user.name;
    const supervisorTitle = str(body?.supervisorTitle) ?? "Supervisor";
    if (existing && existing.status === "final")
      return NextResponse.json({ error: "Already published — awaiting the manager's signature." }, { status: 409 });

    const review = existing ?? await prisma.scorecardReview.create({ data: { year, quarter, branch } });
    const token = randomBytes(24).toString("base64url");

    // Record the supervisor's signature and lock the review.
    await prisma.scorecardSignature.create({ data: { reviewId: review.id, role: "reviewer", typedName: supervisorName, title: supervisorTitle } });
    await prisma.scorecardReview.update({
      where: { id: review.id },
      data: { status: "final", signToken: token, publishedAt: new Date(), reviewerName: review.reviewerName ?? supervisorName },
    });

    // Email the manager a secure link to add their signature. Surface the real
    // send outcome (sent / no-provider / no-address / error) + a copyable link so
    // a silent email failure can never strand the review again.
    const sent = await sendManagerSignEmail({ reviewId: review.id, year, quarter, branch, token, managerName: existing?.managerName ?? null });
    return NextResponse.json({ ok: true, emailed: sent.status === "sent", emailStatus: sent.status, managerEmail: sent.managerEmail, signUrl: sent.signUrl });
  }

  // ---- resend (admin) — re-email the manager the sign link for a FINAL review -
  if (action === "resend") {
    if (user.role !== "admin") return NextResponse.json({ error: "Admin only." }, { status: 403 });
    if (!existing || existing.status !== "final")
      return NextResponse.json({ error: "Only a published scorecard that is awaiting the manager's signature can be resent." }, { status: 400 });
    // Reuse the live token; mint a fresh one only if it was consumed/cleared.
    let token = existing.signToken;
    if (!token) {
      token = randomBytes(24).toString("base64url");
      await prisma.scorecardReview.update({ where: { id: existing.id }, data: { signToken: token } });
    }
    const sent = await sendManagerSignEmail({ reviewId: existing.id, year, quarter, branch, token, managerName: existing.managerName });
    return NextResponse.json({ ok: true, emailed: sent.status === "sent", emailStatus: sent.status, managerEmail: sent.managerEmail, signUrl: sent.signUrl });
  }

  // ---- unpublish (admin) — FINAL → draft to correct an unsigned scorecard -----
  if (action === "unpublish") {
    if (user.role !== "admin") return NextResponse.json({ error: "Admin only." }, { status: 403 });
    if (!existing || existing.status !== "final")
      return NextResponse.json({ error: "Only a published scorecard that is awaiting the manager's signature can be un-published." }, { status: 400 });
    // The manager hasn't signed (a signed pair auto-archives), so nothing was
    // filed. Clear the supervisor signature + token and return to an editable draft.
    await prisma.scorecardSignature.deleteMany({ where: { reviewId: existing.id } });
    await prisma.scorecardReview.update({
      where: { id: existing.id },
      data: { status: "draft", signToken: null, publishedAt: null },
    });
    return NextResponse.json({ ok: true });
  }

  // ---- sign (in-app) — supervisor(reviewer) or manager -----------------------
  if (action === "sign") {
    const role = str(body?.role);
    const typedName = str(body?.typedName);
    const title = str(body?.title);
    if (role !== "reviewer" && role !== "manager")
      return NextResponse.json({ error: "Signature role must be reviewer or manager." }, { status: 400 });
    if (!typedName) return NextResponse.json({ error: "Type the signer's full name." }, { status: 400 });

    const review = existing ?? await prisma.scorecardReview.create({ data: { year, quarter, branch } });
    const sigs = existing?.signatures ?? [];
    if (role === "reviewer" && sigs.filter((s) => s.role === "reviewer").length >= 1)
      return NextResponse.json({ error: "The supervisor signature is already captured." }, { status: 400 });
    if (role === "manager" && sigs.filter((s) => s.role === "manager").length >= 1)
      return NextResponse.json({ error: "The manager signature is already captured." }, { status: 400 });

    await prisma.scorecardSignature.create({ data: { reviewId: review.id, role, typedName, title } });

    // Both signatures present → auto-complete (score, file, notify HR).
    const after = await prisma.scorecardSignature.findMany({ where: { reviewId: review.id } });
    if (hasRequiredSignatures(after)) {
      const r = await finalizeScorecard(review.id, user.name).catch((e) => ({ error: String(e) }));
      return NextResponse.json({ ok: true, completed: true, ...r });
    }
    return NextResponse.json({ ok: true, completed: false });
  }

  return NextResponse.json({ error: "Unknown action." }, { status: 400 });
}
