import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { getMeeting } from "@/lib/huddles";
import { buildHuddleIcs } from "@/lib/huddle-ics";

export const runtime = "nodejs";
export const maxDuration = 20;

// Download a Huddle as an .ics calendar file — the "Add to calendar" fallback used
// when live Google Workspace sync isn't configured. Scoped to a participant via
// getMeeting (organizer / attendee / leadership); returns 404 otherwise. Only
// start/end + emails are written (see lib/huddle-ics.ts) — never note bodies.
export async function GET(req: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const id = new URL(req.url).searchParams.get("id") ?? "";
  const meeting = await getMeeting(user, id);
  if (!meeting) return NextResponse.json({ error: "Not found." }, { status: 404 });
  if (!meeting.scheduledStart || !meeting.scheduledEnd) {
    return NextResponse.json({ error: "This Huddle has no scheduled time yet." }, { status: 400 });
  }

  const organizer = meeting.attendees?.find((a) => a.role === "organizer") ?? null;
  const ics = buildHuddleIcs({
    id: meeting.id,
    title: meeting.title,
    description: meeting.kind ? `${meeting.kind} Huddle` : null,
    start: new Date(meeting.scheduledStart),
    end: new Date(meeting.scheduledEnd),
    location: meeting.location,
    meetingLink: meeting.meetingLink,
    organizer: organizer ? { email: organizer.email, name: organizer.name } : null,
    attendees: (meeting.attendees ?? []).map((a) => ({ email: a.email, name: a.name })),
  });
  if (!ics) return NextResponse.json({ error: "Nothing to place on a calendar yet." }, { status: 400 });

  const safe = meeting.title.replace(/[^a-z0-9]+/gi, "-").replace(/^-+|-+$/g, "").toLowerCase() || "huddle";
  return new NextResponse(ics, {
    status: 200,
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": `attachment; filename="${safe}.ics"`,
      "Cache-Control": "no-store",
    },
  });
}
