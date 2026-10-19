import { NextResponse } from "next/server";
import { fail } from "@/lib/http";
import { getSessionUser } from "@/lib/auth";
import { addEmployeeNote, listEmployeeNotes } from "@/lib/employee-notes";

export const runtime = "nodejs";
export const maxDuration = 20;

// Org Chart (Round 1) — the attributed, append-only EMPLOYEE NOTE log.
//   GET  /api/org/notes?employeeId=... → { notes }   (newest first; any signed-in user)
//   POST /api/org/notes { employeeId, body } → { ok, note }
//
// Add access (managers / HR / leadership / super-admins) is enforced in
// `addEmployeeNote`. Notes are never edited or deleted here (append-only).
export async function GET(req: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  try {
    const employeeId = new URL(req.url).searchParams.get("employeeId") ?? "";
    if (!employeeId) return NextResponse.json({ error: "Missing employee." }, { status: 400 });
    return NextResponse.json({ notes: await listEmployeeNotes(employeeId) });
  } catch (e) {
    return fail(e);
  }
}

export async function POST(req: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  try {
    const body = await req.json().catch(() => null);
    const employeeId = typeof body?.employeeId === "string" ? body.employeeId : "";
    if (!employeeId) return NextResponse.json({ error: "Missing employee." }, { status: 400 });
    const note = await addEmployeeNote(user, employeeId, String(body?.body ?? ""));
    return NextResponse.json({ ok: true, note });
  } catch (e) {
    return fail(e);
  }
}
