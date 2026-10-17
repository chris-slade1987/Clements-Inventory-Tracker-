import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { BRANCHES } from "@/lib/management";
import { canManageSops } from "@/lib/sop";
import { fail, HttpError } from "@/lib/http";

export const runtime = "nodejs";
export const maxDuration = 20;

// SOP library management — admins / senior leadership / the Field Ops director
// only (canManageSops). Two actions:
//   - "setActive" — activate or deactivate an SOP template (never hard-deleted,
//     so its signed history stays intact; mirrors the checklist template rule).
//   - "assign"    — assign an SOP to a branch with an optional due date (the
//     flexible ad-hoc due rule). Idempotent-ish: refuses a duplicate OPEN
//     assignment of the same SOP to the same branch.
export async function POST(req: Request) {
  try {
    const user = await requireUser();
    if (!canManageSops(user)) {
      throw new HttpError("Only admins or leadership may manage the SOP library.", 403);
    }

    const body = await req.json().catch(() => null);
    const action = body?.action;

    if (action === "setActive") {
      const templateId = typeof body?.templateId === "string" ? body.templateId : "";
      const active = body?.active === true;
      if (!templateId) throw new HttpError("Missing SOP.");
      const t = await prisma.checklistTemplate.findFirst({ where: { id: templateId, kind: "sop" } });
      if (!t) throw new HttpError("SOP not found.", 404);
      await prisma.checklistTemplate.update({ where: { id: templateId }, data: { active } });
      return NextResponse.json({ ok: true, active });
    }

    if (action === "assign") {
      const templateId = typeof body?.templateId === "string" ? body.templateId : "";
      const branch = BRANCHES.find((b) => b.key === body?.branch)?.key ?? null;
      const note = typeof body?.note === "string" ? body.note.trim().slice(0, 2000) : "";
      const dueRaw = typeof body?.dueDate === "string" && body.dueDate ? body.dueDate : null;
      const dueDate = dueRaw ? new Date(dueRaw) : null;
      if (dueDate && Number.isNaN(dueDate.getTime())) throw new HttpError("Invalid due date.");

      if (!templateId) throw new HttpError("Missing SOP.");
      if (!branch) throw new HttpError("Choose a valid branch.");

      const t = await prisma.checklistTemplate.findFirst({ where: { id: templateId, kind: "sop" } });
      if (!t) throw new HttpError("SOP not found.", 404);
      if (!t.active) throw new HttpError("Activate the SOP before assigning it.", 409);

      const dup = await prisma.sopAssignment.findFirst({
        where: { templateId, branch, status: "open" },
        select: { id: true },
      });
      if (dup) {
        throw new HttpError("That SOP already has an open assignment at this branch.", 409);
      }

      const asg = await prisma.sopAssignment.create({
        data: {
          templateId,
          templateVersion: t.version,
          branch,
          dueDate,
          note: note || null,
          assignedById: user.id,
          assignedByName: user.name,
        },
      });
      return NextResponse.json({ ok: true, id: asg.id });
    }

    throw new HttpError("Unsupported action.");
  } catch (e) {
    return fail(e);
  }
}
