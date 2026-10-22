import Link from "next/link";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/ui";
import { requireUser, canEditAccessLevels } from "@/lib/auth";
import { listOrgEmployees } from "@/lib/org";
import { buildOrgTree, canEditOrgCards } from "@/lib/org-chart";
import { SERVICE_TAGS } from "@/lib/service-catalog";
import { BRANCHES } from "@/lib/management";
import OrgConsole from "./OrgConsole";

export const dynamic = "force-dynamic";
export const metadata = { title: "Org chart — CanopyOS" };

export default async function OrgChartPage() {
  const user = await requireUser();
  // The HR console is for HR / senior leadership / admins (the `org` catalog
  // item). Everyone else uses the universal company Org Chart at /org.
  if (!(user.role === "admin" || user.hrAccess || user.seniorLeadership)) {
    redirect("/org");
  }

  const [{ roots, tiles }, employees] = await Promise.all([buildOrgTree(), listOrgEmployees()]);

  // Every non-technician staff member may edit cards.
  const canEditAll = canEditOrgCards(user);

  return (
    <>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <PageHeader
          title="Org chart"
          subtitle="Reporting structure, approved services, scheduling rules, and notes. A lead's team is everyone beneath them."
        />
        <Link href="/management/people" className="text-sm font-medium text-brand-700 hover:underline">← People / HR</Link>
      </div>
      <OrgConsole
        chart={{
          roots,
          tiles,
          serviceTags: SERVICE_TAGS.map((t) => ({ key: t.key, label: t.label })),
          branches: BRANCHES.map((b) => ({ key: b.key, label: b.label })),
          canEditAll,
          profileBase: "/management/people",
        }}
        employees={employees}
        canEditLevels={canEditAccessLevels(user)}
      />
    </>
  );
}
