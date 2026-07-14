import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth";
import { sendEmail } from "@/lib/email";

export const runtime = "nodejs";
export const maxDuration = 60;

const base = () => process.env.APP_URL || process.env.NEXT_PUBLIC_APP_URL || "";

// Daily reminder job. Emails every employee with an incomplete assignment,
// throttled to once per calendar day. Trigger it from a daily scheduler
// (Vercel Cron / GitHub Action) with the CRON_SECRET, or run manually as admin.
export async function POST(req: Request) {
  const secret = process.env.CRON_SECRET;
  const authed = secret && req.headers.get("authorization") === `Bearer ${secret}`;
  if (!authed) {
    const user = await getSessionUser();
    if (!user || user.role !== "admin") return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  const pending = await prisma.trainingAssignment.findMany({
    where: { status: { not: "completed" }, OR: [{ lastReminderAt: null }, { lastReminderAt: { lt: startOfToday } }] },
    include: { course: { select: { title: true } }, employee: { select: { name: true, email: true } } },
  });

  let sent = 0;
  for (const a of pending) {
    const first = a.employee.name.split(" ")[0];
    const due = a.dueDate ? ` (due ${a.dueDate.toLocaleDateString()})` : "";
    const res = await sendEmail({
      to: a.employee.email,
      subject: `Reminder: complete "${a.course.title}"`,
      kind: "training_reminder",
      relatedType: "training_assignment",
      relatedId: a.id,
      text: `Hi ${first},\n\nThis is a reminder to complete your assigned training "${a.course.title}"${due}.\n\nComplete it here: ${base()}/me/training/${a.id}\n\n— Clements Command & Control`,
      html: `<p>Hi ${first},</p><p>Reminder to complete your assigned training <strong>${a.course.title}</strong>${due}.</p><p><a href="${base()}/me/training/${a.id}">Complete your training →</a></p><p>— Clements Command &amp; Control</p>`,
    });
    await prisma.trainingAssignment.update({ where: { id: a.id }, data: { lastReminderAt: now } });
    if (res.status === "sent") sent++;
  }

  return NextResponse.json({ ok: true, candidates: pending.length, emailed: sent });
}
