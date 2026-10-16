import Link from "next/link";

// To-dos ⇄ Branch KPIs toggle for the branch-manager home. The manager's own
// branch performance (budget-vs-actual, the v2 KPI gauges) now lives inside My
// Branch so they never need the company-wide Executive center. Server component —
// just two links that preserve the active branch query.
export default function MyBranchViewToggle({
  view,
  branchQuery = "",
}: {
  view: "todos" | "kpis";
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
      <Link href={`/management${branchQuery}`} className={cell(view === "kpis")}>
        KPIs
      </Link>
    </div>
  );
}
