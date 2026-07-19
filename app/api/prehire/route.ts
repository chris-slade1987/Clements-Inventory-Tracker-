import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth";
import { sendEmail } from "@/lib/email";
import { createPreHire, approveAndConvert, rejectPreHire, canManagePreHire } from "@/lib/prehire";

export const runtime = "nodejs";

const str = (v: unknown) => { const s = typeof v === "string" ? v.trim() : ""; return s === "" ? null : s; };
const base = () => process.env.APP_URL || process.env.NEXT_PUBLIC_APP_URL || "";

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
      return NextResponse.json({ ok: true, employeeId });
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
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
