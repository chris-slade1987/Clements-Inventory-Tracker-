import Link from "next/link";

// To-dos ⇄ KPIs ⇄ Routes ⇄ Command toggle for the branch-manager home. The
// manager's own branch performance (budget-vs-actual KPI gauges), the monthly
// routing sign-off, and the weekly Branch Command cockpit (route completion,
// pacing, jobs left behind) all hang off one toggle so a manager never has to hunt
// for where their branch data lives. Server component — links that preserve the
// active branch query.
export default function MyBranchViewToggle({
  view,
  branchQuery = "",
}: {
  view: "todos" | "kpis" | "routes" | "command";
  branchQuery?: string;
}) {
  const cell = (active: boolean) =>
    `rounded-lg px-4 py-2 text-sm transition ${
      active ? "bg-surface text-ink font-medium shadow-sm" : "text-muted hover:text-ink"
    }`;
  return (
    <div className="mb-4 mt-2 flex w-fit gap-1 rounded-xl bg-black/[0.06] p-1">
      <Link href={`/my-branch${branchQuery}`} className={cell(view === "todos")}>
        To-dos
      </Link>
      <Link href={`/executive?tab=overview${branchQuery ? `&${branchQuery.slice(1)}` : ""}`} className={cell(view === "kpis")}>
        KPIs
      </Link>
      <Link href={`/routing-approval${branchQuery}`} className={cell(view === "routes")}>
        Routes
      </Link>
      <Link href={`/branch-command${branchQuery}`} className={cell(view === "command")}>
        Command
      </Link>
    </div>
  );
}
