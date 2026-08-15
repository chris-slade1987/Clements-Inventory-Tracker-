import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth";
import { branchLabel } from "@/lib/management";
import { notifyThread } from "@/lib/threads";
import {
  isReason,
  reasonLabel,
  spanDays,
  toUtcDay,
  checklistNoteRule,
  canManageAbsenceBranch,
  canResolveNotes,
  isBranchManagerActor,
  calloutNotifyParticipants,
} from "@/lib/absence";

export const runtime = "nodejs";
export const maxDuration = 20;

const s = (v: unknown) => { const t = typeof v === "string" ? v.trim() : ""; return t === "" ? null : t; };
const dateOf = (v: unknown) => { const t = typeof v === "string" ? v.trim() : ""; if (!t) return null; const d = new Date(t); return isNaN(d.getTime()) ? null : d; };
const bool = (v: unknown): boolean | null => {
  if (v === true || v === "true" || v === "yes") return true;
  if (v === false || v === "false" || v === "no") return false;
  return null;
};

const APP = () => process.env.APP_URL || process.env.NEXT_PUBLIC_APP_URL || "";
const fmt = (d: Date) => d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });

export async function POST(req: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Sign in required." }, { status: 401 });

  const body = await req.json().catch(() => null);
  const action = s(body?.action) ?? "create";

  try {
    // ---- Create / update a call-out --------------------------------------
    if (action === "create" || action === "update") {
      const id = s(body?.id);
      const employeeId = s(body?.employeeId);
      if (!employeeId) return NextResponse.json({ error: "Missing employee." }, { status: 400 });

      const employee = await prisma.employee.findUnique({ where: { id: employeeId }, select: { id: true, branch: true, name: true } });
      if (!employee) return NextResponse.json({ error: "Employee not found." }, { status: 404 });

      // Branch scoping: admin/HR any branch; a branch manager only their own.
      if (!canManageAbsenceBranch(user, employee.branch))
        return NextResponse.json({ error: "You can only log call-outs for your own branch." }, { status: 403 });

      const start = dateOf(body?.startDate);
      const end = dateOf(body?.endDate);
      if (!start || !end) return NextResponse.json({ error: "Choose a start and end date." }, { status: 400 });
      if (toUtcDay(end).getTime() < toUtcDay(start).getTime())
        return NextResponse.json({ error: "The end date can't be before the start date." }, { status: 400 });

      const reason = s(body?.reason);
      if (!reason || !isReason(reason)) return NextResponse.json({ error: "Choose a valid reason." }, { status: 400 });

      const reasonDetail = s(body?.reasonDetail);
      if (reason === "other" && !reasonDetail)
        return NextResponse.json({ error: "Add a detail for “Other”." }, { status: 400 });

      // Physical injury: workplace-related is REQUIRED (non-null).
      let workplaceRelated: boolean | null = null;
      let accidentRecordId: string | null = null;
      if (reason === "physical_injury") {
        workplaceRelated = bool(body?.workplaceRelated);
        if (workplaceRelated === null)
          return NextResponse.json({ error: "Indicate whether this injury is related to a workplace accident." }, { status: 400 });
        if (workplaceRelated) {
          accidentRecordId = s(body?.accidentRecordId);
          if (accidentRecordId) {
            const rec = await prisma.personnelRecord.findUnique({ where: { id: accidentRecordId }, select: { id: true, employeeId: true, type: true } });
            if (!rec || rec.type !== "accident" || rec.employeeId !== employeeId)
              return NextResponse.json({ error: "That accident report isn't valid for this employee." }, { status: 400 });
          }
        }
      }

      const excused = bool(body?.excused); // may be null (undetermined)
      const days = spanDays(start, end);

      // Medical-note rule — applied consistently by rule: illness > 2 days.
      const noteRequired = checklistNoteRule({ reason, days });

      const startD = toUtcDay(start);
      const endD = toUtcDay(end);

      if (action === "update" && id) {
        const existing = await prisma.absence.findUnique({ where: { id } });
        if (!existing) return NextResponse.json({ error: "Call-out not found." }, { status: 404 });
        // Preserve a resolved note; only (re)request when the rule requires it
        // and it isn't already resolved.
        let noteStatus = existing.noteStatus;
        if (noteRequired) {
          if (noteStatus === "none") noteStatus = "requested";
        } else {
          // Rule no longer applies and the note was never resolved — clear it.
          if (noteStatus === "requested") noteStatus = "none";
        }
        await prisma.absence.update({
          where: { id },
          data: {
            startDate: startD,
            endDate: endD,
            days,
            reason,
            reasonDetail,
            excused,
            workplaceRelated,
            accidentRecordId,
            noteRequired,
            noteStatus,
          },
        });
        return NextResponse.json({ ok: true, id });
      }

      // Create — stamp who logged it, set the initial note status.
      const created = await prisma.absence.create({
        data: {
          employeeId,
          branch: employee.branch,
          startDate: startD,
          endDate: endD,
          days,
          reason,
          reasonDetail,
          excused,
          workplaceRelated,
          accidentRecordId,
          noteRequired,
          noteStatus: noteRequired ? "requested" : "none",
          loggedById: user.id,
          loggedByName: user.name,
        },
      });

      // Owner amendment: when a BRANCH MANAGER logs a call-out, alert the CEO +
      // HR director by email + in-app, reusing the internal-discussions system
      // (notifyThread auto-emails thread participants). Admin/HR logging their
      // own call-outs do NOT trigger this (they already know).
      let notified: string[] = [];
      if (isBranchManagerActor(user)) {
        const participants = await calloutNotifyParticipants(user.id);
        if (participants.length > 0) {
          const range = days > 1 ? `${fmt(startD)} – ${fmt(endD)}` : fmt(startD);
          const branchName = employee.branch ? branchLabel(employee.branch) : "no branch";
          const subject = `Call-out logged: ${employee.name} (${branchName})`;
          const noteLine = noteRequired
            ? `A medical note has been requested (illness spanning ${days} days).`
            : "No medical note was triggered.";
          const href = `${APP()}/management/people/${employeeId}`;
          const message =
            `${user.name} logged a call-out for ${employee.name} (${branchName}).\n` +
            `Dates: ${range} · ${days} day${days === 1 ? "" : "s"}\n` +
            `Reason: ${reasonLabel(reason)}${reasonDetail ? ` — ${reasonDetail}` : ""}\n` +
            `${noteLine}\n\n` +
            `Review on the employee profile / call-out overview: ${href}`;
          const now = new Date();
          const thread = await prisma.thread.create({
            data: {
              subject,
              branch: employee.branch,
              contextType: "employee",
              contextId: employeeId,
              contextLabel: `${employee.name} — call-out`,
              contextHref: `/management/people/${employeeId}`,
              createdByUserId: user.id,
              createdByName: user.name,
              updatedAt: now,
              messages: { create: { authorUserId: user.id, authorName: user.name, body: message } },
              participants: {
                create: [
                  { userId: user.id, name: user.name, email: user.email, role: "owner", lastReadAt: now },
                  ...participants.map((p) => ({ userId: p.userId, name: p.name, email: p.email })),
                ],
              },
            },
          });
          notified = participants.map((p) => p.name);
          await notifyThread({
            threadId: thread.id,
            subject,
            contextLabel: `${employee.name} — call-out`,
            authorName: user.name,
            authorUserId: user.id,
            body: message,
            isNew: true,
          }).catch(() => {});
        }
      }

      return NextResponse.json({ ok: true, id: created.id, noteRequired, notified });
    }

    // ---- Resolve a medical note (received / waived) — admin/HR ONLY ------
    if (action === "resolveNote") {
      if (!canResolveNotes(user))
        return NextResponse.json({ error: "Only HR or an administrator can resolve a medical note." }, { status: 403 });
      const id = s(body?.id);
      const noteStatus = s(body?.noteStatus);
      if (!id) return NextResponse.json({ error: "Missing call-out." }, { status: 400 });
      if (noteStatus !== "received" && noteStatus !== "waived")
        return NextResponse.json({ error: "Note status must be received or waived." }, { status: 400 });
      const existing = await prisma.absence.findUnique({ where: { id }, select: { id: true, noteRequired: true } });
      if (!existing) return NextResponse.json({ error: "Call-out not found." }, { status: 404 });
      await prisma.absence.update({
        where: { id },
        data: {
          noteRequired: true,
          noteStatus,
          noteResolvedAt: new Date(),
          noteResolvedBy: user.name,
        },
      });
      return NextResponse.json({ ok: true });
    }

    return NextResponse.json({ error: "Unknown action." }, { status: 400 });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
