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

/** Rebuild a canonical PEM from a private key however its newlines arrived —
 *  escaped `\n`, real CR/LF, or stripped entirely — so a mangled paste still works. */
function normalizePrivateKey(k: string): string {
  const body = k
    .replace(/\\r\\n/g, "\n")
    .replace(/\\n/g, "\n")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .trim();
  // Keep exactly one trailing newline (the canonical PEM form, unchanged from the
  // prior behavior for a correctly-set key).
  return body ? `${body}\n` : body;
}

/** Strict parse: the value is well-formed JSON (a correct paste, or decoded base64). */
function parseStrict(raw: string): ServiceAccountKey | null {
  try {
    const parsed = JSON.parse(raw) as Partial<ServiceAccountKey>;
    const client_email = typeof parsed.client_email === "string" ? parsed.client_email.trim() : "";
    const private_key =
      typeof parsed.private_key === "string" ? normalizePrivateKey(parsed.private_key) : "";
    if (!client_email || !private_key.includes("PRIVATE KEY")) return null;
    return { client_email, private_key };
  } catch {
    return null;
  }
}

/**
 * Lenient recovery for the classic broken paste: when the private key's `\n`
 * escapes were turned into REAL line breaks, the value is no longer valid JSON and
 * parseStrict throws. We pull `client_email` (a single safe line) and the PEM block
 * out by regex — tolerating real newlines, escaped `\n`, or none between the BEGIN/END
 * markers — then rebuild a canonical 64-column PEM. This also survives a value that a
 * secret store wrapped in extra quotes, since we scan the raw text directly.
 */
function parseLenient(raw: string): ServiceAccountKey | null {
  const emailMatch = raw.match(/"client_email"\s*:\s*"([^"\s]+@[^"\s]+)"/);
  const pemMatch = raw.match(
    /(-----BEGIN [A-Z ]*PRIVATE KEY-----)([\s\S]*?)(-----END [A-Z ]*PRIVATE KEY-----)/,
  );
  if (!emailMatch || !pemMatch) return null;
  // The base64 body: drop escaped `\n`, real whitespace, and stray quotes/commas, then
  // re-wrap at 64 chars into a proper PEM.
  const body = pemMatch[2].replace(/\\n/g, "").replace(/[\s"',]/g, "").trim();
  if (!body) return null;
  const wrapped = body.match(/.{1,64}/g)?.join("\n") ?? body;
  const private_key = `${pemMatch[1]}\n${wrapped}\n${pemMatch[3]}\n`;
  return { client_email: emailMatch[1].trim(), private_key };
}

function loadServiceAccount(): ServiceAccountKey | null {
  // Collect every candidate source, then return the FIRST that yields a usable key.
  // Order: the plain JSON var, then the base64 var. Crucially this no longer
  // requires the JSON var to be empty before trying base64 — so if someone set a
  // mangled GOOGLE_WORKSPACE_SA_JSON *and* a clean GOOGLE_WORKSPACE_SA_JSON_BASE64,
  // the clean base64 one wins instead of the broken plain one blocking it.
  const candidates: string[] = [];
  const jsonRaw = process.env.GOOGLE_WORKSPACE_SA_JSON?.trim();
  if (jsonRaw) candidates.push(jsonRaw);
  const b64 = process.env.GOOGLE_WORKSPACE_SA_JSON_BASE64?.trim();
  if (b64) {
    try {
      const decoded = Buffer.from(b64, "base64").toString("utf8").trim();
      if (decoded) candidates.push(decoded);
    } catch {
      /* ignore a bad base64 value — a later candidate may still work */
    }
  }
  for (const raw of candidates) {
    // Strict first (correct paste / base64); fall back to lenient recovery of a
    // newline-mangled or quote-wrapped paste so a near-miss value still connects.
    const parsed = parseStrict(raw) ?? parseLenient(raw);
    if (parsed) return parsed;
  }
  return null;
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

/** Turn a Google/Gaxios error into a short, admin-readable reason — with a plain
 *  hint for the two usual causes (delegation not granted, or API not enabled). */
function describeCalendarError(e: unknown): string {
  const any = e as {
    message?: string;
    code?: number | string;
    response?: { data?: { error?: string; error_description?: string; error_message?: string } };
    errors?: { message?: string }[];
  };
  const d = any?.response?.data;
  const parts = [
    typeof d?.error === "string" ? d.error : undefined,
    typeof d?.error_description === "string" ? d.error_description : undefined,
    typeof d?.error_message === "string" ? d.error_message : undefined,
    any?.errors?.[0]?.message,
    any?.message,
  ].filter(Boolean);
  let msg = (parts.join(" — ") || "Unknown calendar error.").trim();
  if (/unauthorized_client|not authorized|access_denied|forbidden|insufficient|invalid_grant/i.test(msg)) {
    msg +=
      " — Likely the service account's DOMAIN-WIDE DELEGATION isn't granted (or is missing a scope). In Google Workspace Admin → Security → Access and data control → API controls → Domain-wide delegation, add the service account's numeric Client ID with scopes https://www.googleapis.com/auth/calendar.events,https://www.googleapis.com/auth/calendar.freebusy. New grants can take a few minutes to propagate.";
  } else if (/has not been used|SERVICE_DISABLED|accessNotConfigured|disabled/i.test(msg)) {
    msg += " — Likely the Google Calendar API is not enabled in the Cloud project.";
  }
  return msg.slice(0, 500);
}

/**
 * Live connectivity probe for the Data Connections tile: impersonates `subject`
 * (a Workspace mailbox — we use the viewing super admin) and does a tiny free/busy
 * query. Returns { ok:true } when Google accepts it, or { ok:false, error } with
 * the real reason. This is the difference between "the key parses" and "Google
 * actually honors it" — it exposes a missing domain-wide-delegation grant, which a
 * credential-only check can't see.
 */
export async function calendarLiveProbe(subject: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const cal = clientFor(subject);
    const now = new Date();
    await cal.freebusy.query({
      requestBody: {
        timeMin: now.toISOString(),
        timeMax: new Date(now.getTime() + 3_600_000).toISOString(),
        items: [{ id: subject }],
      },
    });
    return { ok: true };
  } catch (e) {
    return { ok: false, error: describeCalendarError(e) };
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
