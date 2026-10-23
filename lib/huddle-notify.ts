import "server-only";
import { prisma } from "@/lib/prisma";
import { sendEmail, emailConfigured } from "@/lib/email";
import { postSystemThread, type SystemRecipient } from "@/lib/threads";
import { appUrl } from "@/lib/app-url";

/**
 * Huddle notifications — Canopy's OWN notice when a Huddle is scheduled, moved, or
 * gets new attendees. This is separate from the Google Calendar invite: Google only
 * emails the ATTENDEES about an event, never the organizer about their own event, so
 * the person scheduling otherwise hears nothing. Here we notify EVERY attendee
 * (including the organizer) through both Canopy channels:
 *
 *   1. The in-app Inbox (`postSystemThread`) — the reliable channel that works even
 *      when no email provider is configured. Author "Buzz" (the sanctioned mascot
 *      voice used for Groundwork notices).
 *   2. A dedicated email (`sendEmail`) — gated on `emailConfigured()` exactly like
 *      every other feature; when no provider is set it is skipped gracefully and the
 *      Inbox notice still lands.
 *
 * Privacy: the notice carries only the Huddle title, time, location/Meet link, and a
 * link into Canopy — NEVER note bodies, agenda detail, or follow-ups.
 *
 * Everything here is best-effort + NON-FATAL: any failure is logged (never with a
 * secret) and swallowed so a notification can never fail the underlying Huddle write.
 */

const TZ = "America/New_York";

type NotifyReason = "created" | "rescheduled" | "attendees_added";

const escapeHtml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** Human-readable date + time range in America/New_York (all four branches are ET). */
function formatWhen(start: Date, end: Date | null): string {
  const dayFmt = new Intl.DateTimeFormat("en-US", { weekday: "long", month: "long", day: "numeric", timeZone: TZ });
  const timeFmt = new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", timeZone: TZ });
  const day = dayFmt.format(start);
  const st = timeFmt.format(start);
  const en = end ? timeFmt.format(end) : null;
  return en ? `${day}, ${st}–${en} (ET)` : `${day}, ${st} (ET)`;
}

/** The best "where / how to join" line: a Google Meet link, a custom link, or a place. */
function whereLine(m: { calendarMeetLink: string | null; meetingLink: string | null; location: string | null }): string | null {
  if (m.calendarMeetLink) return `Join Google Meet: ${m.calendarMeetLink}`;
  if (m.meetingLink) return `Join: ${m.meetingLink}`;
  if (m.location) return m.location;
  return null;
}

const LEAD: Record<NotifyReason, { verb: string; subjectPrefix: string; kind: string }> = {
  created: { verb: "scheduled a Huddle", subjectPrefix: "Huddle scheduled", kind: "huddle_scheduled" },
  rescheduled: { verb: "moved a Huddle to a new time", subjectPrefix: "Huddle moved", kind: "huddle_rescheduled" },
  attendees_added: { verb: "added you to a Huddle", subjectPrefix: "Added to a Huddle", kind: "huddle_attendee_added" },
};

/**
 * Notify Huddle attendees (incl. the organizer) that a Huddle was scheduled / moved,
 * or notify only the newly-added attendees. `onlyEmails`, when given, restricts the
 * notice to those attendee emails (used for the "attendees added" case).
 */
export async function notifyHuddleScheduled(
  meetingId: string,
  reason: NotifyReason,
  onlyEmails?: string[],
): Promise<void> {
  try {
    const m = await prisma.meeting.findUnique({ where: { id: meetingId }, include: { attendees: true } });
    if (!m || !m.scheduledStart) return; // nothing to announce without a time
    if (m.status === "cancelled" || m.status === "completed") return;

    const restrict = onlyEmails ? new Set(onlyEmails.map((e) => e.trim().toLowerCase())) : null;
    const recipients: SystemRecipient[] = m.attendees
      .filter((a) => (restrict ? restrict.has(a.email.toLowerCase()) : true))
      .map((a) => ({ userId: a.userId, name: a.name ?? a.email, email: a.email }));
    if (recipients.length === 0) return;

    const lead = LEAD[reason];
    const when = formatWhen(m.scheduledStart, m.scheduledEnd);
    const where = whereLine(m);
    const by = m.organizerName ? `${m.organizerName} ` : "";
    const href = `/groundwork/huddles/${m.id}`;
    const link = appUrl() ? `${appUrl()}${href}` : null;

    // In-app Inbox notice (reliable channel; dedicated email sent separately below).
    await postSystemThread({
      subject: `${lead.subjectPrefix}: ${m.title}`,
      body:
        `${by}${lead.verb} in Groundwork: "${m.title}".\n\n` +
        `When: ${when}\n` +
        (where ? `${where}\n` : "") +
        `\nOpen it in Canopy to see the agenda and add it to your calendar.`,
      recipients,
      contextType: "reminder",
      contextLabel: m.title,
      contextHref: href,
      branch: m.branch,
      authorName: "Buzz",
      emailParticipants: false, // the dedicated Huddle email below replaces the generic one
    });

    // Dedicated email — gated on a configured provider, skipped gracefully otherwise.
    const emails = [...new Set(recipients.map((r) => r.email).filter((e): e is string => !!e))];
    if (emailConfigured() && emails.length) {
      const button = link
        ? `<p style="margin:16px 0"><a href="${link}" style="background:#146A3A;color:#fff;padding:9px 16px;border-radius:8px;text-decoration:none;font-weight:600">Open the Huddle in Canopy</a></p>`
        : "";
      const whereHtml = where ? `<p style="margin:4px 0;color:#334">${escapeHtml(where)}</p>` : "";
      const html =
        `<div style="font-family:system-ui,Arial,sans-serif;max-width:520px">` +
        `<p style="margin:0 0 4px">${escapeHtml(by)}${lead.verb} on CanopyOS.</p>` +
        `<p style="margin:12px 0 4px;font-size:16px;font-weight:600">${escapeHtml(m.title)}</p>` +
        `<p style="margin:4px 0;color:#334"><strong>${escapeHtml(when)}</strong></p>` +
        whereHtml +
        button +
        `<p style="margin:12px 0 0;font-size:12px;color:#889">— Buzz · CanopyOS</p>` +
        `</div>`;
      const text =
        `${by}${lead.verb} on CanopyOS.\n\n` +
        `${m.title}\n${when}\n` +
        (where ? `${where}\n` : "") +
        (link ? `\nOpen it in Canopy: ${link}\n` : "") +
        `\n— Buzz · CanopyOS`;
      await sendEmail({
        to: emails,
        subject: `${lead.subjectPrefix}: ${m.title} — ${when}`,
        html,
        text,
        kind: lead.kind,
        relatedType: "meeting",
        relatedId: m.id,
      });
    }
  } catch (err) {
    console.error(`[huddle-notify] ${reason} ${meetingId} failed (non-fatal):`, err instanceof Error ? err.message : String(err));
  }
}
