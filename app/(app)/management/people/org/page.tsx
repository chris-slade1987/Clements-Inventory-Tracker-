import Link from "next/link";
import { PageHeader } from "@/components/ui";
import { requireUser, canEditAccessLevels } from "@/lib/auth";
import { redirect } from "next/navigation";
import { listOrgEmployees } from "@/lib/org";
import OrgChartClient from "./OrgChartClient";

export const dynamic = "force-dynamic";
export const metadata = { title: "Org chart — CanopyOS" };

export default async function OrgChartPage() {
  const user = await requireUser();
  // Managing the whole chart is an admin function (team-scoped editing arrives
  // with the access-level phase).
  if (user.role !== "admin") redirect("/management/people");

  const employees = await listOrgEmployees();

  return (
    <>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <PageHeader title="Org chart" subtitle="Reporting structure — who reports to whom. A lead's team is everyone beneath them." />
        <Link href="/management/people" className="text-sm font-medium text-brand-700 hover:underline">← People / HR</Link>
      </div>
      <OrgChartClient employees={employees} canEditLevels={canEditAccessLevels(user)} />
    </>
  );
}
