import { prisma } from "@/lib/prisma";

// Provider-agnostic email sender. Uses Resend when RESEND_API_KEY is set;
// otherwise it cleanly no-ops and records the intent in EmailLog so nothing
// breaks before addresses / a provider are configured. Every attempt — sent,
// skipped, or errored — is logged for admin/HR visibility.

export type SendResult = { status: "sent" | "skipped_no_provider" | "skipped_no_address" | "error"; error?: string };

const FROM = process.env.EMAIL_FROM || "Canopy OS <no-reply@clementspestcontrol.com>";

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
  const to = unique.join(", ");
  let result: SendResult;

  if (!to) {
    result = { status: "skipped_no_address" };
  } else if (!process.env.RESEND_API_KEY) {
    result = { status: "skipped_no_provider" };
  } else {
    try {
      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${process.env.RESEND_API_KEY}` },
        body: JSON.stringify({ from: FROM, to, subject: opts.subject, html: opts.html, text: opts.text }),
      });
      result = res.ok ? { status: "sent" } : { status: "error", error: `Resend ${res.status}: ${await res.text()}` };
    } catch (e) {
      result = { status: "error", error: (e as Error).message };
    }
  }

  await prisma.emailLog
    .create({
      data: {
        to: to || "(none)",
        subject: opts.subject,
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
  return !!process.env.RESEND_API_KEY;
}
