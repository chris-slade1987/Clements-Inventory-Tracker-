import { prisma } from "@/lib/prisma";
import { sendEmail } from "@/lib/email";
import { branchLabel } from "@/lib/management";
import type { SessionUser } from "@/lib/auth";

// Internal discussions ("Messages"). A thread groups a subject + its
// participants + messages. Each participant has a private read state so opening
// the thread clears their own unread alert. Notifications also go out by email.

const base = () => process.env.APP_URL || process.env.NEXT_PUBLIC_APP_URL || "";

export type RecipientOption = {
  key: string; // "user:<id>" or "emp:<id>"
  name: string;
  email: string | null;
  branch: string | null;
  group: "Leadership & HR" | "Managers" | "Employees";
  userId: string | null;
  employeeId: string | null;
};

/**
 * People a user may start a discussion with: everyone with a login (managers,
 * admins, HR/leadership) plus every active employee (so a manager can message,
 * say, a tech about a due course). Employees with a linked login see it in-app;
 * those without still receive the email. De-duplicated by person.
 */
export async function recipientOptions(me: SessionUser): Promise<RecipientOption[]> {
  const [users, employees] = await Promise.all([
    prisma.user.findMany({
      where: { active: true },
      select: { id: true, name: true, email: true, role: true, branch: true, employeeId: true },
      orderBy: [{ role: "asc" }, { name: "asc" }],
    }),
    prisma.employee.findMany({
      where: { status: "active" },
      select: { id: true, name: true, email: true, branch: true },
      orderBy: [{ name: "asc" }],
    }),
  ]);

  const byEmployeeId = new Map(users.filter((u) => u.employeeId).map((u) => [u.employeeId as string, u]));
  const opts: RecipientOption[] = [];
  const seenUser = new Set<string>();

  for (const u of users) {
    if (u.id === me.id) continue; // don't offer yourself
    seenUser.add(u.id);
    const group: RecipientOption["group"] =
      u.role === "admin" || u.branch === null ? "Leadership & HR" : "Managers";
    opts.push({
      key: `user:${u.id}`,
      name: u.name,
      email: u.email,
      branch: u.branch,
      group,
      userId: u.id,
      employeeId: u.employeeId ?? null,
    });
  }
  for (const e of employees) {
    const linked = byEmployeeId.get(e.id);
    if (linked) continue; // already offered as a login above
    opts.push({
      key: `emp:${e.id}`,
      name: e.name,
      email: e.email,
      branch: e.branch,
      group: "Employees",
      userId: null,
      employeeId: e.id,
    });
  }
  return opts;
}

/**
 * Senior management who must be alerted when a manager hits an insufficient-stock
 * hard stop on Check-Out and asks for help reconciling on-hand. Keep this list
 * here so it's a single place to change who gets pulled into the escalation.
 *   - Julie Glanville — Chief of Staff
 *   - Graham Foster — Director of Field Operations
 *   - Chris Slade
 */
export const INVENTORY_ESCALATION_EMAILS = [
  "jglanville@clementspestcontrol.com",
  "gfoster@clementspestcontrol.com",
  "c.slade@clementspestcontrol.com",
] as const;

/**
 * Resolve the inventory-escalation stakeholders (by email) to `user:<id>`
 * recipient keys, keeping only ACTIVE users that actually exist. Missing people
 * are simply skipped so an escalation never fails because someone left. The
 * reporting manager is filtered out (they're added to the thread as owner).
 */
export async function inventoryEscalationRecipientKeys(excludeUserId?: string): Promise<string[]> {
  const users = await prisma.user.findMany({
    where: {
      active: true,
      email: { in: [...INVENTORY_ESCALATION_EMAILS] },
    },
    select: { id: true },
  });
  return users
    .filter((u) => u.id !== excludeUserId)
    .map((u) => `user:${u.id}`);
}

/** Resolve selected recipient keys to participant rows (userId/employeeId/name/email). */
export async function resolveRecipients(me: SessionUser, keys: string[]) {
  const opts = await recipientOptions(me);
  const byKey = new Map(opts.map((o) => [o.key, o]));
  const out: { userId: string | null; employeeId: string | null; name: string; email: string | null }[] = [];
  for (const k of keys) {
    const o = byKey.get(k);
    if (o) out.push({ userId: o.userId, employeeId: o.employeeId, name: o.name, email: o.email });
  }
  return out;
}

/** How many threads have unread activity for this user (drives the bell badge). */
export async function unreadCount(userId: string): Promise<number> {
  const parts = await prisma.threadParticipant.findMany({
    where: { userId },
    select: { lastReadAt: true, thread: { select: { updatedAt: true } } },
  });
  return parts.filter((p) => !p.lastReadAt || p.thread.updatedAt > p.lastReadAt).length;
}

export type ThreadListItem = {
  id: string;
  subject: string;
  status: string;
  contextType: string;
  contextLabel: string | null;
  contextHref: string | null;
  branch: string | null;
  updatedAt: Date;
  lastMessage: string;
  lastAuthor: string;
  unread: boolean;
  participantNames: string[];
};

/** Threads this user is part of, newest activity first, with their unread flag. */
export async function listThreadsForUser(userId: string): Promise<ThreadListItem[]> {
  const parts = await prisma.threadParticipant.findMany({
    where: { userId },
    include: {
      thread: {
        include: {
          participants: { select: { name: true } },
          messages: { orderBy: { createdAt: "desc" }, take: 1 },
        },
      },
    },
  });
  return parts
    .map((p) => {
      const t = p.thread;
      const last = t.messages[0];
      return {
        id: t.id,
        subject: t.subject,
        status: t.status,
        contextType: t.contextType,
        contextLabel: t.contextLabel,
        contextHref: t.contextHref,
        branch: t.branch,
        updatedAt: t.updatedAt,
        lastMessage: last?.body ?? "",
        lastAuthor: last?.authorName ?? t.createdByName ?? "",
        unread: !p.lastReadAt || t.updatedAt > p.lastReadAt,
        participantNames: t.participants.map((x) => x.name),
      };
    })
    .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());
}

/** Full thread for the detail view; returns null if the user isn't a participant. */
export async function threadDetail(id: string, userId: string) {
  const thread = await prisma.thread.findUnique({
    where: { id },
    include: {
      participants: { orderBy: { createdAt: "asc" } },
      messages: { orderBy: { createdAt: "asc" } },
    },
  });
  if (!thread) return null;
  const me = thread.participants.find((p) => p.userId === userId);
  if (!me) return null;
  return { thread, me };
}

/** Mark a thread read for one user (clears their unread alert). */
export async function markRead(threadId: string, userId: string) {
  await prisma.threadParticipant.updateMany({
    where: { threadId, userId },
    data: { lastReadAt: new Date() },
  });
}

const escapeHtml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** Email everyone on the thread except the author, with a link back into the app. */
export async function notifyThread(opts: {
  threadId: string;
  subject: string;
  contextLabel: string | null;
  authorName: string;
  authorUserId: string | null;
  body: string;
  isNew: boolean;
}) {
  const parts = await prisma.threadParticipant.findMany({
    where: { threadId: opts.threadId, notifyEmail: true },
    select: { userId: true, email: true },
  });
  const recipients = parts
    .filter((p) => p.userId !== opts.authorUserId && p.email)
    .map((p) => p.email as string);
  if (recipients.length === 0) return;

  const link = `${base()}/inbox/${opts.threadId}`;
  const verb = opts.isNew ? "started a discussion" : "replied";
  const ctx = opts.contextLabel ? ` about ${escapeHtml(opts.contextLabel)}` : "";
  const html = `
    <div style="font-family:system-ui,Arial,sans-serif;max-width:520px">
      <p style="margin:0 0 4px"><strong>${escapeHtml(opts.authorName)}</strong> ${verb}${ctx} on Canopy OS.</p>
      <p style="margin:12px 0 4px;font-size:15px;font-weight:600">${escapeHtml(opts.subject)}</p>
      <blockquote style="margin:0;padding:10px 14px;border-left:3px solid #146A3A;background:#f4f7f2;color:#334">${escapeHtml(opts.body)}</blockquote>
      ${base() ? `<p style="margin:16px 0"><a href="${link}" style="background:#146A3A;color:#fff;padding:9px 16px;border-radius:8px;text-decoration:none;font-weight:600">Open the discussion</a></p>` : ""}
      <p style="margin:12px 0 0;font-size:12px;color:#889">Reply inside the portal to keep the conversation in one place.</p>
    </div>`;
  const text = `${opts.authorName} ${verb}${opts.contextLabel ? ` about ${opts.contextLabel}` : ""}.\n\n${opts.subject}\n\n${opts.body}\n\n${link}`;

  await sendEmail({
    to: recipients,
    subject: `${opts.isNew ? "New discussion" : "New reply"}: ${opts.subject}`,
    html,
    text,
    kind: "thread_message",
    relatedType: "thread",
    relatedId: opts.threadId,
  });
}

export function contextLabelFor(type: string, label: string | null) {
  if (label) return label;
  return type === "general" ? "" : type;
}

/** Small human summary of who's on a thread, for list rows. */
export function participantSummary(names: string[], max = 3): string {
  if (names.length <= max) return names.join(", ");
  return `${names.slice(0, max).join(", ")} +${names.length - max}`;
}

export { branchLabel };
