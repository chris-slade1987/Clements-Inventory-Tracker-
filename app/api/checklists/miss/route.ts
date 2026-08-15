import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { canClearChecklistMiss } from "@/lib/personnel";

export const runtime = "nodejs";
export const maxDuration = 20;

// Clear a missed-checklist compliance infraction. The "penalty" can be cleared
// ONLY by the CEO (admin) or the HR director — never the branch manager. This is
// APPEND-ONLY history: a cleared miss is updated in place (status/cleared-by/note)
// and can never be re-opened or hard-deleted.
export async function POST(req: Request) {
  const user = await requireUser();

  const body = await req.json().catch(() => null);
  if (body?.action !== "clear") {
    return NextResponse.json({ error: "Unsupported action." }, { status: 400 });
  }

  // Permission gate FIRST — a branch manager can never clear a miss.
  if (!canClearChecklistMiss(user)) {
    return NextResponse.json(
      { error: "Only the CEO or HR director may clear a missed checklist." },
      { status: 403 }
    );
  }

  const missId = typeof body?.missId === "string" ? body.missId : "";
  const note = typeof body?.note === "string" ? body.note.trim() : "";
  if (!missId) {
    return NextResponse.json({ error: "Missing miss id." }, { status: 400 });
  }
  if (!note) {
    return NextResponse.json({ error: "A note is required to clear a missed checklist." }, { status: 400 });
  }

  const miss = await prisma.checklistMiss.findUnique({ where: { id: missId } });
  if (!miss) {
    return NextResponse.json({ error: "Missed checklist not found." }, { status: 404 });
  }
  if (miss.status === "cleared") {
    return NextResponse.json(
      { error: "This missed checklist was already cleared and remains on record." },
      { status: 409 }
    );
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
  return NextResponse.json({ ok: true });
}
