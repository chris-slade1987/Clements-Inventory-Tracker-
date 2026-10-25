import { requireUser, canViewExec, canManageSales } from "@/lib/auth";
import ExecTabs from "./ExecTabs";
import { OverviewPanel } from "./panels/OverviewPanel";
import { BranchesPanel } from "./panels/BranchesPanel";
import { FinancialsPanel } from "./panels/FinancialsPanel";
import { SalesPanel } from "./panels/SalesPanel";

export const dynamic = "force-dynamic";
export const metadata = { title: "Executive — CanopyOS" };

type TabKey = "overview" | "branches" | "financials" | "sales";

// ONE consolidated Executive dashboard (nav/IA refactor P1). Four tabs over the
// same Monthly Board Report dataset — Overview (operating KPIs, pacing, FY forecast,
// sales funnel), Branches (per-branch P&L + cross-branch benchmarking league),
// Financials (full P&L / balance sheet / cash flow / SG&A), and Sales & Attrition
// (pipeline + cancellations). Replaces the former `/management`, `/management/board`,
// `/management/benchmarking`, `/management/sales` and `/management/insights` pages
// (all now redirects into the right tab).
//
// Role-scoping is preserved per tab (CLAUDE.md lockstep / nav-IA spec §P1):
//   • Overview — the audience the old `/management` Company KPIs served (branch
//     managers branch-scoped, admins/exec company-wide with the branch switcher,
//     the Sales Director, board observers). This tab is NOT exec-gated.
//   • Branches & Financials — exec only (`canViewExec`: admin / senior / board).
//   • Sales & Attrition — exec OR sales leadership (`canManageSales`: the Sales
//     Director).
// Page access itself is grant-gated upstream by the (app) layout, which maps
// `/executive` to the `management` catalog item, so every principal who can open
// the old `/management` can open the Overview; requesting a tab they aren't
// entitled to silently falls back to Overview (no access leak).
export default async function ExecutivePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const user = await requireUser();
  const sp = await searchParams;

  const canExec = canViewExec(user);
  const canSales = canManageSales(user);

  const tabs = [
    { key: "overview", label: "Overview", show: true },
    { key: "branches", label: "Branches", show: canExec },
    { key: "financials", label: "Financials", show: canExec },
    { key: "sales", label: "Sales & Attrition", show: canExec || canSales },
  ].filter((t) => t.show);

  // Resolve the active tab; an unknown tab or one the viewer isn't entitled to
  // falls back to Overview (which everyone who reaches this page can see).
  let active: TabKey = (sp.tab as TabKey) ?? "overview";
  if (!tabs.some((t) => t.key === active)) active = "overview";

  return (
    <>
      <ExecTabs tabs={tabs} active={active} period={sp.p} basis={sp.basis} />
      {active === "overview" ? (
        <OverviewPanel user={user} sp={sp} />
      ) : active === "branches" ? (
        <BranchesPanel user={user} sp={sp} />
      ) : active === "financials" ? (
        <FinancialsPanel user={user} sp={sp} />
      ) : (
        <SalesPanel user={user} sp={sp} />
      )}
    </>
  );
}
