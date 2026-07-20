import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUser, isBoardObserver } from "@/lib/auth";
import { resolveRecipients, notifyThread, markRead } from "@/lib/threads";

export const runtime = "nodejs";

const s = (v: unknown) => {
  const t = typeof v === "string" ? v.trim() : "";
  return t === "" ? null : t;
};

const CONTEXT = new Set(["reminder", "alert", "employee", "vehicle", "general"]);

// Internal discussions. Any logged-in user can start or reply to a thread they
// are part of. Recipients are resolved from the app's people list.
export async function POST(req: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  if (isBoardObserver(user)) return NextResponse.json({ error: "Board observers have read-only access." }, { status: 403 });

  const body = await req.json().catch(() => null);
  const action = s(body?.action) ?? "create";

  try {
    if (action === "create") {
      const subject = s(body?.subject);
      const message = s(body?.message);
      if (!subject) return NextResponse.json({ error: "Add a subject." }, { status: 400 });
      if (!message) return NextResponse.json({ error: "Write a message." }, { status: 400 });

      const keys = Array.isArray(body?.recipients) ? (body.recipients as unknown[]).map(String) : [];
      const recipients = await resolveRecipients(user, keys);
      if (recipients.length === 0)
        return NextResponse.json({ error: "Choose at least one person to send this to." }, { status: 400 });

      const contextType = CONTEXT.has(String(body?.contextType)) ? String(body?.contextType) : "general";
      const now = new Date();

      const thread = await prisma.thread.create({
        data: {
          subject,
          branch: user.branch ?? null,
          contextType,
          contextId: s(body?.contextId),
          contextLabel: s(body?.contextLabel),
          contextHref: s(body?.contextHref),
          createdByUserId: user.id,
          createdByName: user.name,
          updatedAt: now,
          messages: {
            create: { authorUserId: user.id, authorName: user.name, body: message },
          },
          participants: {
            create: [
              // Creator — already "read" so their own message isn't unread to them.
              { userId: user.id, name: user.name, email: user.email, role: "owner", lastReadAt: now },
              // Recipients — de-duped against the creator.
              ...recipients
                .filter((r) => r.userId !== user.id)
                .map((r) => ({ userId: r.userId, employeeId: r.employeeId, name: r.name, email: r.email })),
            ],
          },
        },
      });

      await notifyThread({
        threadId: thread.id,
        subject,
        contextLabel: s(body?.contextLabel),
        authorName: user.name,
        authorUserId: user.id,
        body: message,
        isNew: true,
      }).catch(() => {});

      return NextResponse.json({ ok: true, id: thread.id });
    }

    const id = s(body?.id);
    if (!id) return NextResponse.json({ error: "Missing thread." }, { status: 400 });

    // Membership check for all thread-scoped actions.
    const membership = await prisma.threadParticipant.findFirst({ where: { threadId: id, userId: user.id } });
    if (!membership) return NextResponse.json({ error: "Not your discussion." }, { status: 403 });

    if (action === "reply") {
      const message = s(body?.message);
      if (!message) return NextResponse.json({ error: "Write a message." }, { status: 400 });
      const now = new Date();
      const [, thread] = await Promise.all([
        prisma.threadMessage.create({ data: { threadId: id, authorUserId: user.id, authorName: user.name, body: message } }),
        prisma.thread.update({ where: { id }, data: { updatedAt: now, status: "open" } }),
        // Author has read their own reply.
        prisma.threadParticipant.updateMany({ where: { threadId: id, userId: user.id }, data: { lastReadAt: now } }),
      ]);
      await notifyThread({
        threadId: id,
        subject: thread.subject,
        contextLabel: thread.contextLabel,
        authorName: user.name,
        authorUserId: user.id,
        body: message,
        isNew: false,
      }).catch(() => {});
      return NextResponse.json({ ok: true });
    }

    if (action === "read") {
      await markRead(id, user.id);
      return NextResponse.json({ ok: true });
    }

    if (action === "resolve" || action === "reopen") {
      await prisma.thread.update({ where: { id }, data: { status: action === "resolve" ? "resolved" : "open" } });
      return NextResponse.json({ ok: true });
    }

    if (action === "leave") {
      await prisma.threadParticipant.deleteMany({ where: { threadId: id, userId: user.id, role: "member" } });
      return NextResponse.json({ ok: true });
    }

    return NextResponse.json({ error: "Unknown action." }, { status: 400 });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
