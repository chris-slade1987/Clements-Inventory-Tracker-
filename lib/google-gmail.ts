import "server-only";
import { google } from "googleapis";
import { JWT } from "google-auth-library";
import { getWorkspaceServiceAccount, workspaceDomain } from "@/lib/google-calendar";

// Send email through Google Workspace (Gmail API) using the SAME service account +
// domain-wide delegation already set up for Calendar. The service account
// impersonates a real Workspace mailbox (GOOGLE_WORKSPACE_EMAIL_FROM) and sends as
// it. Requires the `gmail.send` scope to be added to the domain-wide-delegation
// grant (alongside the two calendar scopes) and GOOGLE_WORKSPACE_EMAIL_FROM set to
// a real @<domain> mailbox. Until both are in place this reports not-configured and
// the caller falls back / logs skipped_no_provider.

const GMAIL_SEND_SCOPE = "https://www.googleapis.com/auth/gmail.send";

/** The mailbox to send as / impersonate (a real Workspace address). */
export function gmailSender(): string | null {
  const s = (process.env.GOOGLE_WORKSPACE_EMAIL_FROM || "").trim();
  return s || null;
}

/** True when a service-account key AND a sender mailbox are present. */
export function gmailSendConfigured(): boolean {
  return !!getWorkspaceServiceAccount() && !!gmailSender();
}

/** RFC 2047 encode a header value so UTF-8 subjects/names survive. */
function encodeHeader(v: string): string {
  // eslint-disable-next-line no-control-regex
  return /^[\x00-\x7F]*$/.test(v) ? v : `=?UTF-8?B?${Buffer.from(v, "utf8").toString("base64")}?=`;
}

function buildRawMessage(opts: { from: string; to: string; subject: string; html: string; text: string }): string {
  const boundary = `canopy_${Math.random().toString(36).slice(2)}`;
  const b64 = (s: string) => Buffer.from(s, "utf8").toString("base64");
  const msg = [
    `From: ${opts.from}`,
    `To: ${opts.to}`,
    `Subject: ${encodeHeader(opts.subject)}`,
    "MIME-Version: 1.0",
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    "",
    `--${boundary}`,
    "Content-Type: text/plain; charset=UTF-8",
    "Content-Transfer-Encoding: base64",
    "",
    b64(opts.text),
    "",
    `--${boundary}`,
    "Content-Type: text/html; charset=UTF-8",
    "Content-Transfer-Encoding: base64",
    "",
    b64(opts.html),
    "",
    `--${boundary}--`,
    "",
  ].join("\r\n");
  // base64url for the Gmail API `raw` field.
  return Buffer.from(msg, "utf8").toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** Very light HTML→text fallback when no plain-text body is supplied. */
function htmlToText(html: string): string {
  return html
    .replace(/<\s*br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|tr|h[1-6])>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * Send one message via the Gmail API. `to` may be a comma-separated list. Returns
 * {ok} / {ok:false,error}. Never throws — the caller logs the result.
 */
export async function sendViaGmail(opts: {
  to: string;
  subject: string;
  html: string;
  text?: string;
  fromName?: string;
}): Promise<{ ok: boolean; error?: string }> {
  const sa = getWorkspaceServiceAccount();
  const sender = gmailSender();
  if (!sa || !sender) return { ok: false, error: "gmail_not_configured" };
  const domain = workspaceDomain();
  if (domain && !sender.toLowerCase().endsWith(`@${domain}`)) {
    return { ok: false, error: `GOOGLE_WORKSPACE_EMAIL_FROM (${sender}) is not on @${domain}` };
  }
  try {
    const auth = new JWT({ email: sa.client_email, key: sa.private_key, scopes: [GMAIL_SEND_SCOPE], subject: sender });
    const gmail = google.gmail({ version: "v1", auth });
    const from = opts.fromName ? `${opts.fromName} <${sender}>` : sender;
    const raw = buildRawMessage({ from, to: opts.to, subject: opts.subject, html: opts.html, text: opts.text || htmlToText(opts.html) });
    await gmail.users.messages.send({ userId: "me", requestBody: { raw } });
    return { ok: true };
  } catch (e) {
    const any = e as { message?: string; response?: { data?: { error_description?: string; error?: string } } };
    const reason = any?.response?.data?.error_description || any?.response?.data?.error || any?.message || "send failed";
    let msg = String(reason).slice(0, 300);
    if (/unauthorized_client|access_denied|forbidden|insufficient|invalid_grant|scope/i.test(msg)) {
      msg += " — add the gmail.send scope (https://www.googleapis.com/auth/gmail.send) to the service account's domain-wide delegation grant.";
    }
    return { ok: false, error: msg };
  }
}
