import { PageHeader } from "@/components/ui";
import { requireUser } from "@/lib/auth";
import { buildOrgTree, canEditOrgCards, companyRootEmployeeIds } from "@/lib/org-chart";
import { canManageAccessRights } from "@/lib/access";
import { SERVICE_TAGS } from "@/lib/service-catalog";
import { BRANCHES } from "@/lib/management";
import OrgChart from "@/components/OrgChart";

export const dynamic = "force-dynamic";
export const metadata = { title: "Org Chart — CanopyOS" };

// Company → Org Chart (Round 4) — the universal, company-readable reporting
// chart + directory, open to EVERY authenticated user (CSRs, techs, all staff).
// Cards are read-only for field TECHNICIANS; every other staff member may expand
// a card and edit its info (route, approved services, corporate role, scheduling).
// Re-checked server-side in `updateTileFields`.
export default async function CompanyOrgChartPage() {
  const user = await requireUser();
  const [{ roots, tiles }, topLevelIds] = await Promise.all([buildOrgTree(), companyRootEmployeeIds()]);

  // Every non-technician staff member may edit cards.
  const canEditAll = canEditOrgCards(user);
  // The full note log + the profile link live on the HR profile, which only
  // these principals may open; everyone else sees the chart read-only.
  const canOpenProfiles =
    user.role === "admin" || user.hrAccess || user.seniorLeadership || user.accessLevel === "sales_director";

  return (
    <>
      <PageHeader
        title="Org Chart"
        subtitle="Who's who across Vero Beach, Stuart, Orlando, and Naples — search by name, route number, service, or branch."
      />
      <OrgChart
        roots={roots}
        tiles={tiles}
        serviceTags={SERVICE_TAGS.map((t) => ({ key: t.key, label: t.label }))}
        branches={BRANCHES.map((b) => ({ key: b.key, label: b.label }))}
        canEditAll={canEditAll}
        canReassign={canManageAccessRights(user)}
        topLevelIds={topLevelIds}
        profileBase={canOpenProfiles ? "/management/people" : null}
      />
    </>
  );
}
