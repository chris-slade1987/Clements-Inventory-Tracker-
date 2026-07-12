import { PageHeader, EmptyState } from "@/components/ui";
import { requireAdmin } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { branchLabel } from "@/lib/management";
import { maintReaderMode } from "@/lib/fleet-invoice";
import LogServiceClient from "./LogServiceClient";

export const dynamic = "force-dynamic";

export default async function LogServicePage() {
  await requireAdmin();
  const vehicles = await prisma.vehicle.findMany({
    where: { status: "active" },
    orderBy: [{ branch: "asc" }, { unitNumber: "asc" }],
    select: { id: true, unitNumber: true, name: true, branch: true },
  });

  return (
    <>
      <PageHeader title="Log Service" subtitle="Record maintenance — type it in, or upload an invoice / shop statement" />
      {vehicles.length === 0 ? (
        <EmptyState title="No vehicles yet" hint="Add or import vehicles first." />
      ) : (
        <LogServiceClient
          mode={maintReaderMode()}
          vehicles={vehicles.map((v) => ({
            id: v.id,
            label: `${v.unitNumber ? `#${v.unitNumber} · ` : ""}${v.name}${v.branch ? ` (${branchLabel(v.branch)})` : ""}`,
          }))}
        />
      )}
    </>
  );
}
