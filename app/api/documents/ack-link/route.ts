import { fail } from "@/lib/http";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth";
import { canViewAllPto } from "@/lib/pto";
import { isHrDirector } from "@/lib/personnel";
import { sendEmail } from "@/lib/email";
import { generateAckToken, handbookAckRoster, HANDBOOK_SLUG } from "@/lib/policy-docs";
import { postSystemThread, employeeRecipient } from "@/lib/threads";

export const runtime = "nodejs";
export const maxDuration = 30;

// HR/admin only. Drives the handbook re-acknowledgment push:
//   (default/"link") — generate a login-free, per-employee ack link (copyable).
//   "email"          — remind ONE employee: a logged-in employee gets an in-app
//                      Inbox nudge to /resources/handbook (no token needed);
//                      everyone else gets a generated token link emailed to them.
//   "remind_all"     — do that for every OUTSTANDING employee on the current
//                      handbook version, in one click.

/** Nudge one employee to (re)acknowledge. Login → in-app nudge; else emailed
 *  token link. Returns how it was delivered. */
async function remindEmployee(
  emp: { id: string; name: string; email: string | null; branch: string | null; userId: string | null },
  req: Request,
): Promise<"inapp" | "emailed" | "skipped"> {
  if (emp.userId) {
    // They can sign in and acknowledge in-app — no token link needed.
    const recip = await employeeRecipient(emp.id);
    if (!recip) return "skipped";
    await postSystemThread({
      subject: "Please acknowledge the Employee Handbook",
      body: "A current version of the Employee Handbook needs your acknowledgment. Open Handbook & policies, read it, and sign at the bottom — it only takes a minute.",
      recipients: [recip],
      contextType: "reminder",
      contextLabel: "Handbook acknowledgment",
      contextHref: "/resources/handbook",
      branch: emp.branch,
    });
    return "inapp";
  }
  // No login — email a one-time signing link.
  if (!emp.email) return "skipped";
  const { token } = await generateAckToken(HANDBOOK_SLUG, emp.id, emp.name);
  const url = new URL(`/handbook-ack/${token}`, req.url).toString();
  const first = emp.name.split(/\s+/)[0] || "there";
  const res = await sendEmail({
    to: emp.email,
    subject: "Please acknowledge the Employee Handbook",
    kind: "handbook_remind",
    relatedType: "policy_document",
    relatedId: emp.id,
    text: `Hi ${first},\n\nPlease review and acknowledge the Employee Handbook. No login is needed — open your personal link and type your name to sign:\n\n${url}\n\n— Clements Pest Control`,
    html: `<p>Hi ${first},</p><p>Please review and acknowledge the Employee Handbook. No login is needed — open your personal link and type your name to sign:</p><p><a href="${url}">Review &amp; acknowledge →</a></p><p>— Clements Pest Control</p>`,
  });
  return res.status === "sent" ? "emailed" : "skipped";
}

export async function POST(req: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  if (!(canViewAllPto(user) || isHrDirector(user))) {
    return NextResponse.json({ error: "Not authorized." }, { status: 403 });
  }

  const body = await req.json().catch(() => null);
  const action = typeof body?.action === "string" ? body.action : "link";

  try {
    // Bulk: remind every outstanding employee on the current version.
    if (action === "remind_all") {
      const { rows } = await handbookAckRoster();
      const outstanding = rows.filter((r) => !r.acknowledged);
      if (outstanding.length === 0) return NextResponse.json({ ok: true, inApp: 0, emailed: 0, skipped: 0, total: 0 });
      const emps = await prisma.employee.findMany({
        where: { id: { in: outstanding.map((r) => r.employeeId) } },
        select: { id: true, name: true, email: true, branch: true, user: { select: { id: true } } },
      });
      let inApp = 0, emailed = 0, skipped = 0;
      for (const e of emps) {
        const how = await remindEmployee({ id: e.id, name: e.name, email: e.email, branch: e.branch, userId: e.user?.id ?? null }, req);
        if (how === "inapp") inApp++; else if (how === "emailed") emailed++; else skipped++;
      }
      return NextResponse.json({ ok: true, inApp, emailed, skipped, total: emps.length });
    }

    const employeeId = typeof body?.employeeId === "string" ? body.employeeId : "";
    if (!employeeId) return NextResponse.json({ error: "Missing employee." }, { status: 400 });
    const employee = await prisma.employee.findUnique({
      where: { id: employeeId },
      select: { id: true, name: true, email: true, branch: true, user: { select: { id: true } } },
    });
    if (!employee) return NextResponse.json({ error: "Employee not found." }, { status: 404 });

    // Remind one employee (in-app nudge or emailed link).
    if (action === "email") {
      const how = await remindEmployee({ id: employee.id, name: employee.name, email: employee.email, branch: employee.branch, userId: employee.user?.id ?? null }, req);
      if (how === "skipped") return NextResponse.json({ error: "No login or email on file for this person — copy a link to share instead." }, { status: 400 });
      return NextResponse.json({ ok: true, mode: how });
    }

    // Default: generate a copyable per-employee link.
    const { token } = await generateAckToken(HANDBOOK_SLUG, employee.id, employee.name);
    const url = new URL(`/handbook-ack/${token}`, req.url).toString();
    return NextResponse.json({ ok: true, url, token });
  } catch (e) {
    return fail(e);
  }
}
