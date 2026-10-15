import { redirect } from "next/navigation";
import { getSessionUser, homePath } from "@/lib/auth";

// Sign-in root: send each role to their own home (managers → My Branch, HR → HR
// Command Center, Sales Director → Sales Team, Field Ops → Field Ops, admins →
// Dashboard), not a one-size-fits-all Inventory dashboard.
export default async function Home() {
  const user = await getSessionUser();
  redirect(user ? homePath(user) : "/login");
}
