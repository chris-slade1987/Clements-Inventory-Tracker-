import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/auth";
import ManageManagers from "./ManageManagers";

export const dynamic = "force-dynamic";

export default async function ManageManagersPage() {
  const me = await requireAdmin();
  const [users, warehouses] = await Promise.all([
    prisma.user.findMany({
      orderBy: { name: "asc" },
      include: { warehouse: { select: { name: true } } },
    }),
    prisma.warehouse.findMany({ where: { active: true }, orderBy: { name: "asc" } }),
  ]);
  return (
    <ManageManagers
      currentUserId={me.id}
      warehouses={warehouses.map((w) => ({ id: w.id, name: w.name }))}
      managers={users.map((u) => ({
        id: u.id,
        name: u.name,
        email: u.email,
        role: u.role,
        warehouseName: u.warehouse?.name ?? null,
        active: u.active,
        boardObserver: u.boardObserver,
      }))}
    />
  );
}
