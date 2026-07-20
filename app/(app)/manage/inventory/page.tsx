import { requireAdmin } from "@/lib/auth";
import ManageInventory from "./ManageInventory";

export const dynamic = "force-dynamic";

export default async function ManageInventoryPage() {
  await requireAdmin();
  return <ManageInventory />;
}
