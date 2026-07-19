import Link from "next/link";
import { PageHeader } from "@/components/ui";
import { requireUser, scopedBranch, branchLocked } from "@/lib/auth";
import { BRANCHES, branchLabel } from "@/lib/management";
import { approvedPtoInRange, pendingPtoInRange } from "@/lib/pto";
import PtoMonthCalendar, { type PtoEvent } from "@/components/PtoMonthCalendar";

export const dynamic = "force-dynamic";

function parseMonth(v: string | undefined): { year: number; month: number } {
  const now = new Date();
  if (v && /^\d{4}-\d{1,2}$/.test(v)) {
    const [y, m] = v.split("-").map(Number);
    if (m >= 1 && m <= 12) return { year: y, month: m };
  }
  return { year: now.getUTCFullYear(), month: now.getUTCMonth() + 1 };
}

export default async function TeamPtoPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const user = await requireUser();
  const sp = await searchParams;
  const branch = scopedBranch(user, BRANCHES.find((b) => b.key === sp.branch)?.key ?? null);
  const locked = branchLocked(user);
  const { year, month } = parseMonth(sp.month);

  const from = new Date(Date.UTC(year, month - 1, 1));
  const to = new Date(Date.UTC(year, month, 0, 23, 59, 59));
  const [approved, pending] = await Promise.all([
    approvedPtoInRange(from, to, branch),
    pendingPtoInRange(from, to, branch),
  ]);
  const toEvent = (r: { id: string; employee: { name: string; branch: string | null }; type: string; startDate: Date; endDate: Date }): PtoEvent => ({
    id: r.id,
    employeeName: r.employee.name,
    branch: r.employee.branch,
    type: r.type,
    startISO: r.startDate.toISOString(),
    endISO: r.endDate.toISOString(),
  });
  const events: PtoEvent[] = approved.map(toEvent);
  const pendingEvents: PtoEvent[] = pending.map(toEvent);

  return (
    <>
      <div className="mb-2"><Link href="/my-branch/team" className="text-xs font-medium text-brand-300 hover:underline">← My Team</Link></div>
      <PageHeader title="Team PTO calendar" subtitle={`${branch ? branchLabel(branch) : "All branches"} — approved (solid) + pending (outlined)`} />

      {!locked ? (
        <div className="mb-4 flex flex-wrap gap-1 rounded-xl bg-black/20 p-1 w-fit">
          <Pill href="/my-branch/pto" label="All branches" active={branch === null} />
          {BRANCHES.map((b) => <Pill key={b.key} href={`/my-branch/pto?branch=${b.key}`} label={b.label} active={branch === b.key} />)}
        </div>
      ) : null}

      <PtoMonthCalendar year={year} month={month} events={events} pending={pendingEvents} basePath="/my-branch/pto" preserve={branch ? { branch } : {}} showBranch={branch === null} />
    </>
  );
}

function Pill({ href, label, active }: { href: string; label: string; active: boolean }) {
  return (
    <Link href={href} className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${active ? "bg-emerald-grad text-[#05271c] shadow" : "text-mint hover:text-white"}`}>{label}</Link>
  );
}
