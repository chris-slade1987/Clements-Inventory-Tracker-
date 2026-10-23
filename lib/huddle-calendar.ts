import "server-only";
import { prisma } from "@/lib/prisma";
import {
  createEvent,
  updateEvent,
  cancelEvent,
  isCalendarConfigured,
  CalendarNotConfiguredError,
} from "@/lib/google-calendar";

/**
 * Huddle ↔ Google Calendar sync — the glue between the Huddle engine
 * (`lib/huddles.ts`) and the live Workspace write API (`lib/google-calendar.ts`).
 *
 * Scheduling a Huddle auto-creates a real Google Calendar event on the ORGANIZER's
 * calendar (impersonated via domain-wide delegation), invites the domain attendees
 * (Google sends its own invite emails), and attaches a Google Meet link by default
 * — then keeps it in sync on update / cancel / attendee changes. The synced event is
 * remembered on the Meeting row (`calendarEventId` / `calendarMeetLink` /
 * `calendarOrganizerEmail` / `calendarHtmlLink`).
 *
 * EVERYTHING here is best-effort and NON-FATAL: every path no-ops cleanly when the
 * service account isn't configured, when the Huddle has no scheduled time, or when
 * the organizer isn't an `@clementspestcontrol.com` mailbox — and any Google error
 * is logged (never with a secret) and swallowed, so a calendar failure can never
 * fail the underlying Huddle write. The `.ics` / "Add to Google Calendar" fallback
 * (`lib/huddle-ics.ts`) remains for every not-synced case.
 *
 * Privacy: the event description carries only the Huddle title + kind — NEVER note
 * bodies, follow-ups, or any other content. Only `@clementspestcontrol.com`
 * attendees are invited/synced; external emails are skipped (and the impersonated
 * organizer subject is always a domain mailbox, enforced here and in the client).
 */

/** The company's Workspace domain — the only mailboxes we impersonate or invite. */
const COMPANY_DOMAIN = "clementspestcontrol.com";

/** All four branches are in Florida (Eastern). The client defaults to this too. */
const HUDDLE_TZ = "America/New_York";

type SyncMode = "full" | "create-only" | "patch-only";

const isDomainEmail = (email: string | null | undefined): boolean =>
  !!email && email.trim().toLowerCase().endsWith(`@${COMPANY_DOMAIN}`);

/** A short, safe event description — title/kind only, NO sensitive note bodies. */
function describe(kind: string | null): string {
  const label = kind ? `${kind.replace(/_/g, " ")} Huddle` : "Huddle";
  return `${label} — scheduled via CanopyOS (Groundwork).`;
}

/** Deduped, lowercased @clementspestcontrol.com attendee emails to invite. */
function domainAttendeeEmails(attendees: { email: string }[]): string[] {
  return [
    ...new Set(
      attendees
        .map((a) => a.email.trim().toLowerCase())
        .filter(isDomainEmail),
    ),
  ];
}

/** Log a calendar sync problem without ever leaking a secret value. */
function logCalendarIssue(op: string, meetingId: string, e: unknown): void {
  if (e instanceof CalendarNotConfiguredError) {
    console.warn(`huddle-calendar: ${op} skipped for ${meetingId} — ${e.message}`);
    return;
  }
  console.error(
    `huddle-calendar: ${op} failed for ${meetingId} (non-fatal, .ics fallback remains):`,
    e instanceof Error ? e.message : String(e),
  );
}

/**
 * Create / update the Huddle's Google Calendar event to match the current row.
 *
 *  - `"full"`        (create + update): create the event if none exists, else patch
 *                    the existing one (used on create, and on update when the
 *                    time/title/location changed).
 *  - `"create-only"` : create the event if missing; leave an existing one untouched
 *                    (used on update when nothing calendar-relevant changed, so an
 *                    event missed earlier — e.g. created while calendar was down — is
 *                    backfilled without re-sending invites on every edit).
 *  - `"patch-only"`  : patch the existing event (e.g. attendee add/remove) so Google
 *                    re-invites/uninvites; never creates one.
 */
export async function reconcileHuddleEvent(meetingId: string, mode: SyncMode = "full"): Promise<void> {
  if (!isCalendarConfigured()) return;

  const m = await prisma.meeting.findUnique({
    where: { id: meetingId },
    include: { attendees: true },
  });
  if (!m) return;
  // Cancelled/completed Huddles don't get (re)created here; cancel is handled by
  // cancelHuddleEvent, and a finished Huddle keeps whatever event it had.
  if (m.status === "cancelled" || m.status === "completed") return;
  if (!m.scheduledStart || !m.scheduledEnd) return; // nothing to place on a calendar yet

  const organizerEmail =
    m.calendarOrganizerEmail ||
    m.attendees.find((a) => a.role === "organizer")?.email ||
    null;
  if (!isDomainEmail(organizerEmail)) return; // organizer must be a domain mailbox

  const attendees = domainAttendeeEmails(m.attendees);

  try {
    if (m.calendarEventId) {
      if (mode === "create-only") return; // already synced, nothing changed
      const res = await updateEvent(organizerEmail!, m.calendarEventId, {
        title: m.title,
        description: describe(m.kind),
        start: m.scheduledStart,
        end: m.scheduledEnd,
        location: m.location || undefined,
        attendees,
        timeZone: HUDDLE_TZ,
      });
      // Refresh the stored links if Google returned them (they normally don't change).
      const data: { calendarMeetLink?: string; calendarHtmlLink?: string } = {};
      if (res.meetLink) data.calendarMeetLink = res.meetLink;
      if (res.htmlLink) data.calendarHtmlLink = res.htmlLink;
      if (Object.keys(data).length) {
        await prisma.meeting.update({ where: { id: m.id }, data });
      }
    } else {
      if (mode === "patch-only") return; // no event to patch (don't create on attendee-only changes)
      const created = await createEvent({
        organizerEmail: organizerEmail!,
        attendees,
        title: m.title,
        description: describe(m.kind),
        start: m.scheduledStart,
        end: m.scheduledEnd,
        location: m.location || undefined,
        addMeet: true, // attach a Google Meet link by default
        timeZone: HUDDLE_TZ,
      });
      await prisma.meeting.update({
        where: { id: m.id },
        data: {
          calendarEventId: created.eventId,
          calendarMeetLink: created.meetLink ?? null,
          calendarHtmlLink: created.htmlLink || null,
          calendarOrganizerEmail: organizerEmail,
        },
      });
    }
  } catch (e) {
    logCalendarIssue("reconcile", m.id, e);
  }
}

/**
 * Cancel the Huddle's Google Calendar event (Google notifies the attendees) and
 * clear the stored event id/links so the UI falls back cleanly. No-op when there's
 * no synced event. `cancelEvent` already swallows a 404/410 (already-gone) event.
 */
export async function cancelHuddleEvent(meetingId: string): Promise<void> {
  if (!isCalendarConfigured()) return;

  const m = await prisma.meeting.findUnique({
    where: { id: meetingId },
    include: { attendees: true },
  });
  if (!m || !m.calendarEventId) return;

  const organizerEmail =
    m.calendarOrganizerEmail ||
    m.attendees.find((a) => a.role === "organizer")?.email ||
    null;
  if (!isDomainEmail(organizerEmail)) return;

  try {
    await cancelEvent(organizerEmail!, m.calendarEventId);
    await prisma.meeting.update({
      where: { id: m.id },
      data: { calendarEventId: null, calendarMeetLink: null, calendarHtmlLink: null },
    });
  } catch (e) {
    logCalendarIssue("cancel", m.id, e);
  }
}
