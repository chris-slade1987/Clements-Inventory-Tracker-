import { prisma } from "@/lib/prisma";
import type { SessionUser } from "@/lib/auth";

// Self-heal: link a signed-in user's login to their personnel Employee profile
// when it isn't linked yet, so self-service pages (PTO, profile, the Employee Hub)
// never dead-end on "no employee profile linked". Matches on the STRONGEST signal
// — the work email — and, only when that's absent, a UNIQUE exact name match. It
// never steals an Employee already linked to another login and never guesses when
// a name is ambiguous. Returns the resolved employeeId (existing or newly linked),
// or null when no confident match exists. Safe to call on page load; it writes at
// most once (subsequent calls short-circuit on the now-set employeeId).

const norm = (s: string | null | undefined): string =>
  (s ?? "").toLowerCase().replace(/[^a-z\s]/g, "").replace(/\s+/g, " ").trim();

export async function ensureSelfEmployeeLink(
  user: Pick<SessionUser, "id" | "email" | "name" | "employeeId">,
): Promise<string | null> {
  if (user.employeeId) return user.employeeId;

  const [emps, linked] = await Promise.all([
    prisma.employee.findMany({ select: { id: true, name: true, email: true, status: true } }),
    prisma.user.findMany({ where: { employeeId: { not: null } }, select: { employeeId: true } }),
  ]);
  const used = new Set(linked.map((l) => l.employeeId as string));
  const available = emps.filter((e) => !used.has(e.id));

  const emailL = (user.email || "").toLowerCase();
  const nameN = norm(user.name);

  // 1) Exact work-email match (prefer an active profile).
  let match =
    available.find((e) => e.email && e.email.toLowerCase() === emailL && e.status === "active") ??
    available.find((e) => e.email && e.email.toLowerCase() === emailL);

  // 2) Otherwise a UNIQUE exact name match (don't guess when ambiguous).
  if (!match && nameN) {
    const nameHits = available.filter((e) => norm(e.name) === nameN);
    if (nameHits.length === 1) match = nameHits[0];
  }

  if (!match) return null;
  try {
    await prisma.user.update({ where: { id: user.id }, data: { employeeId: match.id } });
  } catch {
    return null;
  }
  return match.id;
}
