import { prisma } from "@/lib/prisma";

// Org chart / reporting structure. Each employee optionally reports to another
// (reportsToId), forming a tree. A person's "team" is the whole subtree beneath
// them (their direct reports plus everyone under those reports). This powers the
// visual org chart and the team-scoped Admin-Lite access that keys off it.

export type OrgEmployee = {
  id: string;
  name: string;
  role: string | null;
  title: string | null;
  branch: string | null;
  reportsToId: string | null;
  userId: string | null; // linked login (null = no account → no access level)
  accessLevel: string | null; // from the linked login
};

/** Active employees with their reporting line + linked login's access level. */
export async function listOrgEmployees(): Promise<OrgEmployee[]> {
  const rows = await prisma.employee.findMany({
    where: { status: "active" },
    select: {
      id: true, name: true, role: true, title: true, branch: true, reportsToId: true,
      user: { select: { id: true, accessLevel: true } },
    },
    orderBy: [{ name: "asc" }],
  });
  return rows.map((e) => ({
    id: e.id, name: e.name, role: e.role, title: e.title, branch: e.branch, reportsToId: e.reportsToId,
    userId: e.user?.id ?? null, accessLevel: e.user?.accessLevel ?? null,
  }));
}

/** All descendant ids beneath a root (the team, excluding the lead). Pure. */
export function descendantIds(rootId: string, employees: { id: string; reportsToId: string | null }[]): Set<string> {
  const childrenOf = new Map<string, string[]>();
  for (const e of employees) {
    if (!e.reportsToId) continue;
    const arr = childrenOf.get(e.reportsToId);
    if (arr) arr.push(e.id);
    else childrenOf.set(e.reportsToId, [e.id]);
  }
  const out = new Set<string>();
  const stack = [...(childrenOf.get(rootId) ?? [])];
  while (stack.length) {
    const id = stack.pop() as string;
    if (out.has(id)) continue;
    out.add(id);
    for (const c of childrenOf.get(id) ?? []) stack.push(c);
  }
  return out;
}

/** The team a lead can see = self + entire subtree beneath them. */
export async function teamEmployeeIds(leadEmployeeId: string): Promise<Set<string>> {
  const all = await prisma.employee.findMany({ select: { id: true, reportsToId: true } });
  const team = descendantIds(leadEmployeeId, all);
  team.add(leadEmployeeId);
  return team;
}

/**
 * Set (or clear, with null) an employee's reports-to, guarding against reporting
 * to yourself or to anyone already on your team (which would make a cycle).
 */
export async function setReportsTo(employeeId: string, reportsToId: string | null): Promise<{ ok: boolean; error?: string }> {
  if (reportsToId && reportsToId === employeeId)
    return { ok: false, error: "An employee can't report to themselves." };
  if (reportsToId) {
    const all = await prisma.employee.findMany({ select: { id: true, reportsToId: true } });
    if (descendantIds(employeeId, all).has(reportsToId))
      return { ok: false, error: "That would create a loop — you can't report to someone on your own team." };
    const target = await prisma.employee.findUnique({ where: { id: reportsToId }, select: { id: true } });
    if (!target) return { ok: false, error: "That manager no longer exists." };
  }
  await prisma.employee.update({ where: { id: employeeId }, data: { reportsToId } });
  return { ok: true };
}
