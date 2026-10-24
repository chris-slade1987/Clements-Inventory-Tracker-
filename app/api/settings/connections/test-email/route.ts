import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { canManageAccessRights } from "@/lib/access";
import { sendEmail, emailConfigured } from "@/lib/email";

// Send a one-off test email to the signed-in super admin so delivery can be
// verified end-to-end from Settings & Admin → Data Connections. Super admins
// only (Chris, Julie, April — same gate as the connections board itself). The
// message goes ONLY to the requester's own mailbox; no arbitrary recipient.
export async function POST() {
  const user = await requireUser();
  if (!canManageAccessRights(user)) {
    return NextResponse.json({ error: "Not authorized." }, { status: 403 });
  }

  const to = (user.email || "").trim();
  if (!to) {
    return NextResponse.json({ error: "Your account has no email address on file." }, { status: 400 });
  }

  if (!emailConfigured()) {
    return NextResponse.json(
      {
        error:
          "No email provider is configured yet. Set RESEND_API_KEY, or add the gmail.send scope to the Workspace service account's domain-wide delegation and set GOOGLE_WORKSPACE_EMAIL_FROM to a real mailbox, then redeploy.",
      },
      { status: 400 },
    );
  }

  const when = new Date().toLocaleString("en-US", { timeZone: "America/New_York", timeZoneName: "short" });
  const html = `
    <div style="font-family:Helvetica Neue,Helvetica,Arial,sans-serif;font-weight:300;color:#1b2a22;line-height:1.5">
      <h2 style="font-weight:300;margin:0 0 12px">CanopyOS — email test</h2>
      <p>This is a test message from the Data Connections board, sent to confirm outbound email is working.</p>
      <p style="color:#5C6B62;font-size:13px">Requested by ${user.name || to} · ${when}</p>
      <p style="color:#5C6B62;font-size:13px">If you received this, Canopy can now deliver inspection reports, huddle invites, training notices and approvals.</p>
    </div>`;

  const result = await sendEmail({
    to,
    subject: "CanopyOS email test",
    html,
    text: `CanopyOS email test — sent ${when}. If you received this, outbound email is working.`,
    kind: "connection_test",
  });

  if (result.status === "sent") {
    return NextResponse.json({ ok: true, to, message: `Test email sent to ${to}. Check your inbox.` });
  }
  return NextResponse.json(
    { error: result.error || `Email not sent (${result.status}).`, status: result.status },
    { status: 502 },
  );
}
