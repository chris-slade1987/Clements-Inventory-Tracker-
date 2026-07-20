import { redirect } from "next/navigation";
import { PageHeader } from "@/components/ui";
import { getSessionUser, homePath } from "@/lib/auth";
import { hasInsightsKey } from "@/lib/insights";
import InsightsChat from "./InsightsChat";

export const dynamic = "force-dynamic";
export const metadata = { title: "Insights — Clements Command & Control" };

export default async function InsightsPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  if (!(user.role === "admin" || user.seniorLeadership)) redirect(homePath(user));

  return (
    <>
      <PageHeader title="Insights" subtitle="Ask about the numbers — grounded in your management data" />
      <InsightsChat configured={hasInsightsKey()} />
    </>
  );
}
