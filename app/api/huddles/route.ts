import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { fail } from "@/lib/http";
import {
  createMeeting, updateMeeting, completeMeeting, cancelMeeting,
  addAttendees, removeAttendee, applyAgendaTemplate, addAgendaItem, updateAgendaItem,
  addNote, createFollowUp, getMeeting, listMyHuddles, huddlesForUser,
} from "@/lib/huddles";

export const runtime = "nodejs";
export const maxDuration = 20;

// Huddles surface. Reads (GET): my Huddles, one Huddle in full, or a person's
// Huddle history (notes + their follow-ups) for the profile. Writes (POST, action
// switch): create / update / complete / cancel; attendees; agenda (apply template,
// add, update/check-off); live notes; real-time follow-ups. Access scoping +
// participation checks in lib/huddles. Calendar is out of scope (Round 1-B).
export async function GET(req: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  try {
    const url = new URL(req.url);
    const id = url.searchParams.get("id");
    const forUser = url.searchParams.get("forUser");
    if (id) {
      const meeting = await getMeeting(user, id);
      if (!meeting) return NextResponse.json({ error: "Not found." }, { status: 404 });
      return NextResponse.json({ meeting });
    }
    if (forUser !== null && forUser !== undefined) {
      const meetings = await huddlesForUser(user, forUser || undefined);
      return NextResponse.json({ meetings });
    }
    const meetings = await listMyHuddles(user);
    return NextResponse.json({ meetings });
  } catch (e) {
    return fail(e);
  }
}

export async function POST(req: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const body = await req.json().catch(() => null);
  if (!body) return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  const action: string = typeof body.action === "string" ? body.action : "create";

  try {
    switch (action) {
      case "create": {
        const meeting = await createMeeting(user, body);
        return NextResponse.json({ ok: true, meeting });
      }
      case "update": {
        if (!body.id) return NextResponse.json({ error: "Missing id." }, { status: 400 });
        const meeting = await updateMeeting(user, String(body.id), body);
        return NextResponse.json({ ok: true, meeting });
      }
      case "complete": {
        if (!body.id) return NextResponse.json({ error: "Missing id." }, { status: 400 });
        const meeting = await completeMeeting(user, String(body.id));
        return NextResponse.json({ ok: true, meeting });
      }
      case "cancel": {
        if (!body.id) return NextResponse.json({ error: "Missing id." }, { status: 400 });
        const meeting = await cancelMeeting(user, String(body.id));
        return NextResponse.json({ ok: true, meeting });
      }
      case "add_attendees": {
        if (!body.id || !Array.isArray(body.attendees)) return NextResponse.json({ error: "Missing attendees." }, { status: 400 });
        await addAttendees(user, String(body.id), body.attendees);
        const meeting = await getMeeting(user, String(body.id));
        return NextResponse.json({ ok: true, meeting });
      }
      case "remove_attendee": {
        if (!body.id || !body.attendeeId) return NextResponse.json({ error: "Missing attendee." }, { status: 400 });
        await removeAttendee(user, String(body.id), String(body.attendeeId));
        return NextResponse.json({ ok: true });
      }
      case "apply_template": {
        if (!body.id || !body.templateKey) return NextResponse.json({ error: "Missing template." }, { status: 400 });
        const agendaItems = await applyAgendaTemplate(String(body.id), String(body.templateKey));
        return NextResponse.json({ ok: true, agendaItems });
      }
      case "add_agenda_item": {
        if (!body.id) return NextResponse.json({ error: "Missing id." }, { status: 400 });
        const item = await addAgendaItem(user, String(body.id), String(body.title ?? ""), body.prompt ?? null);
        return NextResponse.json({ ok: true, item });
      }
      case "update_agenda_item": {
        if (!body.agendaItemId) return NextResponse.json({ error: "Missing agenda item." }, { status: 400 });
        const item = await updateAgendaItem(user, String(body.agendaItemId), body);
        return NextResponse.json({ ok: true, item });
      }
      case "add_note": {
        if (!body.id) return NextResponse.json({ error: "Missing id." }, { status: 400 });
        const note = await addNote(user, String(body.id), String(body.body ?? ""));
        if (!note) return NextResponse.json({ error: "Write a note first." }, { status: 400 });
        return NextResponse.json({ ok: true, note });
      }
      case "follow_up": {
        if (!body.id) return NextResponse.json({ error: "Missing id." }, { status: 400 });
        const item = await createFollowUp(user, String(body.id), body);
        return NextResponse.json({ ok: true, item });
      }
      default:
        return NextResponse.json({ error: "Unknown action." }, { status: 400 });
    }
  } catch (e) {
    return fail(e);
  }
}
