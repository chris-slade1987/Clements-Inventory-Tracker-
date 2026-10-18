import "server-only";
import {
  getFreeBusy,
  isCalendarConfigured,
  type BusyInterval,
  type FreeBusyByEmail,
} from "@/lib/google-calendar";

/**
 * Meeting-time suggestion service for Huddles.
 *
 * `suggestTimes()` proposes a ranked list of candidate slots that avoid every
 * attendee's busy time (read from Google free/busy), prefer business hours and
 * the soonest common opening, and annotate each slot with who (if anyone) still
 * conflicts. It is DETERMINISTIC and pure aside from the single free/busy read —
 * same inputs + same calendars ⇒ same ordering.
 *
 * FALLBACK: when the Google service account isn't configured (see
 * `lib/google-calendar.ts`), there is no availability to read, so we still
 * return a sensible set of business-hour slots (no conflict data) and set
 * `availabilityKnown: false` so the picker keeps working offline.
 */

export type WorkingHours = {
  /** Local start hour, inclusive (0-23). Default 8. */
  startHour: number;
  /** Local end hour, exclusive (1-24) — a slot must END at or before this. Default 17. */
  endHour: number;
  /** Working weekdays, 0=Sun..6=Sat. Default Mon-Fri. */
  days: number[];
};

export const DEFAULT_WORKING_HOURS: WorkingHours = {
  startHour: 8,
  endHour: 17,
  days: [1, 2, 3, 4, 5],
};

const DEFAULT_TZ = "America/New_York";
const DEFAULT_SLOT_STEP_MINS = 30;
const DEFAULT_MAX_SUGGESTIONS = 8;
// Hard cap on candidate scanning so a huge [earliest, latest] window can't spin.
const MAX_CANDIDATES_SCANNED = 5000;

export type SuggestTimesInput = {
  attendeeEmails: string[];
  durationMins: number;
  earliest: Date;
  latest: Date;
  workingHours?: Partial<WorkingHours>;
  tz?: string;
  /** Grid granularity for candidate starts, in minutes. Default 30. */
  slotStepMins?: number;
  /** Max slots to return. Default 8. */
  maxSuggestions?: number;
  /** Include the raw per-attendee BUSY intervals (free/busy only) in the result. */
  includeBusy?: boolean;
};

export type SuggestedSlot = {
  start: Date;
  end: Date;
  /** True when no attendee is busy (only meaningful when availabilityKnown). */
  available: boolean;
  /** Attendee emails busy during this slot (empty in fallback mode). */
  conflicts: string[];
};

export type SuggestTimesResult = {
  /** True when live free/busy was read; false in fallback (no conflict data). */
  availabilityKnown: boolean;
  slots: SuggestedSlot[];
  /** Echo of the resolved parameters, for the caller/UI. */
  window: { earliest: Date; latest: Date; tz: string; durationMins: number };
  /** Per-attendee BUSY intervals (start/end only — never titles/details), when
   *  `includeBusy` was requested and availability is known. */
  busy?: FreeBusyByEmail;
};

type LocalParts = { hour: number; minute: number; weekday: number };

/** Local wall-clock parts of a UTC instant in the given IANA time zone. */
function localParts(d: Date, tz: string): LocalParts {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hour: "2-digit",
    minute: "2-digit",
    weekday: "short",
    hour12: false,
  });
  const parts = fmt.formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  let hour = parseInt(get("hour"), 10);
  if (hour === 24) hour = 0; // some engines render midnight as 24
  const minute = parseInt(get("minute"), 10);
  const WD: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return { hour, minute, weekday: WD[get("weekday")] ?? 0 };
}

/** Does [start, end) fall on a working day and entirely inside working hours (local)? */
function withinWorkingHours(start: Date, end: Date, wh: WorkingHours, tz: string): boolean {
  const s = localParts(start, tz);
  if (!wh.days.includes(s.weekday)) return false;
  const startMinsOfDay = s.hour * 60 + s.minute;
  if (startMinsOfDay < wh.startHour * 60) return false;
  // End must be on the SAME local day and at/before endHour. Compare local end.
  const e = localParts(end, tz);
  // If the end rolled to a different weekday, it spilled past the day boundary.
  if (e.weekday !== s.weekday) return false;
  const endMinsOfDay = e.hour * 60 + e.minute;
  if (endMinsOfDay > wh.endHour * 60) return false;
  return true;
}

/** Round a Date UP to the next multiple of stepMins (on the UTC minute grid). */
function ceilToStep(d: Date, stepMins: number): Date {
  const ms = stepMins * 60_000;
  return new Date(Math.ceil(d.getTime() / ms) * ms);
}

function overlaps(aStart: Date, aEnd: Date, b: BusyInterval): boolean {
  return aStart < b.end && b.start < aEnd;
}

/** Emails busy during [start, end), given the free/busy map. */
function conflictsFor(start: Date, end: Date, fb: FreeBusyByEmail): string[] {
  const out: string[] = [];
  for (const [email, busy] of Object.entries(fb)) {
    if (busy.some((b) => overlaps(start, end, b))) out.push(email);
  }
  return out;
}

/**
 * Suggest meeting times. Candidate starts are generated on a `slotStepMins` grid
 * inside [earliest, latest], kept to working days/hours, then (when live)
 * annotated + ranked: conflict-free first, fewest conflicts next, soonest last.
 */
export async function suggestTimes(input: SuggestTimesInput): Promise<SuggestTimesResult> {
  const tz = input.tz || DEFAULT_TZ;
  const wh: WorkingHours = {
    ...DEFAULT_WORKING_HOURS,
    ...(input.workingHours || {}),
    days: input.workingHours?.days ?? DEFAULT_WORKING_HOURS.days,
  };
  const duration = Math.max(1, Math.round(input.durationMins));
  const step = Math.max(5, Math.round(input.slotStepMins ?? DEFAULT_SLOT_STEP_MINS));
  const maxSuggestions = Math.max(1, Math.round(input.maxSuggestions ?? DEFAULT_MAX_SUGGESTIONS));
  const durationMs = duration * 60_000;

  const window = { earliest: input.earliest, latest: input.latest, tz, durationMins: duration };

  // 1) Enumerate working-hour candidate slots (deterministic, pure).
  const candidates: { start: Date; end: Date }[] = [];
  let cursor = ceilToStep(input.earliest, step);
  let scanned = 0;
  while (
    cursor.getTime() + durationMs <= input.latest.getTime() &&
    scanned < MAX_CANDIDATES_SCANNED &&
    candidates.length < MAX_CANDIDATES_SCANNED
  ) {
    const end = new Date(cursor.getTime() + durationMs);
    if (withinWorkingHours(cursor, end, wh, tz)) candidates.push({ start: cursor, end });
    cursor = new Date(cursor.getTime() + step * 60_000);
    scanned++;
  }

  // 2) Fallback: no credentials ⇒ no availability. Return soonest business-hour
  //    slots with no conflict data so the picker still works.
  const emails = [...new Set(input.attendeeEmails.map((e) => e.trim().toLowerCase()).filter(Boolean))];
  if (!isCalendarConfigured() || emails.length === 0) {
    return {
      availabilityKnown: false,
      window,
      slots: candidates.slice(0, maxSuggestions).map((c) => ({
        start: c.start,
        end: c.end,
        available: true, // unknown, assumed open in fallback
        conflicts: [],
      })),
    };
  }

  // 3) Live: read free/busy once across the whole window, annotate + rank.
  let fb: FreeBusyByEmail;
  try {
    fb = await getFreeBusy(emails, input.earliest, input.latest);
  } catch {
    // Any failure reading availability degrades to the fallback shape, flagged.
    return {
      availabilityKnown: false,
      window,
      slots: candidates.slice(0, maxSuggestions).map((c) => ({
        start: c.start,
        end: c.end,
        available: true,
        conflicts: [],
      })),
    };
  }

  const annotated: SuggestedSlot[] = candidates.map((c) => {
    const conflicts = conflictsFor(c.start, c.end, fb);
    return { start: c.start, end: c.end, available: conflicts.length === 0, conflicts };
  });

  // Rank: fewest conflicts first, then soonest. Stable + deterministic.
  annotated.sort((a, b) => {
    if (a.conflicts.length !== b.conflicts.length) return a.conflicts.length - b.conflicts.length;
    return a.start.getTime() - b.start.getTime();
  });

  return {
    availabilityKnown: true,
    window,
    slots: annotated.slice(0, maxSuggestions),
    ...(input.includeBusy ? { busy: fb } : {}),
  };
}
