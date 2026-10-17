import { NextResponse } from "next/server";
import { fail } from "@/lib/http";
import { getSessionUser } from "@/lib/auth";
import { BRANCHES } from "@/lib/management";
import { addScorecardComment, canAccessScorecardCoaching } from "@/lib/scorecard-coaching";

export const runtime = "nodejs";
export const maxDuration = 20;

// Inline scorecard COACHING thread (CanopyOS Theme 6). Append one coaching note to
// a manager's quarterly scorecard log; a new note fires an Inbox notification (with
// email amplifier) to the scored manager + admin coaches, minus the author.
//
// Gated: an admin reviewer/coach, or the branch's own manager (own scorecard).
// Lives behind the existing scorecard pages, so — like /api/sales/focus and
// /api/threads — it needs no Access Rights catalog entry (the catalog gates
// pages/modules, not API routes).
export async function POST(req: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const body = await req.json().catch(() => null);
  if (!body) return NextResponse.json({ error: "Invalid request." }, { status: 400 });

  const year = Number(body.year);
  const quarter = Number(body.quarter);
  const branch = String(body.branch ?? "");
  if (!year || ![1, 2, 3, 4].includes(quarter) || !BRANCHES.some((b) => b.key === branch))
    return NextResponse.json({ error: "Missing or invalid scorecard period." }, { status: 400 });

  if (!canAccessScorecardCoaching(user, branch))
    return NextResponse.json({ error: "You can only coach on your own branch's scorecard." }, { status: 403 });

  try {
    const comment = await addScorecardComment({
      year, quarter, branch,
      body: String(body.body ?? ""),
      author: { id: user.id, name: user.name },
    });
    if (!comment) return NextResponse.json({ error: "Write a note first." }, { status: 400 });
    return NextResponse.json({ ok: true, id: comment.id });
  } catch (e) {
    return fail(e);
  }
}
