import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { sendEmail, emailConfigured } from "@/lib/email";

export const runtime = "nodejs";
export const maxDuration = 20;

// Admin-only: fire a real test email through the live provider (Resend) so the
// whole send path + domain can be verified from inside CanopyOS. The attempt is
// logged to the Email Log like any other message (kind "test").
export async function POST(req: Request) {
  const user = await getSessionUser();
  if (!user || user.role !== "admin") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = await req.json().catch(() => null);
  const to = typeof body?.to === "string" ? body.to.trim() : "";
  if (!to || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(to)) {
    return NextResponse.json({ error: "Enter a valid email address." }, { status: 400 });
  }

  const now = new Date();
  const res = await sendEmail({
    to,
    subject: "CanopyOS test email",
    html: `<div style="font-family:system-ui,sans-serif;font-size:14px;color:#0e1a12">
      <p>This is a test email from <strong>CanopyOS</strong>.</p>
      <p>If you're reading this, the email provider (Resend) and sending domain are working.</p>
      <p style="color:#5a6b60">Sent by ${user.name} · ${now.toLocaleString()}</p>
    </div>`,
    text: `CanopyOS test email. If you're reading this, Resend + the sending domain are working. Sent by ${user.name} at ${now.toLocaleString()}.`,
    kind: "test",
  });

  return NextResponse.json({
    ...res,
    providerConfigured: emailConfigured(),
    to,
  });
}
