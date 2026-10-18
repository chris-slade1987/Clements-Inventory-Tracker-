import "server-only";

/**
 * Huddle calendar fallback — the `.ics` + "Add to Google Calendar" builder used
 * when the Google Workspace service account isn't configured (see
 * `lib/google-calendar.ts` → `isCalendarConfigured()`).
 *
 * This mirrors the interview helper in `lib/calendar.ts` (same VCALENDAR/VEVENT
 * + template-URL philosophy) but takes a plain Huddle-shaped input — emails and
 * times — so it stays independent of the Meeting model (Round 1-A). It does NOT
 * touch `lib/calendar.ts`; the interview flow keeps its own builder.
 */

export type HuddleAttendee = { email: string; name?: string | null };

export type HuddleLike = {
  /** Stable id for the UID (any unique string — a Meeting id, or a generated one). */
  id: string;
  title: string;
  description?: string | null;
  start: Date;
  end: Date;
  /** Physical location, OR a Meet/video link when virtual. */
  location?: string | null;
  meetingLink?: string | null;
  organizer?: HuddleAttendee | null;
  attendees?: HuddleAttendee[];
};

const APP_NAME = "CanopyOS";

/** UTC timestamp in the iCalendar basic format: 20260719T143000Z. */
function toIcsUtc(d: Date): string {
  return d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}

function icsEscape(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\n/g, "\\n");
}

/** Human-readable "where"/"how" line, distinguishing a Meet link from a place. */
export function huddleLocationLine(h: HuddleLike): string {
  if (h.meetingLink) return `Join Google Meet: ${h.meetingLink}`;
  if (h.location) return h.location;
  return "Location to be confirmed.";
}

/** The value that belongs in the calendar's LOCATION field. */
function locationField(h: HuddleLike): string {
  return h.meetingLink || h.location || "Clements Pest Control";
}

/**
 * Build a valid VCALENDAR/VEVENT string for a Huddle. Organizer + attendees are
 * written as ORGANIZER/ATTENDEE lines so the file imports as an invite. Returns
 * null when start/end are missing (nothing to place on a calendar yet).
 */
export function buildHuddleIcs(h: HuddleLike): string | null {
  if (!h.start || !h.end) return null;

  const descLines = [
    h.description || "",
    "",
    huddleLocationLine(h),
  ].filter((l, i) => !(i === 0 && !l)) as string[];

  const lines: string[] = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    `PRODID:-//${APP_NAME}//Huddles//EN`,
    "CALSCALE:GREGORIAN",
    "METHOD:REQUEST",
    "BEGIN:VEVENT",
    `UID:huddle-${h.id}@clementspestcontrol.com`,
    `DTSTAMP:${toIcsUtc(new Date())}`,
    `DTSTART:${toIcsUtc(h.start)}`,
    `DTEND:${toIcsUtc(h.end)}`,
    `SUMMARY:${icsEscape(h.title)}`,
    `DESCRIPTION:${icsEscape(descLines.join("\n"))}`,
    `LOCATION:${icsEscape(locationField(h))}`,
  ];

  if (h.organizer?.email) {
    const cn = icsEscape(h.organizer.name || h.organizer.email);
    lines.push(`ORGANIZER;CN=${cn}:mailto:${h.organizer.email}`);
  }
  for (const a of h.attendees || []) {
    if (!a.email) continue;
    lines.push(
      `ATTENDEE;ROLE=REQ-PARTICIPANT;RSVP=TRUE;CN=${icsEscape(a.name || a.email)}:mailto:${a.email}`,
    );
  }

  lines.push("STATUS:CONFIRMED", "END:VEVENT", "END:VCALENDAR");
  // iCalendar uses CRLF line endings.
  return lines.join("\r\n");
}

/** A pre-filled "Add to Google Calendar" template URL for a Huddle. */
export function huddleGoogleCalendarUrl(h: HuddleLike): string | null {
  if (!h.start || !h.end) return null;
  const params = new URLSearchParams({
    action: "TEMPLATE",
    text: h.title,
    dates: `${toIcsUtc(h.start)}/${toIcsUtc(h.end)}`,
    details: [h.description || "", huddleLocationLine(h)].filter(Boolean).join("\n"),
    location: locationField(h),
  });
  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}
