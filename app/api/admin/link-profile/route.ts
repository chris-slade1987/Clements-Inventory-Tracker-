import { NextResponse } from "next/server";
import { getSessionUser, isSuperAdmin } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { ensureLeadershipLinked } from "@/prisma/link-leadership";

export const runtime = "nodejs";
export const maxDuration = 20;

// On-demand, super-admin-only repair: link the CALLER's login to their personnel
// Employee profile, live against the production DB — so a missing link (e.g.
// c.slade@ showing "no employee profile linked" on /me/pto) can be fixed by just
// opening this URL, without waiting for a redeploy. It first runs the standard
// leadership-link pass, then, if the caller is still unlinked, directly matches
// their Employee by work email (then name) and links it. Idempotent + safe: it
// never steals an Employee already linked to a different login, never clobbers an
// existing link, and never deletes anything. Returns a JSON diagnostic either way.
const norm = (s: string | null | undefined) =>
  (s ?? "").toLowerCase().replace(/[^a-z\s]/g, "").replace(/\s+/g, " ").trim();

export async function GET() {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  if (!isSuperAdmin(user)) return NextResponse.json({ error: "Super admins only." }, { status: 403 });

  const me = await prisma.user.findUnique({
    where: { id: user.id },
    select: { id: true, email: true, name: true, employeeId: true },
  });
  if (!me) return NextResponse.json({ error: "User not found." }, { status: 404 });

  const out: Record<string, unknown> = { email: me.email, employeeIdBefore: me.employeeId };

  // 1) Standard leadership-link pass (also links Julie/April/Tim if needed).
  try {
    out.leadershipPass = await ensureLeadershipLinked(prisma);
  } catch (e) {
    out.leadershipPass = { error: (e as Error).message };
  }

  // 2) Re-read; if the caller is now linked, we're done.
  let after = await prisma.user.findUnique({ where: { id: me.id }, select: { employeeId: true } });
  if (after?.employeeId) {
    out.employeeIdAfter = after.employeeId;
    out.linked = true;
    out.via = "leadership-pass";
    return NextResponse.json(out);
  }

  // 3) Fallback — directly match THIS caller's Employee by email, then name.
  const [emps, linkedUsers] = await Promise.all([
    prisma.employee.findMany({ select: { id: true, name: true, email: true, branch: true, status: true } }),
    prisma.user.findMany({ where: { employeeId: { not: null } }, select: { id: true, employeeId: true } }),
  ]);
  const usedBy = new Map(linkedUsers.map((u) => [u.employeeId as string, u.id]));
  const emailL = (me.email || "").toLowerCase();
  const nameN = norm(me.name);

  const scored = emps
    .map((e) => {
      const linkedElsewhere = usedBy.has(e.id) && usedBy.get(e.id) !== me.id;
      const emailHit = !!e.email && e.email.toLowerCase() === emailL;
      const en = norm(e.name);
      const nameHit = !!en && (en === nameN || en.includes(nameN) || nameN.includes(en));
      let score = -1;
      if (!linkedElsewhere) score = emailHit ? 100 : nameHit ? 50 : -1;
      return { e, emailHit, nameHit, linkedElsewhere, active: e.status === "active", score };
    })
    .filter((x) => x.score >= 0)
    .sort((a, b) => b.score - a.score || Number(b.active) - Number(a.active));

  out.candidates = scored.slice(0, 6).map((x) => ({ id: x.e.id, name: x.e.name, email: x.e.email, branch: x.e.branch, emailHit: x.emailHit, nameHit: x.nameHit }));

  if (scored[0]) {
    await prisma.user.update({ where: { id: me.id }, data: { employeeId: scored[0].e.id } });
    out.employeeIdAfter = scored[0].e.id;
    out.linked = true;
    out.via = scored[0].emailHit ? "email-match" : "name-match";
    out.linkedTo = { id: scored[0].e.id, name: scored[0].e.name };
  } else {
    out.employeeIdAfter = null;
    out.linked = false;
    out.note = "No unclaimed Employee matched this login by email or name. A profile may need to be created, or an existing one is linked to another login.";
  }
  return NextResponse.json(out);
}
