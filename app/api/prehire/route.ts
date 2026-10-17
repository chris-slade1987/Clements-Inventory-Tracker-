import { appUrl } from "@/lib/app-url";
import { fail } from "@/lib/http";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth";
import { sendEmail } from "@/lib/email";
import { createPreHire, approveAndConvert, rejectPreHire, canManagePreHire, assignOnboardingCourses } from "@/lib/prehire";
import { grantLogin } from "@/lib/provision";
import { postSystemThread, employeeRecipient } from "@/lib/threads";

export const runtime = "nodejs";
export const maxDuration = 20;

const str = (v: unknown) => { const s = typeof v === "string" ? v.trim() : ""; return s === "" ? null : s; };
const base = () => appUrl();

function magicLink(token: string): string {
  return `${base()}/onboarding/${token}`;
}

async function sendInvite(pre: { name: string; email: string; token: string; position: string | null }) {
  const link = magicLink(pre.token);
  const first = pre.name.split(/\s+/)[0] || "there";
  return sendEmail({
    to: pre.email,
    subject: "Your Clements Pest Control onboarding",
    kind: "prehire_invite",
    relatedType: "prehire",
    relatedId: pre.token,
    text: `Hi ${first},\n\nWelcome aboard! Before your first day${pre.position ? ` as ${pre.position}` : ""}, please complete a short onboarding packet. No account or password is needed — just open your personal link:\n\n${link}\n\nYou can save as you go and finish on any device. If you have questions, reply to this email or contact HR.\n\n— Clements Pest Control`,
    html: `<p>Hi ${first},</p><p>Welcome aboard! Before your first day${pre.position ? ` as <strong>${pre.position}</strong>` : ""}, please complete a short onboarding packet. No account or password is needed — just open your personal link:</p><p><a href="${link}">Start your onboarding →</a></p><p>You can save as you go and finish on any device. If you have questions, reply to this email or contact HR.</p><p>— Clements Pest Control</p>`,
  });
}

export async function POST(req: Request) {
  const user = await getSessionUser();
  if (!user || !canManagePreHire(user))
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = await req.json().catch(() => null);
  const action = str(body?.action);

  try {
    if (action === "create") {
      const name = str(body?.name);
      const email = str(body?.email);
      if (!name || !email) return NextResponse.json({ error: "Name and personal email are required." }, { status: 400 });
      const pre = await createPreHire(
        { name, email, phone: body?.phone, position: body?.position, branch: body?.branch, targetStart: body?.targetStart },
        user.name,
      );
      const res = await sendInvite(pre);
      return NextResponse.json({ ok: true, id: pre.id, link: magicLink(pre.token), emailStatus: res.status });
    }

    if (action === "resend") {
      const id = str(body?.id);
      if (!id) return NextResponse.json({ error: "Missing id." }, { status: 400 });
      const pre = await prisma.preHire.findUnique({ where: { id } });
      if (!pre) return NextResponse.json({ error: "Pre-hire not found." }, { status: 404 });
      const res = await sendInvite(pre);
      return NextResponse.json({ ok: true, link: magicLink(pre.token), emailStatus: res.status });
    }

    if (action === "approve") {
      const id = str(body?.id);
      if (!id) return NextResponse.json({ error: "Missing id." }, { status: 400 });
      const employeeId = await approveAndConvert(id, user.name);
      // If this pre-hire came from a hiring candidate, complete the ATS loop.
      await prisma.candidate.updateMany({ where: { preHireId: id }, data: { stage: "hired" } });
      return NextResponse.json({ ok: true, employeeId });
    }

    // Optional, guarded new-hire handoff: give the (already-converted) hire a
    // login at the chosen level, (re)assign the onboarding course set, and send a
    // welcome by email + in-app Inbox. Reuses the existing grant-login + email.
    if (action === "grant_welcome") {
      const employeeId = str(body?.employeeId);
      if (!employeeId) return NextResponse.json({ error: "Missing employee." }, { status: 400 });
      const accessLevel = str(body?.accessLevel) ?? "technician";
      const result = await grantLogin(prisma, employeeId, accessLevel);
      await assignOnboardingCourses(employeeId);

      const recip = await employeeRecipient(employeeId);
      const first = (recip?.name ?? "there").split(/\s+/)[0];
      const loginUrl = `${base()}/login`;
      // Welcome email to their login address (shared default password to reset).
      await sendEmail({
        to: result.email,
        subject: "Welcome to Clements — your portal login is ready",
        kind: "welcome_login",
        relatedType: "employee",
        relatedId: employeeId,
        text: `Hi ${first},\n\nWelcome aboard! Your Clements portal login is ready.\n\nSign in at ${loginUrl}\nEmail: ${result.email}\nTemporary password: clements123 (you'll be asked to set your own)\n\nOnce you're in, check "My Training" for your onboarding courses.\n\n— Clements Pest Control`,
        html: `<p>Hi ${first},</p><p>Welcome aboard! Your Clements portal login is ready.</p><p><a href="${loginUrl}">Sign in →</a><br/>Email: <strong>${result.email}</strong><br/>Temporary password: <strong>clements123</strong> (you'll be asked to set your own)</p><p>Once you're in, check <strong>My Training</strong> for your onboarding courses.</p><p>— Clements Pest Control</p>`,
      });
      // Reliable in-app welcome (lands in their Inbox the first time they sign in).
      if (recip) {
        await postSystemThread({
          subject: "Welcome to Clements",
          body: `Welcome aboard, ${first}! Your onboarding courses are waiting in My Training, and you can manage your profile, time off, and handbook acknowledgment from your Employee Hub.`,
          recipients: [recip],
          contextType: "general",
          contextLabel: "Welcome",
          contextHref: "/me",
        }).catch(() => {});
      }
      return NextResponse.json({ ok: true, email: result.email, created: result.created });
    }

    if (action === "reject") {
      const id = str(body?.id);
      if (!id) return NextResponse.json({ error: "Missing id." }, { status: 400 });
      await rejectPreHire(id, user.name);
      return NextResponse.json({ ok: true });
    }

    if (action === "delete") {
      const id = str(body?.id);
      if (!id) return NextResponse.json({ error: "Missing id." }, { status: 400 });
      await prisma.preHire.delete({ where: { id } });
      return NextResponse.json({ ok: true });
    }

    return NextResponse.json({ error: "Unknown action." }, { status: 400 });
  } catch (e) {
    return fail(e);
  }
}
