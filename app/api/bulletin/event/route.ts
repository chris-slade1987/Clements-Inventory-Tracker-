import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth";
import { canPostBulletin } from "@/lib/bulletin";

export const runtime = "nodejs";

const s = (v: unknown) => { const t = typeof v === "string" ? v.trim() : ""; return t === "" ? null : t; };
const dateOf = (v: unknown) => { const t = s(v); if (!t) return null; const d = new Date(t.length <= 10 ? `${t}T00:00:00Z` : t); return isNaN(d.getTime()) ? null : d; };
const KINDS = new Set(["holiday", "closure", "early_release", "event"]);

// Company calendar entries (holidays, closures, early releases, events).
// Author-gated create / delete.
export async function POST(req: Request) {
  const user = await getSessionUser();
  if (!user || !canPostBulletin(user)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const body = await req.json().catch(() => null);
  const action = s(body?.action) ?? "create";

  if (action === "delete") {
    const id = s(body?.id);
    if (!id) return NextResponse.json({ error: "Missing event." }, { status: 400 });
    await prisma.calendarEvent.delete({ where: { id } }).catch(() => {});
    return NextResponse.json({ ok: true });
  }

  const title = s(body?.title);
  const date = dateOf(body?.date);
  if (!title || !date) return NextResponse.json({ error: "Title and date are required." }, { status: 400 });
  const kind = KINDS.has(String(body?.kind)) ? String(body?.kind) : "event";
  const event = await prisma.calendarEvent.create({
    data: { title, kind, date, endDate: dateOf(body?.endDate), timeLabel: s(body?.timeLabel), branch: s(body?.branch), notes: s(body?.notes), createdByName: user.name },
  });
  return NextResponse.json({ ok: true, id: event.id });
}
