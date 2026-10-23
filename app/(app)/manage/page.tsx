import { redirect } from "next/navigation";
import { requireUser, isSuperAdmin } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function ManageIndex() {
  // Super admins land on the product catalog; other admins (team-scoped) land on
  // the Technicians roster — the catalog tabs are super-admin-only.
  const user = await requireUser();
  redirect(isSuperAdmin(user) ? "/manage/products" : "/manage/technicians");
}
