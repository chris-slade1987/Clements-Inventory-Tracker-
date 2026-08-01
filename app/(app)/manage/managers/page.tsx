import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/auth";
import { isDemoMode, isDemoModeEnv } from "@/lib/demo";
import DemoModeToggle from "@/components/DemoModeToggle";
import ManageManagers from "./ManageManagers";

export const dynamic = "force-dynamic";

export default async function ManageManagersPage() {
  const me = await requireAdmin();
  const [users, warehouses, demoOn] = await Promise.all([
    prisma.user.findMany({
      orderBy: { name: "asc" },
      include: { warehouse: { select: { name: true } } },
    }),
    prisma.warehouse.findMany({ where: { active: true }, orderBy: { name: "asc" } }),
    isDemoMode().catch(() => false),
  ]);
  return (
    <>
      {/* Env-forced demo mode can't be toggled here; only the Setting-based one. */}
      {isDemoModeEnv() ? null : <DemoModeToggle initialOn={demoOn} />}
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
    </>
  );
}
