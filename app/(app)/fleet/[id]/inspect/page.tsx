import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { PageHeader } from "@/components/ui";
import { requireUser, branchLocked } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { branchLabel } from "@/lib/management";
import { parseJson } from "@/lib/inspection";
import { listEmployees, matchEmployeeByName } from "@/lib/people";
import InspectionForm from "./InspectionForm";

export const dynamic = "force-dynamic";

const iso = (d: Date | null | undefined) => (d ? d.toISOString().slice(0, 10) : "");

export default async function InspectPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const user = await requireUser();
  const { id } = await params;
  const sp = await searchParams;

  const vehicle = await prisma.vehicle.findUnique({ where: { id } });
  if (!vehicle) notFound();
  // A branch manager can only inspect vehicles at their own branch.
  if (branchLocked(user) && vehicle.branch !== user.branch) redirect("/my-branch/inspections");

  const now = new Date();
  const year = Number(sp.year) || now.getFullYear();
  const month = Number(sp.month) || now.getMonth() + 1;

  // Existing inspection for this month (edit mode).
  const existing = await prisma.vehicleInspection.findUnique({
    where: { vehicleId_year_month: { vehicleId: id, year, month } },
  });

  // Prefill the maintenance-log review from recorded services.
  const lastOil = await prisma.vehicleService.findFirst({
    where: { vehicleId: id, type: "oil_change" },
    orderBy: { date: "desc" },
  });
  const lastTires = await prisma.vehicleService.findFirst({
    where: { vehicleId: id, type: "tires" },
    orderBy: { date: "desc" },
  });

  // Personnel for this branch, and the best match for the assigned driver.
  const employees = await listEmployees(vehicle.branch ?? undefined);
  const empLite = employees.map((e) => ({ id: e.id, name: e.name, role: e.role, division: e.division, branch: e.branch }));
  const matchedEmployeeId = existing?.employeeId ?? matchEmployeeByName(vehicle.assignedTo, empLite);

  const prefill = {
    date: existing ? iso(existing.date) : iso(now),
    employeeId: matchedEmployeeId ?? "",
    technicianName: existing?.technicianName ?? vehicle.assignedTo ?? "",
    inspectorName: existing?.inspectorName ?? user.name ?? user.email,
    mileage: existing?.mileage != null ? String(existing.mileage) : vehicle.currentMileage != null ? String(vehicle.currentMileage) : "",
    oilChangeLast: iso(existing?.oilChangeLast ?? lastOil?.date),
    oilChangeNext: iso(existing?.oilChangeNext ?? lastOil?.nextDueDate),
    tireRotationLast: iso(existing?.tireRotationLast ?? lastTires?.date),
    tireRotationNext: iso(existing?.tireRotationNext ?? lastTires?.nextDueDate),
    otherMaintLast: iso(existing?.otherMaintLast),
    otherMaintNext: iso(existing?.otherMaintNext),
    notes: existing?.notes ?? "",
    ratings: parseJson<Record<string, number>>(existing?.ratings, {}),
    ratingIssues: parseJson<Record<string, string>>(existing?.ratingIssues, {}),
    checks: parseJson<Record<string, boolean>>(existing?.checks, {}),
  };

  const vlabel = `${vehicle.unitNumber ? `#${vehicle.unitNumber} · ` : ""}${vehicle.name}`;

  return (
    <>
      <div className="mb-2">
        <Link href={`/fleet/${id}`} className="text-xs font-medium text-brand-300 hover:underline">← {vlabel}</Link>
      </div>
      <PageHeader
        title="Monthly Vehicle Inspection"
        subtitle={[vlabel, vehicle.branch ? branchLabel(vehicle.branch) : null].filter(Boolean).join(" · ")}
      />
      <InspectionForm
        vehicleId={id}
        vehicleLabel={vlabel}
        year={year}
        month={month}
        isEdit={!!existing}
        prefill={prefill}
        employees={empLite.map((e) => ({ id: e.id, name: e.name }))}
      />
    </>
  );
}
