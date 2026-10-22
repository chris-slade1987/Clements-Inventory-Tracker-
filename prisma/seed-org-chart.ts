import type { PrismaClient } from "@prisma/client";

// Bootstrap the org chart's reporting lines ONCE, non-destructively: only fills
// employees whose reportsToId is still null, so any hand-edited line in the
// visual chart is never overwritten. Best-effort starting point:
//   • active non-managers at a branch → that branch's manager (if exactly one),
//   • each branch manager → the owner/CEO employee (top of the tree).
// Ambiguous branches (0 or >1 managers) are left blank for manual assignment.
export async function seedOrgChart(prisma: PrismaClient) {
  const branches = ["vero", "stuart", "orlando", "naples"];
  const owner = await prisma.user.findFirst({ where: { email: "c.slade@clementspestcontrol.com" }, select: { employeeId: true } });
  const ownerEmpId = owner?.employeeId ?? null;

  let linked = 0;
  for (const b of branches) {
    const mgrs = await prisma.employee.findMany({
      where: { status: "active", branch: b, role: { contains: "Manager" } },
      select: { id: true },
    });
    if (mgrs.length !== 1) continue; // ambiguous — leave for manual assignment
    const mgrId = mgrs[0].id;

    const res = await prisma.employee.updateMany({
      where: { status: "active", branch: b, reportsToId: null, id: { not: mgrId }, NOT: { role: { contains: "Manager" } } },
      data: { reportsToId: mgrId },
    });
    linked += res.count;

    if (ownerEmpId && ownerEmpId !== mgrId) {
      const r2 = await prisma.employee.updateMany({ where: { id: mgrId, reportsToId: null }, data: { reportsToId: ownerEmpId } });
      linked += r2.count;
    }
  }
  return { linked };
}

// Self-healing catch-all: after the authoritative roster + branch bootstrap have
// run, attach ANY remaining active employee who still has a blank reportsToId so
// nobody floats as a stray root on the org chart. Fill-if-null ONLY (never
// clobbers a roster line or a hand edit), idempotent, non-destructive:
//   1) a person with a branch   → that branch's manager,
//   2) a branch manager         → the Field-Operations director (Graham) or top,
//   3) anyone still unattached   → the single company top (President/owner),
// guaranteeing one connected tree with exactly one root. This closes the gap
// where someone added after the one-time bootstrap (e.g. a late advisor/tech)
// had no reporting line and rendered as an orphan tile.
// Pin the company ROOTS to the top: the CEO (Chris / c.slade@) and the President
// (Tim Slade) report to no one. Idempotent — only clears a non-null line — so it
// lifts Chris to the top alongside Tim and keeps them both there on every deploy.
export async function seedLeadershipRoots(prisma: PrismaClient) {
  // Collect EVERY record for Chris + Tim (they can each exist under more than one
  // name, e.g. "Chris Slade" and "Christopher Slade"), by login email and by name,
  // so whichever record the chart shows is pinned to the top.
  const emails = ["c.slade@clementspestcontrol.com", "tslade@clementspestcontrol.com"];
  const names = ["Chris Slade", "Christopher Slade", "Tim Slade", "Timothy Slade"];
  const ids = new Set<string>();
  const logins = await prisma.user.findMany({ where: { email: { in: emails } }, select: { employeeId: true } });
  for (const l of logins) if (l.employeeId) ids.add(l.employeeId);
  const emps = await prisma.employee.findMany({
    where: { OR: [{ email: { in: emails } }, { name: { in: names } }] },
    select: { id: true },
  });
  for (const e of emps) ids.add(e.id);
  const rootIds = [...ids];
  if (rootIds.length === 0) return { roots: 0, cleared: 0 };
  const res = await prisma.employee.updateMany({
    where: { id: { in: rootIds }, NOT: { reportsToId: null } },
    data: { reportsToId: null },
  });
  return { roots: rootIds.length, cleared: res.count };
}

export async function attachRemainingReports(prisma: PrismaClient) {
  const branches = ["vero", "stuart", "orlando", "naples"];

  // Repair DANGLING lines first: if someone reports to a person who is no longer
  // active (terminated) or was deleted, clear that link so the fill logic below
  // re-homes them under an active manager — otherwise they render as a stray
  // root ("no supervisor") on the chart even though reportsToId isn't null.
  const activeIds = new Set(
    (await prisma.employee.findMany({ where: { status: "active" }, select: { id: true } })).map((e) => e.id),
  );
  const linked0 = await prisma.employee.findMany({
    where: { status: "active", NOT: { reportsToId: null } },
    select: { id: true, reportsToId: true },
  });
  let repaired = 0;
  for (const e of linked0) {
    if (e.reportsToId && !activeIds.has(e.reportsToId)) {
      await prisma.employee.update({ where: { id: e.id }, data: { reportsToId: null } });
      repaired++;
    }
  }

  // Company ROOTS: the President (Tim Slade) AND the CEO (Chris / c.slade@) both sit
  // at the top with no supervisor — neither is ever re-parented below anyone. The
  // President is the default parent for otherwise-unattached people.
  const tim = await prisma.employee.findFirst({
    where: { status: "active", name: { contains: "Tim Slade" } },
    select: { id: true },
  });
  const owner = await prisma.user.findFirst({
    where: { email: "c.slade@clementspestcontrol.com" },
    select: { employeeId: true },
  });
  const topId = tim?.id ?? owner?.employeeId ?? null;
  // ALL records for the two company roots (Chris + Tim can each have duplicate
  // records under different names) — none of them is ever re-parented below anyone.
  const rootEmails = ["c.slade@clementspestcontrol.com", "tslade@clementspestcontrol.com"];
  const rootNames = ["Chris Slade", "Christopher Slade", "Tim Slade", "Timothy Slade"];
  const rootIdSet = new Set<string>();
  const rootLogins = await prisma.user.findMany({ where: { email: { in: rootEmails } }, select: { employeeId: true } });
  for (const l of rootLogins) if (l.employeeId) rootIdSet.add(l.employeeId);
  const rootEmps = await prisma.employee.findMany({
    where: { OR: [{ email: { in: rootEmails } }, { name: { in: rootNames } }] },
    select: { id: true },
  });
  for (const e of rootEmps) rootIdSet.add(e.id);
  const rootIds = [...rootIdSet];

  // Field-Operations director — the branch managers' parent.
  const graham = await prisma.employee.findFirst({
    where: { status: "active", OR: [{ name: { contains: "Graham Foster" } }, { title: { contains: "Field Operations" } }] },
    select: { id: true },
  });

  // Resolve one branch manager per branch: prefer an explicit "Branch Manager"
  // title/role, else the branch's sole "Manager"-role employee.
  const bmByBranch = new Map<string, string>();
  for (const b of branches) {
    let bm = await prisma.employee.findFirst({
      where: { status: "active", branch: b, OR: [{ title: { contains: "Branch Manager" } }, { role: { contains: "Branch Manager" } }] },
      select: { id: true },
    });
    if (!bm) {
      const mgrs = await prisma.employee.findMany({
        where: { status: "active", branch: b, role: { contains: "Manager" } },
        select: { id: true },
      });
      if (mgrs.length === 1) bm = mgrs[0];
    }
    if (bm) bmByBranch.set(b, bm.id);
  }

  let linked = 0;

  // 1) Branch managers still unlinked → Field-Ops director (or the top).
  for (const mgrId of bmByBranch.values()) {
    const parent = graham?.id && graham.id !== mgrId ? graham.id : topId && topId !== mgrId ? topId : null;
    if (!parent) continue;
    linked += (await prisma.employee.updateMany({ where: { id: mgrId, reportsToId: null }, data: { reportsToId: parent } })).count;
  }

  // 2) Any remaining branch orphan → that branch's manager.
  for (const b of branches) {
    const mgrId = bmByBranch.get(b);
    if (!mgrId) continue;
    linked += (await prisma.employee.updateMany({
      where: { status: "active", branch: b, reportsToId: null, id: { not: mgrId } },
      data: { reportsToId: mgrId },
    })).count;
  }

  // 3) Everyone else still unattached (no branch, or no resolvable manager) →
  //    the President, EXCEPT the company roots themselves (Tim + Chris stay at top).
  if (topId) {
    linked += (await prisma.employee.updateMany({
      where: { status: "active", reportsToId: null, id: { notIn: rootIds.length ? rootIds : [topId] } },
      data: { reportsToId: topId },
    })).count;
  }

  return { linked, repaired };
}
