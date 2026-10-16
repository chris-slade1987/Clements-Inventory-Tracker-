import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { fail } from "@/lib/http";
import { getSessionUser, canManageSales, isSuperAdmin } from "@/lib/auth";
import { currentPeriodKey } from "@/lib/sales";
import {
  upsertFocusItem, logFocusOutcome, addFocusComment, voidFocusItem, copyLastMonthPlan, getFocusItem, focusTypeLabel,
} from "@/lib/sales-focus";
import { notifyThread } from "@/lib/threads";
import { appUrl } from "@/lib/app-url";

export const runtime = "nodejs";
export const maxDuration = 20;

const num = (v: unknown) => { const n = Number(v); return Number.isFinite(n) ? n : null; };

// Focus Plan surface. Actions (all gated: advisor editing their OWN plan, or a
// sales manager / super admin via canManageSales):
//   • upsert   — create/update one planned action
//   • outcome  — log what came of an action (→ notifies the Sales Director)
//   • comment  — append to an action's in-portal coaching log
//   • void     — soft-delete an action (never hard-deleted)
//   • copy_last_month — carry last month's recurring actions into this month
export async function POST(req: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const body = await req.json().catch(() => null);
  if (!body) return NextResponse.json({ error: "Invalid request." }, { status: 400 });

  const action: string = typeof body.action === "string" ? body.action : "upsert";
  const periodKey = typeof body.periodKey === "string" && /^\d{4}-\d{2}$/.test(body.periodKey) ? body.periodKey : currentPeriodKey();

  try {
    // Resolve the advisor this call is about + the caller's permission on it.
    // For actions on an existing item, the item's advisor is authoritative.
    let advisorEmployeeId: string | null = (typeof body.advisorEmployeeId === "string" && body.advisorEmployeeId) || user.employeeId || null;
    let itemPeriodKey = periodKey;
    if (action === "outcome" || action === "comment" || action === "void" || (action === "upsert" && body.id)) {
      const item = await getFocusItem(String(body.id));
      if (!item) return NextResponse.json({ error: "That plan item no longer exists." }, { status: 404 });
      advisorEmployeeId = item.advisorEmployeeId;
      itemPeriodKey = item.periodKey;
    }
    if (!advisorEmployeeId) return NextResponse.json({ error: "No advisor to save for." }, { status: 400 });

    const isOwn = advisorEmployeeId === user.employeeId;
    const canManage = canManageSales(user);
    // Comments: the advisor (own plan), the Sales Director/admins, and super
    // admins may all coach. Everything else: own plan or canManageSales.
    const allowed = action === "comment" ? (isOwn || canManage || isSuperAdmin(user)) : (isOwn || canManage);
    if (!allowed) return NextResponse.json({ error: "You can only work on your own Focus Plan." }, { status: 403 });

    const emp = await prisma.employee.findUnique({ where: { id: advisorEmployeeId }, select: { branch: true, name: true } });

    if (action === "copy_last_month") {
      const created = await copyLastMonthPlan(advisorEmployeeId, periodKey, { branch: emp?.branch ?? null, userId: user.id });
      return NextResponse.json({ ok: true, created });
    }

    if (action === "void") {
      await voidFocusItem(String(body.id), body.voided === false ? false : true);
      return NextResponse.json({ ok: true });
    }

    if (action === "comment") {
      const comment = await addFocusComment(String(body.id), user.name, String(body.body ?? ""), user.id);
      if (!comment) return NextResponse.json({ error: "Write a comment first." }, { status: 400 });
      return NextResponse.json({ ok: true, id: comment.id });
    }

    if (action === "outcome") {
      const item = await logFocusOutcome(String(body.id), {
        outcome: typeof body.outcome === "string" ? body.outcome : null,
        outcomeLeads: num(body.outcomeLeads),
        outcomeClosed: num(body.outcomeClosed),
      });
      // Notify the Sales Director(s) + super admins (in-portal + email), so the
      // coaching loop closes without email ping-pong. Best-effort — never fails
      // the save. Skip when a manager logged on the advisor's behalf and is the
      // only recipient (notifyThread already excludes the author).
      await notifyFocusOutcome({ advisorName: emp?.name ?? "An advisor", authorUserId: user.id, item }).catch(() => {});
      return NextResponse.json({ ok: true, id: item.id, status: item.status });
    }

    // upsert (default)
    const saved = await upsertFocusItem(advisorEmployeeId, action === "upsert" && body.id ? itemPeriodKey : periodKey, {
      id: body.id ?? null,
      type: String(body.type ?? "other"),
      title: body.title ?? null,
      plan: body.plan ?? null,
      goalText: body.goalText ?? null,
      goalCount: num(body.goalCount),
      followUpAt: body.followUpAt,
      remindAt: body.remindAt,
    }, { branch: emp?.branch ?? null, userId: user.id });
    return NextResponse.json({ ok: true, id: saved.id });
  } catch (e) {
    return fail(e);
  }
}

/** Open a thread to the Sales Director(s) + super admins when an outcome is logged. */
async function notifyFocusOutcome(opts: {
  advisorName: string;
  authorUserId: string;
  item: { id: string; type: string; title: string | null; outcome: string | null; outcomeLeads: number | null; outcomeClosed: number | null; advisorEmployeeId: string };
}) {
  const recips = await prisma.user.findMany({
    where: { active: true, OR: [{ accessLevel: "sales_director" }, { role: "admin" }] },
    select: { id: true, name: true, email: true, role: true, accessLevel: true },
  });
  // Sales Directors + super admins (role admin & not team-scoped "admin" level).
  const participants = recips
    .filter((u) => u.accessLevel === "sales_director" || (u.role === "admin" && u.accessLevel !== "admin"))
    .filter((u) => u.id !== opts.authorUserId);
  if (participants.length === 0) return;

  const label = opts.item.title?.trim() || focusTypeLabel(opts.item.type);
  const subject = `${opts.advisorName} logged a Focus Plan outcome — ${label}`;
  const metrics = [
    opts.item.outcomeLeads != null ? `${opts.item.outcomeLeads} leads` : "",
    opts.item.outcomeClosed != null ? `$${Math.round(opts.item.outcomeClosed).toLocaleString("en-US")} closed` : "",
  ].filter(Boolean).join(" · ");
  const body = `${opts.advisorName} logged the outcome of their ${focusTypeLabel(opts.item.type)} action "${label}":\n\n${opts.item.outcome ?? "(no note)"}${metrics ? `\n\n${metrics}` : ""}\n\nOpen their goal sheet to review and coach: ${appUrl()}/sales/${opts.item.advisorEmployeeId}`;

  const thread = await prisma.thread.create({
    data: {
      subject,
      contextType: "sales_focus",
      contextId: opts.item.id,
      contextLabel: `${opts.advisorName} · ${label}`,
      contextHref: `/sales/${opts.item.advisorEmployeeId}`,
      createdByName: opts.advisorName,
      createdByUserId: opts.authorUserId,
      updatedAt: new Date(),
      messages: { create: { authorName: opts.advisorName, authorUserId: opts.authorUserId, body } },
      participants: { create: participants.map((u) => ({ userId: u.id, name: u.name, email: u.email })) },
    },
  });
  await notifyThread({
    threadId: thread.id, subject, contextLabel: `${opts.advisorName} · ${label}`,
    authorName: opts.advisorName, authorUserId: opts.authorUserId, body, isNew: true,
  });
}
