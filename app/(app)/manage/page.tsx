import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function ManageIndex() {
  // Admins land on the product catalog; HR-only users on the confirm queue.
  const user = await requireUser();
  redirect(user.role === "admin" ? "/manage/products" : "/manage/confirm");
}
