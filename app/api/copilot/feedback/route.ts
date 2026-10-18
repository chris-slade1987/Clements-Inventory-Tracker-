import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth";

export const runtime = "nodejs";
export const maxDuration = 15;

// Canopy Copilot — feedback persistence (CanopyOS Theme 5, Wave D, plan §10).
//
// The docked panel (Wave C) fires a best-effort POST here when the user clicks the
// thumbs up/down on an answer. We persist a CopilotFeedback row against the
// assistant CopilotMessage it refers to. The panel is best-effort and silent on a
// non-2xx, so this endpoint is intentionally TOLERANT:
//   • `messageId` present + valid → attach feedback to that message (the normal path
//     once the one-line panel edit forwards the id from /api/copilot's response).
//   • only `conversationId` → attach to that conversation's most recent assistant
//     message (so partial ids still land somewhere sensible).
//   • neither resolves → return 200 { ok: false } WITHOUT persisting, rather than an
//     error, so the panel never shows a failure for a signal we simply can't anchor.
// Append-only ledger discipline: feedback rows are never updated or hard-deleted; a
// changed vote is a new row (the latest wins when the gaps report reads them).

function str(v: unknown): string | null {
  const t = typeof v === "string" ? v.trim() : "";
  return t === "" ? null : t;
}

export async function POST(req: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => null);
  const rating = body?.rating === "up" || body?.rating === "down" ? body.rating : null;
  if (!rating) {
    return NextResponse.json({ error: "rating must be 'up' or 'down'." }, { status: 400 });
  }
  const messageId = str(body?.messageId);
  const conversationId = str(body?.conversationId);
  const note = str(body?.note);

  try {
    // Resolve the target assistant message: an explicit (valid) messageId first,
    // else the latest assistant message in the given conversation.
    let targetId: string | null = null;
    if (messageId) {
      const msg = await prisma.copilotMessage.findUnique({ where: { id: messageId }, select: { id: true } });
      if (msg) targetId = msg.id;
    }
    if (!targetId && conversationId) {
      const latest = await prisma.copilotMessage.findFirst({
        where: { conversationId, role: "assistant" },
        orderBy: { createdAt: "desc" },
        select: { id: true },
      });
      if (latest) targetId = latest.id;
    }

    if (!targetId) {
      // Nothing to anchor to (e.g. logging was unavailable when the answer was
      // produced). Stay quiet — the panel treats this as a no-op.
      return NextResponse.json({ ok: false, persisted: false });
    }

    await prisma.copilotFeedback.create({
      data: { messageId: targetId, rating, note: note ?? undefined },
    });
    return NextResponse.json({ ok: true, persisted: true });
  } catch (e) {
    console.error("[copilot] feedback persist failed (non-fatal):", e);
    // Best-effort: never surface a 500 for a thumbs click.
    return NextResponse.json({ ok: false, persisted: false });
  }
}
