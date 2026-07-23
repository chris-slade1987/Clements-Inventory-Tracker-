import Link from "next/link";
import { redirect } from "next/navigation";
import { Card, PageHeader, EmptyState } from "@/components/ui";
import { requireUser, isBoardObserver, scopedBranch, branchLocked } from "@/lib/auth";
import { BRANCHES, branchLabel } from "@/lib/management";
import {
  absencesForBranch,
  outstandingMedicalNotes,
  absencePatterns,
  reasonLabel,
  canResolveNotes,
} from "@/lib/absence";
import CalloutNoteActions from "./CalloutNoteActions";

export const dynamic = "force-dynamic";

const fmt = (d: Date) => d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
const rangeOf = (a: { startDate: Date; endDate: Date; days: number }) => (a.days > 1 ? `${fmt(a.startDate)} – ${fmt(a.endDate)}` : fmt(a.startDate));

const NOTE_STYLE: Record<string, string> = {
  requested: "bg-amber-100 text-amber-700",
  received: "bg-emerald-100 text-emerald-700",
  waived: "bg-slate-200 text-slate-600",
  none: "bg-slate-100 text-slate-500",
};

export default async function CalloutOverviewPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const user = await requireUser();
  if (isBoardObserver(user)) redirect("/management/board");

  // Access: admin + HR (any branch) or a branch manager (own branch only).
  const isAdminHr = user.role === "admin" || user.hrAccess || canResolveNotes(user);
  const isManager = user.role === "manager" && !!user.branch;
  if (!isAdminHr && !isManager) redirect("/me");

  const sp = await searchParams;
  const requested = BRANCHES.find((b) => b.key === sp.branch)?.key ?? null;
  const branch = scopedBranch(user, requested); // managers pinned to their branch
  const locked = branchLocked(user);
  const canResolve = canResolveNotes(user);

  const [outstanding, recent, patterns] = await Promise.all([
    outstandingMedicalNotes(branch),
    absencesForBranch(branch, 100),
    absencePatterns(branch, 90),
  ]);

  return (
    <>
      <div className="mb-2">
        <Link href="/management/people" className="text-xs font-medium text-brand-300 hover:underline">← People / HR</Link>
      </div>
      <PageHeader title="Call-out overview" subtitle="Unplanned absences — outstanding medical notes, recent call-outs, and attendance patterns" />

      {/* Branch filter (admins/HR only) */}
      {locked ? null : (
        <div className="mb-4 flex flex-wrap gap-1 rounded-xl bg-black/20 p-1 w-fit">
          <Pill href="/management/people/callouts" label="All branches" active={branch === null} />
          {BRANCHES.map((b) => (
            <Pill key={b.key} href={`/management/people/callouts?branch=${b.key}`} label={b.label} active={branch === b.key} />
          ))}
        </div>
      )}

      {/* Outstanding medical notes */}
      <Card className="p-0 overflow-hidden mb-5">
        <div className="px-4 py-3 border-b border-line flex items-center gap-2">
          <div className="text-sm font-medium text-ink">Outstanding medical notes</div>
          {outstanding.length > 0 ? <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700">{outstanding.length}</span> : null}
        </div>
        {outstanding.length === 0 ? (
          <p className="px-4 py-6 text-center text-sm text-muted">No medical notes outstanding. A note is auto-requested when an illness (employee or family) exceeds 2 days.</p>
        ) : (
          <ul className="divide-y divide-line">
            {outstanding.map((a) => (
              <li key={a.id} className="px-4 py-3 flex flex-wrap items-center gap-x-3 gap-y-2">
                <Link href={`/management/people/${a.employeeId}`} className="text-sm font-medium text-brand-700 hover:underline">{a.employee.name}</Link>
                <span className="text-xs text-muted">{a.employee.branch ? branchLabel(a.employee.branch) : "—"}</span>
                <span className="text-sm text-ink">{rangeOf(a)}</span>
                <span className="text-xs text-muted">· {a.days} days · {reasonLabel(a.reason)}</span>
                {canResolve ? <span className="ml-auto"><CalloutNoteActions id={a.id} /></span> : <span className="ml-auto rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-700">awaiting proof</span>}
              </li>
            ))}
          </ul>
        )}
      </Card>

      {/* Patterns (trailing 90 days) */}
      <Card className="p-0 overflow-hidden mb-5">
        <div className="px-4 py-3 border-b border-line text-sm font-medium text-ink">Patterns — trailing 90 days</div>
        {patterns.length === 0 ? (
          <p className="px-4 py-6 text-center text-sm text-muted">No call-outs logged in the last 90 days.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-muted border-b border-line">
                  <th className="px-4 py-2 font-medium">Employee</th>
                  <th className="px-3 py-2 font-medium">Branch</th>
                  <th className="px-3 py-2 font-medium text-right">Call-outs</th>
                  <th className="px-3 py-2 font-medium text-right">Total days</th>
                  <th className="px-4 py-2 font-medium">Last</th>
                </tr>
              </thead>
              <tbody>
                {patterns.map((p) => (
                  <tr key={p.employeeId} className="border-b border-line last:border-0">
                    <td className="px-4 py-2 font-medium">
                      <Link href={`/management/people/${p.employeeId}`} className="text-brand-700 hover:underline">{p.name}</Link>
                    </td>
                    <td className="px-3 py-2 text-muted">{p.branch ? branchLabel(p.branch) : "—"}</td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      <span className={p.count >= 3 ? "font-semibold text-red-600" : ""}>{p.count}</span>
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">{p.totalDays}</td>
                    <td className="px-4 py-2 text-muted">{fmt(p.lastDate)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* Recent call-outs */}
      <Card className="p-0 overflow-hidden">
        <div className="px-4 py-3 border-b border-line text-sm font-medium text-ink">Recent call-outs</div>
        {recent.length === 0 ? (
          <EmptyState title="No call-outs logged" hint="Call-outs are logged from an employee's profile." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-muted border-b border-line">
                  <th className="px-4 py-2 font-medium">Dates</th>
                  <th className="px-3 py-2 font-medium">Employee</th>
                  <th className="px-3 py-2 font-medium">Branch</th>
                  <th className="px-3 py-2 font-medium">Reason</th>
                  <th className="px-3 py-2 font-medium text-right">Days</th>
                  <th className="px-3 py-2 font-medium">Note</th>
                  <th className="px-4 py-2 font-medium">Logged by</th>
                </tr>
              </thead>
              <tbody>
                {recent.map((a) => (
                  <tr key={a.id} className="border-b border-line last:border-0">
                    <td className="px-4 py-2 whitespace-nowrap">{rangeOf(a)}</td>
                    <td className="px-3 py-2">
                      <Link href={`/management/people/${a.employeeId}`} className="text-brand-700 hover:underline">{a.employee.name}</Link>
                    </td>
                    <td className="px-3 py-2 text-muted">{a.employee.branch ? branchLabel(a.employee.branch) : "—"}</td>
                    <td className="px-3 py-2">
                      {reasonLabel(a.reason)}
                      {a.reason === "physical_injury" && a.workplaceRelated ? <span className="ml-1 rounded-full bg-red-100 px-1.5 py-0.5 text-[10px] font-medium text-red-700">workplace</span> : null}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">{a.days}</td>
                    <td className="px-3 py-2">
                      {a.noteRequired ? <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${NOTE_STYLE[a.noteStatus] ?? NOTE_STYLE.none}`}>{a.noteStatus}</span> : <span className="text-muted">—</span>}
                    </td>
                    <td className="px-4 py-2 text-muted">{a.loggedByName ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </>
  );
}

function Pill({ href, label, active }: { href: string; label: string; active: boolean }) {
  return (
    <Link href={href} className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${active ? "bg-emerald-grad text-[#05271c] shadow" : "text-mint hover:text-white"}`}>
      {label}
    </Link>
  );
}
