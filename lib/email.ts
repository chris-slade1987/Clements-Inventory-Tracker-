import { prisma } from "@/lib/prisma";

// Provider-agnostic email sender. Uses Resend when RESEND_API_KEY is set;
// otherwise it cleanly no-ops and records the intent in EmailLog so nothing
// breaks before addresses / a provider are configured. Every attempt — sent,
// skipped, or errored — is logged for admin/HR visibility.

export type SendResult = { status: "sent" | "skipped_no_provider" | "skipped_no_address" | "error"; error?: string };

const FROM = process.env.EMAIL_FROM || "CanopyOS <no-reply@clementspestcontrol.com>";
// Display name for the Gmail-send path (which sends AS GOOGLE_WORKSPACE_EMAIL_FROM).
const FROM_NAME = (FROM.match(/^\s*(.*?)\s*</)?.[1] || "CanopyOS").trim() || "CanopyOS";

/** Gmail-send (Workspace service account) is usable when a SA key AND a sender
 *  mailbox are set — checked via env only so this stays sync and import-light. */
function gmailEnvPresent(): boolean {
  return (
    !!(process.env.GOOGLE_WORKSPACE_SA_JSON || process.env.GOOGLE_WORKSPACE_SA_JSON_BASE64) &&
    !!(process.env.GOOGLE_WORKSPACE_EMAIL_FROM || "").trim()
  );
}

export async function sendEmail(opts: {
  to: string | string[] | null | undefined;
  subject: string;
  html: string;
  text?: string;
  kind: string;
  relatedType?: string;
  relatedId?: string;
}): Promise<SendResult> {
  const recipients = (Array.isArray(opts.to) ? opts.to : [opts.to])
    .map((t) => (t ?? "").trim().toLowerCase())
    .filter(Boolean);
  const unique = [...new Set(recipients)];
  const intended = unique.join(", ");

  // Sandbox/staging catch-all: when EMAIL_TEST_REDIRECT is set, every message that
  // HAS a real recipient is rerouted to that single address, with the original
  // recipient(s) preserved in the subject (and logged below). Lets the whole flow
  // be exercised from one inbox without a verified domain or editing real
  // personnel data. Leave UNSET in production so mail goes to real recipients.
  const redirect = process.env.EMAIL_TEST_REDIRECT?.trim().toLowerCase() || null;
  const to = redirect && intended ? redirect : intended;
  const subject = redirect && intended ? `[test → ${intended}] ${opts.subject}` : opts.subject;
  let result: SendResult;

  // Provider order: Resend (if its key is set), else Google Workspace Gmail-send
  // (the service account already used for Calendar, impersonating
  // GOOGLE_WORKSPACE_EMAIL_FROM). Falls back to a logged no-op when neither is set.
  const gmailReady = !process.env.RESEND_API_KEY && gmailEnvPresent();

  if (!to) {
    result = { status: "skipped_no_address" };
  } else if (process.env.RESEND_API_KEY) {
    try {
      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${process.env.RESEND_API_KEY}` },
        body: JSON.stringify({ from: FROM, to, subject, html: opts.html, text: opts.text }),
      });
      result = res.ok ? { status: "sent" } : { status: "error", error: `Resend ${res.status}: ${await res.text()}` };
    } catch (e) {
      result = { status: "error", error: (e as Error).message };
    }
  } else if (gmailReady) {
    try {
      const { sendViaGmail } = await import("@/lib/google-gmail");
      const r = await sendViaGmail({ to, subject, html: opts.html, text: opts.text, fromName: FROM_NAME });
      result = r.ok ? { status: "sent" } : { status: "error", error: r.error };
    } catch (e) {
      result = { status: "error", error: (e as Error).message };
    }
  } else {
    result = { status: "skipped_no_provider" };
  }

  await prisma.emailLog
    .create({
      data: {
        to: to || "(none)",
        subject,
        kind: opts.kind,
        status: result.status,
        error: result.error ?? null,
        relatedType: opts.relatedType ?? null,
        relatedId: opts.relatedId ?? null,
      },
    })
    .catch(() => {});

  return result;
}

export function emailConfigured(): boolean {
  return !!process.env.RESEND_API_KEY || gmailEnvPresent();
}
