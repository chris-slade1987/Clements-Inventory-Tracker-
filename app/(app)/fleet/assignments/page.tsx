import Link from "next/link";
import { redirect } from "next/navigation";
import { Card, PageHeader } from "@/components/ui";
import { requireUser, branchLocked } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { BRANCHES, branchLabel } from "@/lib/management";
import { listEmployees } from "@/lib/people";
import { vehicleTitle } from "@/lib/gps-ui";
import DriverSelect from "./DriverSelect";

export const dynamic = "force-dynamic";

// Bulk driver-assignment grid: every active truck with its fleet identity
// (unit, year/make/model, VIN, plate, GPS link) and an inline driver picker, so
// the whole fleet can be linked to drivers in one screen. Admin/manager only;
// branch managers see their own branch.
export default async function DriverAssignmentsPage() {
  const user = await requireUser();
  if (user.role !== "admin" && user.role !== "manager") redirect("/fleet");
  const branch = branchLocked(user) ? user.branch ?? undefined : undefined;

  const [vehicles, employees] = await Promise.all([
    prisma.vehicle.findMany({
      where: { status: "active", ...(branch ? { branch } : {}) },
      select: {
        id: true, unitNumber: true, name: true, year: true, make: true, model: true,
        vin: true, plate: true, branch: true, assignedEmployeeId: true, assignedTo: true, verizonNumber: true,
      },
      orderBy: [{ branch: "asc" }, { year: "asc" }],
    }),
    listEmployees(),
  ]);

  const drivers = employees.map((e) => ({
    id: e.id,
    name: e.name,
    meta: [e.role, e.branch ? branchLabel(e.branch) : null].filter(Boolean).join(" · "),
  }));

  const assigned = vehicles.filter((v) => v.assignedEmployeeId).length;
  const unassigned = vehicles.length - assigned;

  // Group by branch (Vero → Stuart → Orlando → Naples, then Unassigned branch).
  const groups: { key: string; label: string; items: typeof vehicles }[] = BRANCHES
    .map((b) => ({ key: b.key as string, label: b.label as string, items: vehicles.filter((v) => v.branch === b.key) }))
    .filter((g) => g.items.length > 0);
  const noBranch = vehicles.filter((v) => !BRANCHES.some((b) => b.key === v.branch));
  if (noBranch.length) groups.push({ key: "none", label: "Unassigned branch", items: noBranch });

  return (
    <>
      <div className="mb-2">
        <Link href="/fleet" className="text-xs font-medium text-brand-700 hover:underline">← Fleet</Link>
      </div>
      <PageHeader
        title="Driver assignments"
        subtitle="Link each truck to its technician — pick a driver to assign or swap, choose Unassigned to remove"
        actions={<Link href="/fleet/map" className="text-xs font-medium text-brand-700 hover:underline">Live map →</Link>}
      />

      <div className="grid gap-3 grid-cols-3 mb-5">
        <Card className="p-4"><div className="text-xs uppercase tracking-wider text-muted">Trucks</div><div className="mt-1 text-2xl font-light tabular-nums">{vehicles.length}</div></Card>
        <Card className="p-4"><div className="text-xs uppercase tracking-wider text-muted">Assigned</div><div className="mt-1 text-2xl font-light tabular-nums text-emerald-700">{assigned}</div></Card>
        <Card className="p-4"><div className="text-xs uppercase tracking-wider text-muted">Unassigned</div><div className={`mt-1 text-2xl font-light tabular-nums ${unassigned ? "text-amber-700" : ""}`}>{unassigned}</div></Card>
      </div>

      <div className="space-y-6">
        {groups.map((g) => (
          <Card key={g.key} className="p-0 overflow-hidden">
            <div className="px-4 py-3 border-b border-line text-sm font-medium text-ink flex items-center gap-2">
              <span className="inline-block h-4 w-1 rounded bg-emerald-grad" />
              {g.label} <span className="text-muted font-light">· {g.items.length}</span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-muted border-b border-line">
                    <th className="px-4 py-2 font-medium">Unit</th>
                    <th className="px-3 py-2 font-medium">Year / Make / Model</th>
                    <th className="px-3 py-2 font-medium">VIN</th>
                    <th className="px-3 py-2 font-medium">Plate</th>
                    <th className="px-3 py-2 font-medium">GPS</th>
                    <th className="px-4 py-2 font-medium w-72">Driver</th>
                  </tr>
                </thead>
                <tbody>
                  {g.items.map((v) => (
                    <tr key={v.id} className="border-b border-line last:border-0 align-middle">
                      <td className="px-4 py-2 font-medium whitespace-nowrap">
                        <Link href={`/fleet/${v.id}`} className="text-brand-700 hover:underline">{v.unitNumber ? `#${v.unitNumber}` : "—"}</Link>
                      </td>
                      <td className="px-3 py-2">{vehicleTitle(v)}</td>
                      <td className="px-3 py-2 text-muted tabular-nums text-xs">{v.vin ?? "—"}</td>
                      <td className="px-3 py-2 text-muted tabular-nums">{v.plate ?? "—"}</td>
                      <td className="px-3 py-2">
                        {v.verizonNumber ? (
                          <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-medium text-emerald-700">Linked</span>
                        ) : (
                          <span className="text-[11px] text-muted">—</span>
                        )}
                      </td>
                      <td className="px-4 py-2">
                        <DriverSelect vehicleId={v.id} currentEmployeeId={v.assignedEmployeeId} drivers={drivers} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        ))}
      </div>

      <p className="mt-4 text-xs text-muted">
        Drivers come from the active employee roster. New hires appear here automatically; a driver removed from the
        roster stays visible on their truck until reassigned. Assignments show on the Live Map and each vehicle page.
      </p>
    </>
  );
}
