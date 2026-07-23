import { PrismaClient } from "@prisma/client";

// Deterministic fixture for the Attendance / Call-Outs smoke. Picks four
// employees (three Vero + one Stuart), clears any prior call-outs + call-out
// notification threads for them, ensures an accident report exists to link, and
// prints KEY=value lines the runner exports into the Playwright env.
const p = new PrismaClient();

async function pick(branch: string, skip: string[]) {
  const e = await p.employee.findFirst({
    where: { status: "active", branch, id: { notIn: skip } },
    orderBy: { name: "asc" },
    select: { id: true, name: true },
  });
  if (!e) throw new Error(`No active employee found in branch ${branch}`);
  return e;
}

(async () => {
  const used: string[] = [];
  const illness = await pick("vero", used); used.push(illness.id);
  const notify = await pick("vero", used); used.push(notify.id);
  const adminEmp = await pick("vero", used); used.push(adminEmp.id);
  const stuart = await pick("stuart", used); used.push(stuart.id);

  const ids = [illness.id, notify.id, adminEmp.id, stuart.id];

  // Clean slate: remove prior call-outs + any call-out notification threads.
  const delA = await p.absence.deleteMany({ where: { employeeId: { in: ids } } });
  const threads = await p.thread.findMany({
    where: { contextType: "employee", contextId: { in: ids }, subject: { startsWith: "Call-out logged:" } },
    select: { id: true },
  });
  if (threads.length) await p.thread.deleteMany({ where: { id: { in: threads.map((t) => t.id) } } });

  // Ensure an accident report exists on the illness employee to link an injury to.
  let accident = await p.personnelRecord.findFirst({ where: { employeeId: illness.id, type: "accident" }, select: { id: true } });
  if (!accident) {
    accident = await p.personnelRecord.create({
      data: {
        employeeId: illness.id,
        type: "accident",
        category: "moderate",
        title: "Warehouse ladder fall",
        body: "Slipped descending the stockroom ladder.",
        incidentDate: new Date(Date.UTC(2026, 6, 20)),
        branch: "vero",
        authorName: "Ray Whitfield",
      },
      select: { id: true },
    });
  }

  const out = [
    `ILLNESS_EMP_ID=${illness.id}`,
    `ILLNESS_EMP_NAME=${illness.name}`,
    `NOTIFY_EMP_ID=${notify.id}`,
    `NOTIFY_EMP_NAME=${notify.name}`,
    `ADMIN_EMP_ID=${adminEmp.id}`,
    `ADMIN_EMP_NAME=${adminEmp.name}`,
    `STUART_EMP_ID=${stuart.id}`,
    `STUART_EMP_NAME=${stuart.name}`,
    `ACCIDENT_ID=${accident.id}`,
  ];
  console.error(`setup-absence: cleared ${delA.count} absences + ${threads.length} threads; accident=${accident.id}`);
  console.log(out.join("\n"));
  await p.$disconnect();
})().catch((e) => { console.error(e); process.exit(1); });
