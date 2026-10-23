import { redirect } from "next/navigation";
import { requireUser, isSuperAdmin } from "@/lib/auth";
import ManageInventory from "./ManageInventory";

export const dynamic = "force-dynamic";

export default async function ManageInventoryPage() {
  // Stock Import creates catalog products + posts adjustments — super-admin-only.
  const user = await requireUser();
  if (!isSuperAdmin(user)) redirect("/dashboard");
  return <ManageInventory />;
}
