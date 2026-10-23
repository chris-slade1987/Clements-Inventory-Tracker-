import "server-only";
import { google, type calendar_v3 } from "googleapis";
import { JWT } from "google-auth-library";

/**
 * Google Workspace Calendar sync — service account with DOMAIN-WIDE DELEGATION.
 *
 * Mirrors the philosophy of `lib/calendar.ts` (the interview .ics helper): this
 * is the REAL API path, and callers fall back to `.ics` / "Add to Google
 * Calendar" (see `lib/huddle-ics.ts`) whenever the service account isn't
 * configured. Everything here is env-gated and server-only so the app builds and
 * runs with NO Google credentials present (fallback mode), and flips to live
 * sync automatically once the Workspace admin sets the secret.
 *
 * ---- ENV VARS ------------------------------------------------------------
 *   GOOGLE_WORKSPACE_SA_JSON
 *       The full service-account key JSON (the file Google hands you when you
 *       create a key), as a single-line string. Must contain `client_email`
 *       and `private_key`. Alternatively set GOOGLE_WORKSPACE_SA_JSON_BASE64
 *       with the same JSON base64-encoded (handy for some secret stores that
 *       mangle newlines).
 *   GOOGLE_WORKSPACE_CUSTOMER_DOMAIN   (optional, informational / validation)
 *       e.g. "clementspestcontrol.com". When set, impersonation is restricted
 *       to subjects on this domain (defense in depth — we only ever impersonate
 *       @clementspestcontrol.com organizers anyway).
 *   GOOGLE_WORKSPACE_IMPERSONATE_FALLBACK   (optional)
 *       A default subject to impersonate when a caller doesn't pass an
 *       organizer email (rarely needed — createEvent always passes one).
 *
 * ---- GOOGLE ADMIN SETUP (one-time, done by the Workspace super admin) -----
 *   1. In Google Cloud Console, create (or reuse) a project and ENABLE the
 *      "Google Calendar API".
 *   2. Create a Service Account; under its "Keys", add a JSON key and download
 *      it. Note the service account's numeric "Client ID" (the OAuth2 client
 *      id on the service account, NOT the client_email).
 *   3. In the Google Workspace Admin console →
 *      Security → Access and data control → API controls →
 *      Domain-wide delegation → "Add new", paste that numeric Client ID and
 *      grant EXACTLY these scopes (comma-separated):
 *          https://www.googleapis.com/auth/calendar.events
 *          https://www.googleapis.com/auth/calendar.freebusy
 *      (We ask for `calendar.events` to create/update/cancel events and
 *      `calendar.freebusy` for availability — the narrowest pair that works.
 *      `calendar.freebusy` returns busy intervals only, never event details.)
 *   4. Put the downloaded JSON into the environment secret
 *      GOOGLE_WORKSPACE_SA_JSON (Vercel → Project → Settings → Environment
 *      Variables, or `.env` locally) and set GOOGLE_WORKSPACE_CUSTOMER_DOMAIN
 *      to "clementspestcontrol.com".
 *   5. Ensure the deploy environment's network policy ALLOWS outbound HTTPS to
 *      `googleapis.com` (oauth2.googleapis.com + www.googleapis.com).
 *
 * Until step 4 is done, `isCalendarConfigured()` is false and every function
 * here throws a typed `CalendarNotConfiguredError` so callers fall back.
 */

/** The scopes we request via domain-wide delegation. Free/busy is read-only. */
const SCOPES = [
  "https://www.googleapis.com/auth/calendar.events",
  "https://www.googleapis.com/auth/calendar.freebusy",
];

/**
 * Thrown by every live call when no service account is configured. Callers
 * catch this (or check `isCalendarConfigured()` first) and fall back to the
 * `.ics` / add-to-calendar path. A distinct class so a genuine Google API error
 * is never mistaken for "not configured".
 */
export class CalendarNotConfiguredError extends Error {
  readonly code = "CALENDAR_NOT_CONFIGURED" as const;
  constructor(message = "Google Workspace calendar sync is not configured.") {
    super(message);
    this.name = "CalendarNotConfiguredError";
  }
}

type ServiceAccountKey = {
  client_email: string;
  private_key: string;
};

/** Parse+cache the service-account key from env (null when absent/invalid). */
let _saCache: ServiceAccountKey | null | undefined;
function serviceAccount(): ServiceAccountKey | null {
  if (_saCache !== undefined) return _saCache;
  _saCache = loadServiceAccount();
  return _saCache;
}

function loadServiceAccount(): ServiceAccountKey | null {
  let raw = process.env.GOOGLE_WORKSPACE_SA_JSON?.trim();
  if (!raw) {
    const b64 = process.env.GOOGLE_WORKSPACE_SA_JSON_BASE64?.trim();
    if (b64) {
      try {
        raw = Buffer.from(b64, "base64").toString("utf8").trim();
      } catch {
        return null;
      }
    }
  }
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<ServiceAccountKey>;
    const client_email = typeof parsed.client_email === "string" ? parsed.client_email : "";
    // Secret stores often escape newlines; normalize `\n` back to real newlines.
    const private_key =
      typeof parsed.private_key === "string" ? parsed.private_key.replace(/\\n/g, "\n") : "";
    if (!client_email || !private_key) return null;
    return { client_email, private_key };
  } catch {
    return null;
  }
}

/** True when a usable service-account key is present in the environment. */
export function isCalendarConfigured(): boolean {
  return serviceAccount() !== null;
}

/**
 * Non-secret diagnostic for the Data Connections tile:
 *   - "absent"  : no GOOGLE_WORKSPACE_SA_JSON / _BASE64 set at all.
 *   - "invalid" : a key env IS set but could not be parsed into a usable
 *                 {client_email, private_key} (most often the private key's
 *                 newlines were mangled on paste — use the _BASE64 variant).
 *   - "ok"      : a usable service-account key is present.
 * Never returns or logs any secret value — only which of these three states.
 */
export type CalendarConfigState = "ok" | "absent" | "invalid";
export function calendarConfigState(): CalendarConfigState {
  const hasJson = Boolean(process.env.GOOGLE_WORKSPACE_SA_JSON?.trim());
  const hasB64 = Boolean(process.env.GOOGLE_WORKSPACE_SA_JSON_BASE64?.trim());
  if (!hasJson && !hasB64) return "absent";
  return serviceAccount() ? "ok" : "invalid";
}

const DOMAIN = process.env.GOOGLE_WORKSPACE_CUSTOMER_DOMAIN?.trim().toLowerCase() || null;

/**
 * Build a JWT client that impersonates `subject` (an @clementspestcontrol.com
 * mailbox) via domain-wide delegation. Throws CalendarNotConfiguredError when
 * no key is present so every entry point degrades the same way.
 */
function clientFor(subject: string): calendar_v3.Calendar {
  const sa = serviceAccount();
  if (!sa) throw new CalendarNotConfiguredError();

  const who = (subject || process.env.GOOGLE_WORKSPACE_IMPERSONATE_FALLBACK || "").trim();
  if (!who) throw new CalendarNotConfiguredError("No organizer to impersonate for calendar sync.");
  if (DOMAIN && !who.toLowerCase().endsWith(`@${DOMAIN}`)) {
    // Defense in depth: never impersonate outside the configured Workspace domain.
    throw new CalendarNotConfiguredError(`Cannot impersonate ${who} outside @${DOMAIN}.`);
  }

  const auth = new JWT({
    email: sa.client_email,
    key: sa.private_key,
    scopes: SCOPES,
    subject: who,
  });
  return google.calendar({ version: "v3", auth });
}

// ---- Types ---------------------------------------------------------------

export type EventAttendee = { email: string; optional?: boolean; displayName?: string };

export type CreateEventInput = {
  organizerEmail: string;
  attendees: (string | EventAttendee)[];
  title: string;
  description?: string;
  start: Date;
  end: Date;
  location?: string;
  /** Add a Google Meet conference to the event. */
  addMeet?: boolean;
  /** IANA tz for the event's display (defaults to the branch tz, America/New_York). */
  timeZone?: string;
};

export type CreatedEvent = { eventId: string; meetLink?: string; htmlLink: string };

export type EventPatch = {
  title?: string;
  description?: string;
  start?: Date;
  end?: Date;
  location?: string;
  attendees?: (string | EventAttendee)[];
  addMeet?: boolean;
  timeZone?: string;
};

export type BusyInterval = { start: Date; end: Date };
export type FreeBusyByEmail = Record<string, BusyInterval[]>;

const DEFAULT_TZ = "America/New_York";

function normalizeAttendees(
  list: (string | EventAttendee)[] | undefined,
): calendar_v3.Schema$EventAttendee[] | undefined {
  if (!list) return undefined;
  const seen = new Set<string>();
  const out: calendar_v3.Schema$EventAttendee[] = [];
  for (const a of list) {
    const email = (typeof a === "string" ? a : a.email)?.trim().toLowerCase();
    if (!email || seen.has(email)) continue;
    seen.add(email);
    out.push({
      email,
      optional: typeof a === "string" ? undefined : a.optional,
      displayName: typeof a === "string" ? undefined : a.displayName,
    });
  }
  return out;
}

function meetRequest(enable: boolean | undefined): {
  conferenceData?: calendar_v3.Schema$ConferenceData;
  conferenceDataVersion?: number;
} {
  if (!enable) return {};
  return {
    conferenceData: {
      createRequest: {
        requestId: `canopy-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
        conferenceSolutionKey: { type: "hangoutsMeet" },
      },
    },
    conferenceDataVersion: 1,
  };
}

function meetLinkOf(ev: calendar_v3.Schema$Event | undefined): string | undefined {
  if (!ev) return undefined;
  if (ev.hangoutLink) return ev.hangoutLink;
  const entry = ev.conferenceData?.entryPoints?.find((e) => e.entryPointType === "video");
  return entry?.uri ?? undefined;
}

// ---- Live operations (throw CalendarNotConfiguredError when not configured) ----

/**
 * Create a calendar event on the ORGANIZER's calendar (impersonated via
 * domain-wide delegation), inviting all attendees and sending Google's standard
 * invite emails. When `addMeet`, a Google Meet conference is attached and its
 * link returned.
 */
export async function createEvent(input: CreateEventInput): Promise<CreatedEvent> {
  const cal = clientFor(input.organizerEmail);
  const tz = input.timeZone || DEFAULT_TZ;
  const { conferenceData, conferenceDataVersion } = meetRequest(input.addMeet);

  const res = await cal.events.insert({
    calendarId: "primary",
    sendUpdates: "all",
    conferenceDataVersion,
    requestBody: {
      summary: input.title,
      description: input.description,
      location: input.location,
      start: { dateTime: input.start.toISOString(), timeZone: tz },
      end: { dateTime: input.end.toISOString(), timeZone: tz },
      attendees: normalizeAttendees(input.attendees),
      conferenceData,
    },
  });

  const ev = res.data;
  if (!ev.id) throw new Error("Google Calendar did not return an event id.");
  return {
    eventId: ev.id,
    meetLink: meetLinkOf(ev),
    htmlLink: ev.htmlLink || "",
  };
}

/** Patch an existing event (any subset of fields). Re-sends invites to attendees. */
export async function updateEvent(
  organizerEmail: string,
  eventId: string,
  patch: EventPatch,
): Promise<CreatedEvent> {
  const cal = clientFor(organizerEmail);
  const tz = patch.timeZone || DEFAULT_TZ;
  const { conferenceData, conferenceDataVersion } = meetRequest(patch.addMeet);

  const requestBody: calendar_v3.Schema$Event = {};
  if (patch.title !== undefined) requestBody.summary = patch.title;
  if (patch.description !== undefined) requestBody.description = patch.description;
  if (patch.location !== undefined) requestBody.location = patch.location;
  if (patch.start) requestBody.start = { dateTime: patch.start.toISOString(), timeZone: tz };
  if (patch.end) requestBody.end = { dateTime: patch.end.toISOString(), timeZone: tz };
  if (patch.attendees) requestBody.attendees = normalizeAttendees(patch.attendees);
  if (conferenceData) requestBody.conferenceData = conferenceData;

  const res = await cal.events.patch({
    calendarId: "primary",
    eventId,
    sendUpdates: "all",
    conferenceDataVersion,
    requestBody,
  });
  const ev = res.data;
  return { eventId: ev.id || eventId, meetLink: meetLinkOf(ev), htmlLink: ev.htmlLink || "" };
}

/** Cancel (delete) an event and notify attendees. Idempotent-ish: a 404/410 from
 *  an already-removed event is swallowed so re-cancels don't error. */
export async function cancelEvent(organizerEmail: string, eventId: string): Promise<void> {
  const cal = clientFor(organizerEmail);
  try {
    await cal.events.delete({ calendarId: "primary", eventId, sendUpdates: "all" });
  } catch (e) {
    const status = (e as { code?: number; status?: number })?.code ?? (e as { status?: number })?.status;
    if (status === 404 || status === 410) return; // already gone
    throw e;
  }
}

/**
 * Per-email busy intervals in [windowStart, windowEnd). Uses the Calendar
 * free/busy API, which returns ONLY busy time ranges — never event titles,
 * descriptions, attendees, or locations. We impersonate the first attendee (any
 * domain mailbox can query the shared Workspace free/busy); emails that error
 * (e.g. not a real mailbox) come back as an empty busy list rather than failing
 * the whole query.
 */
export async function getFreeBusy(
  emails: string[],
  windowStart: Date,
  windowEnd: Date,
): Promise<FreeBusyByEmail> {
  const unique = [...new Set(emails.map((e) => e.trim().toLowerCase()).filter(Boolean))];
  const out: FreeBusyByEmail = {};
  for (const e of unique) out[e] = [];
  if (unique.length === 0) return out;

  const subject =
    unique.find((e) => !DOMAIN || e.endsWith(`@${DOMAIN}`)) ||
    process.env.GOOGLE_WORKSPACE_IMPERSONATE_FALLBACK ||
    unique[0];
  const cal = clientFor(subject);

  const res = await cal.freebusy.query({
    requestBody: {
      timeMin: windowStart.toISOString(),
      timeMax: windowEnd.toISOString(),
      items: unique.map((id) => ({ id })),
    },
  });

  const calendars = res.data.calendars || {};
  for (const e of unique) {
    const busy = calendars[e]?.busy || [];
    out[e] = busy
      .filter((b) => b.start && b.end)
      .map((b) => ({ start: new Date(b.start as string), end: new Date(b.end as string) }));
  }
  return out;
}
