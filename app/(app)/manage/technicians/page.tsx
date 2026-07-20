import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/auth";
import ManageTechnicians from "./ManageTechnicians";

export const dynamic = "force-dynamic";

export default async function ManageTechniciansPage() {
  await requireAdmin();
  const [technicians, warehouses] = await Promise.all([
    prisma.technician.findMany({
      orderBy: { name: "asc" },
      include: { homeWarehouse: { select: { name: true } } },
    }),
    prisma.warehouse.findMany({ where: { active: true }, orderBy: { name: "asc" } }),
  ]);
  return (
    <ManageTechnicians
      warehouses={warehouses.map((w) => ({ id: w.id, name: w.name }))}
      technicians={technicians.map((t) => ({
        id: t.id,
        name: t.name,
        homeWarehouseId: t.homeWarehouseId,
        homeWarehouseName: t.homeWarehouse.name,
        employeeIdCard: t.employeeIdCard,
        role: t.role,
        division: t.division,
        active: t.active,
      }))}
    />
  );
}
