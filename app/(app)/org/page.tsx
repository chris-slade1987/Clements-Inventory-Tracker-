import { PageHeader } from "@/components/ui";
import { requireUser } from "@/lib/auth";
import { buildOrgTree } from "@/lib/org-chart";
import { SERVICE_TAGS } from "@/lib/service-catalog";
import { BRANCHES } from "@/lib/management";
import OrgChart from "@/components/OrgChart";

export const dynamic = "force-dynamic";
export const metadata = { title: "Org Chart — CanopyOS" };

// Company → Org Chart (Round 2) — the universal, company-readable reporting
// chart + directory, open to EVERY authenticated user (CSRs, techs, all staff).
// Read-only tiles + search for everyone; scoped tile editing is surfaced only to
// HR / leadership / super-admins (anyone) and branch managers (own branch), and
// re-checked server-side in `updateTileFields`.
export default async function CompanyOrgChartPage() {
  const user = await requireUser();
  const { roots, tiles } = await buildOrgTree();

  const canEditAll = user.role === "admin" || user.seniorLeadership || user.hrAccess;
  const editBranch = user.role === "manager" ? user.branch : null;
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
        editBranch={editBranch}
        profileBase={canOpenProfiles ? "/management/people" : null}
      />
    </>
  );
}
