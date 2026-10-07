import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { canClearChecklistMiss } from "@/lib/personnel";
import { fail, HttpError } from "@/lib/http";

export const runtime = "nodejs";
export const maxDuration = 20;

// Clear missed-checklist compliance infractions. The "penalty" can be cleared
// ONLY by the CEO (admin) or the HR director — never the branch manager. This is
// APPEND-ONLY history: a cleared miss is updated in place (status/cleared-by/note)
// and can never be re-opened or hard-deleted.
//
// Two actions:
//   - "clear"    — one miss by id (requires a note)
//   - "clearAll" — every still-open miss (requires a note), optionally scoped to a
//                  branch and/or a set of periodKeys. The same note + attribution
//                  is stamped on each cleared row, so the audit trail is preserved.
export async function POST(req: Request) {
  try {
    const user = await requireUser();

    // Permission gate FIRST — a branch manager can never clear a miss.
    if (!canClearChecklistMiss(user)) {
      throw new HttpError("Only the CEO or HR director may clear a missed checklist.", 403);
    }

    const body = await req.json().catch(() => null);
    const action = body?.action;
    const note = typeof body?.note === "string" ? body.note.trim() : "";

    if (action === "clear") {
      const missId = typeof body?.missId === "string" ? body.missId : "";
      if (!missId) throw new HttpError("Missing miss id.");
      if (!note) throw new HttpError("A note is required to clear a missed checklist.");

      const miss = await prisma.checklistMiss.findUnique({ where: { id: missId } });
      if (!miss) throw new HttpError("Missed checklist not found.", 404);
      if (miss.status === "cleared") {
        throw new HttpError("This missed checklist was already cleared and remains on record.", 409);
      }

      await prisma.checklistMiss.update({
        where: { id: missId },
        data: {
          status: "cleared",
          clearedById: user.id,
          clearedByName: user.name,
          clearedAt: new Date(),
          clearNote: note.slice(0, 2000),
        },
      });
      return NextResponse.json({ ok: true, cleared: 1 });
    }

    if (action === "clearAll") {
      if (!note) throw new HttpError("A note is required to clear missed checklists.");
      const branch = typeof body?.branch === "string" && body.branch ? body.branch : undefined;
      const periodKeys = Array.isArray(body?.periodKeys)
        ? (body.periodKeys as unknown[]).filter((k): k is string => typeof k === "string")
        : undefined;

      const res = await prisma.checklistMiss.updateMany({
        where: {
          status: "open",
          ...(branch ? { branch } : {}),
          ...(periodKeys && periodKeys.length ? { periodKey: { in: periodKeys } } : {}),
        },
        data: {
          status: "cleared",
          clearedById: user.id,
          clearedByName: user.name,
          clearedAt: new Date(),
          clearNote: note.slice(0, 2000),
        },
      });
      return NextResponse.json({ ok: true, cleared: res.count });
    }

    throw new HttpError("Unsupported action.");
  } catch (e) {
    return fail(e);
  }
}
