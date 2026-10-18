import { NextResponse } from "next/server";
import { fail, HttpError } from "@/lib/http";
import { getSessionUser } from "@/lib/auth";
import { suggestTimes } from "@/lib/scheduling";

export const runtime = "nodejs";
export const maxDuration = 20;
// Availability is read live per request — never cache.
export const dynamic = "force-dynamic";

/**
 * POST /api/scheduling/suggest
 *
 * Auth-required meeting-time suggestion for Huddles. Takes plain inputs
 * (attendee emails + a time window + duration), returns a ranked list of
 * candidate slots that avoid everyone's busy time.
 *
 * PRIVACY: the only availability data that ever leaves this endpoint is
 * free/busy — busy interval start/end times and the set of conflicting attendee
 * EMAILS. Event titles, descriptions, attendees, and locations are never read
 * (the Google free/busy API doesn't return them) and never returned.
 *
 * `availabilityKnown` tells the UI whether this is live (calendar configured) or
 * fallback (business-hour suggestions with no conflict data).
 *
 * Body: {
 *   attendeeEmails: string[]; durationMins: number;
 *   earliest: ISO string; latest: ISO string;
 *   tz?: string; workingHours?: { startHour?; endHour?; days? };
 *   slotStepMins?: number; maxSuggestions?: number; includeBusy?: boolean;
 * }
 */
export async function POST(req: Request) {
  try {
    const user = await getSessionUser();
    if (!user) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const body = await req.json().catch(() => null);

    const attendeeEmails = Array.isArray(body?.attendeeEmails)
      ? (body.attendeeEmails as unknown[]).map((e) => String(e || "").trim()).filter(Boolean)
      : [];

    const durationMins = Number(body?.durationMins);
    if (!Number.isFinite(durationMins) || durationMins <= 0)
      throw new HttpError("Give the meeting a duration in minutes.");

    const earliest = parseDate(body?.earliest);
    const latest = parseDate(body?.latest);
    if (!earliest) throw new HttpError("Provide a valid 'earliest' time.");
    if (!latest) throw new HttpError("Provide a valid 'latest' time.");
    if (latest.getTime() <= earliest.getTime())
      throw new HttpError("'latest' must be after 'earliest'.");
    if (latest.getTime() - earliest.getTime() > 60 * 864e5)
      throw new HttpError("Keep the search window within 60 days.");

    const workingHours = parseWorkingHours(body?.workingHours);

    const result = await suggestTimes({
      attendeeEmails,
      durationMins,
      earliest,
      latest,
      tz: typeof body?.tz === "string" && body.tz.trim() ? body.tz.trim() : undefined,
      workingHours,
      slotStepMins: Number.isFinite(Number(body?.slotStepMins)) ? Number(body.slotStepMins) : undefined,
      maxSuggestions: Number.isFinite(Number(body?.maxSuggestions))
        ? Number(body.maxSuggestions)
        : undefined,
      includeBusy: body?.includeBusy === true,
    });

    return NextResponse.json({
      availabilityKnown: result.availabilityKnown,
      window: {
        earliest: result.window.earliest.toISOString(),
        latest: result.window.latest.toISOString(),
        tz: result.window.tz,
        durationMins: result.window.durationMins,
      },
      slots: result.slots.map((s) => ({
        start: s.start.toISOString(),
        end: s.end.toISOString(),
        available: s.available,
        conflicts: s.conflicts,
      })),
      ...(result.busy
        ? {
            busy: Object.fromEntries(
              Object.entries(result.busy).map(([email, intervals]) => [
                email,
                intervals.map((b) => ({ start: b.start.toISOString(), end: b.end.toISOString() })),
              ]),
            ),
          }
        : {}),
    });
  } catch (e) {
    return fail(e);
  }
}

function parseDate(v: unknown): Date | null {
  if (typeof v !== "string" && typeof v !== "number") return null;
  const d = new Date(v);
  return isNaN(d.getTime()) ? null : d;
}

function parseWorkingHours(v: unknown):
  | { startHour?: number; endHour?: number; days?: number[] }
  | undefined {
  if (!v || typeof v !== "object") return undefined;
  const o = v as Record<string, unknown>;
  const out: { startHour?: number; endHour?: number; days?: number[] } = {};
  if (Number.isFinite(Number(o.startHour))) out.startHour = Math.max(0, Math.min(23, Number(o.startHour)));
  if (Number.isFinite(Number(o.endHour))) out.endHour = Math.max(1, Math.min(24, Number(o.endHour)));
  if (Array.isArray(o.days)) {
    const days = (o.days as unknown[])
      .map((d) => Number(d))
      .filter((d) => Number.isInteger(d) && d >= 0 && d <= 6);
    if (days.length) out.days = [...new Set(days)];
  }
  return Object.keys(out).length ? out : undefined;
}
