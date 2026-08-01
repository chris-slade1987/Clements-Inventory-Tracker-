import "server-only";

// Calendar invites for interviews. v1 generates a standards-compliant .ics
// (VCALENDAR/VEVENT) plus an "Add to Google Calendar" template URL, and cleanly
// distinguishes IN-PERSON (show location) from VIDEO (show meeting link / a
// note that a Meet link is TBD). Everything is derived from the Interview row
// so a real Google Calendar API can later slot in behind the same shape.
//
// ---- FUTURE: real Google Calendar API -------------------------------------
// When a Workspace service account is configured, `createGoogleEvent()` will
// create the event server-side on assignment, invite the interviewer +
// candidate, auto-generate a Google Meet link for video interviews, and return
// the event id + Meet URL to store on Interview.calendarEventId / meetingLink.
// It returns null today (no credentials) so callers fall back to .ics + link.

export type InterviewLike = {
  id: string;
  scheduledAt: Date | null;
  durationMins: number;
  type: string; // "in_person" | "video"
  location: string | null;
  meetingLink: string | null;
  interviewerName: string | null;
  interviewerEmail: string | null;
};

export type CandidateLike = {
  name: string;
  email: string;
  jobTitle?: string | null;
};

const APP_NAME = "Canopy OS";

/** UTC timestamp in the iCalendar basic format: 20260719T143000Z. */
function toIcsUtc(d: Date): string {
  return d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}

/** Google Calendar wants the same basic format for its dates param. */
function toGoogleDate(d: Date): string {
  return toIcsUtc(d);
}

function endOf(interview: InterviewLike): Date | null {
  if (!interview.scheduledAt) return null;
  return new Date(interview.scheduledAt.getTime() + interview.durationMins * 60_000);
}

export function interviewTitle(candidate: CandidateLike): string {
  const job = candidate.jobTitle ? ` (${candidate.jobTitle})` : "";
  return `Interview — ${candidate.name}${job}`;
}

/** Human-readable "where"/"how" block, distinguishing in-person vs video. */
export function locationLine(interview: InterviewLike): string {
  if (interview.type === "video") {
    return interview.meetingLink
      ? `Video interview — join: ${interview.meetingLink}`
      : "Video interview — Google Meet link to be added.";
  }
  return interview.location
    ? `In person — ${interview.location}`
    : "In person — location to be confirmed.";
}

/** The value that belongs in the calendar's LOCATION field. */
function locationField(interview: InterviewLike): string {
  if (interview.type === "video") return interview.meetingLink || "Video call (link TBD)";
  return interview.location || "Clements Pest Control";
}

function icsEscape(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\n/g, "\\n");
}

/**
 * Build a valid VCALENDAR/VEVENT string for the interview. Interviewer +
 * candidate are attendees; the organizer is the app. Returns null when there is
 * no scheduled time (nothing to put on a calendar yet).
 */
export function buildIcs(interview: InterviewLike, candidate: CandidateLike): string | null {
  const start = interview.scheduledAt;
  const end = endOf(interview);
  if (!start || !end) return null;

  const title = interviewTitle(candidate);
  const descLines = [
    locationLine(interview),
    "",
    `Candidate: ${candidate.name}${candidate.email ? ` <${candidate.email}>` : ""}`,
    interview.interviewerName ? `Interviewer: ${interview.interviewerName}` : null,
    "",
    "Please complete the interview scorecard in the Clements portal after the meeting.",
  ].filter((l) => l !== null) as string[];

  const attendees: string[] = [];
  if (interview.interviewerEmail) {
    attendees.push(`ATTENDEE;ROLE=REQ-PARTICIPANT;CN=${icsEscape(interview.interviewerName || "Interviewer")}:mailto:${interview.interviewerEmail}`);
  }
  if (candidate.email) {
    attendees.push(`ATTENDEE;ROLE=REQ-PARTICIPANT;CN=${icsEscape(candidate.name)}:mailto:${candidate.email}`);
  }

  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    `PRODID:-//${APP_NAME}//Hiring//EN`,
    "CALSCALE:GREGORIAN",
    "METHOD:REQUEST",
    "BEGIN:VEVENT",
    `UID:interview-${interview.id}@clementspestcontrol.com`,
    `DTSTAMP:${toIcsUtc(new Date())}`,
    `DTSTART:${toIcsUtc(start)}`,
    `DTEND:${toIcsUtc(end)}`,
    `SUMMARY:${icsEscape(title)}`,
    `DESCRIPTION:${icsEscape(descLines.join("\n"))}`,
    `LOCATION:${icsEscape(locationField(interview))}`,
    ...attendees,
    "STATUS:CONFIRMED",
    "END:VEVENT",
    "END:VCALENDAR",
  ];
  // iCalendar uses CRLF line endings.
  return lines.join("\r\n");
}

/** A pre-filled "Add to Google Calendar" template URL. */
export function googleCalendarUrl(interview: InterviewLike, candidate: CandidateLike): string | null {
  const start = interview.scheduledAt;
  const end = endOf(interview);
  if (!start || !end) return null;

  const params = new URLSearchParams({
    action: "TEMPLATE",
    text: interviewTitle(candidate),
    dates: `${toGoogleDate(start)}/${toGoogleDate(end)}`,
    details: [
      locationLine(interview),
      `Candidate: ${candidate.name}${candidate.email ? ` <${candidate.email}>` : ""}`,
      interview.interviewerName ? `Interviewer: ${interview.interviewerName}` : "",
      "Complete the scorecard in the Clements portal afterward.",
    ]
      .filter(Boolean)
      .join("\n"),
    location: locationField(interview),
  });
  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}

/**
 * FUTURE extension point — create the event on Google Calendar server-side via a
 * Workspace service account (auto-generating a Meet link for video interviews).
 * Returns null today (no credentials configured) so the caller falls back to the
 * .ics attachment + Google template link. Wire the real API call here and return
 * { eventId, meetLink } to persist on the Interview row.
 */
export async function createGoogleEvent(
  _interview: InterviewLike,
  _candidate: CandidateLike,
): Promise<{ eventId: string; meetLink: string | null } | null> {
  // No Google Workspace credentials in this environment — intentionally a no-op.
  return null;
}
