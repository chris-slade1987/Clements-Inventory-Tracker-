import Link from "next/link";
import { Card, PageHeader } from "@/components/ui";
import { requireUser, scopedBranch, branchLocked, isSuperAdmin } from "@/lib/auth";
import { planRescoreNotices, techEmail, managerEmail } from "@/lib/inspection-rescore-notify";
import RescoreNotices, { type NoticeRow } from "./RescoreNotices";
import { BRANCHES, branchLabel } from "@/lib/management";
import { inspectionStatus, technicianGrades, gradeLetter, vehicleCoverageGaps, inspectionMonths } from "@/lib/inspection";
import { managerTodoPeriod } from "@/lib/date";
import { ensureGraceInspectionsRefiled, ensureInspectionTechnicianNames } from "@/lib/inspection-grace";

export const dynamic = "force-dynamic";

const MONTHS = ["", "January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const MONTHS_SHORT = ["", "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function gradeChip(grade: string) {
  const c = grade === "A" || grade === "B" ? "bg-emerald-100 text-emerald-700" : grade === "C" ? "bg-amber-100 text-amber-700" : "bg-red-100 text-red-700";
  return `inline-grid h-6 w-6 place-items-center rounded-full text-xs font-bold ${c}`;
}

export default async function InspectionsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const user = await requireUser();
  const sp = await searchParams;
  const requested = BRANCHES.find((b) => b.key === sp.branch)?.key ?? null;
  const branch = scopedBranch(user, requested);
  const locked = branchLocked(user);

  // The default month is the manager to-do period: during the October-2026 grace
  // window that's October (so outstanding October items stay visible through the
  // COO's deadline); otherwise the live Eastern-Time month. A manager can pick any
  // other month from the selector to read that month's reports. See lib/date.ts.
  const todo = managerTodoPeriod();
  const selYear = Number(sp.year) || todo.year;
  const selMonth = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].includes(Number(sp.month)) ? Number(sp.month) : todo.month;
  const viewingGrace = todo.isOctoberGrace && selYear === todo.year && selMonth === todo.month;

  // The layout and this page render in parallel — wait for the (shared, once-per-
  // instance) inspection clean-up so the very first load is never stale.
  await Promise.all([ensureGraceInspectionsRefiled(), ensureInspectionTechnicianNames()]);

  const [insp, grades, coverageGaps, monthsWithData] = await Promise.all([
    inspectionStatus(selYear, selMonth, branch ?? undefined),
    technicianGrades(branch ?? undefined),
    vehicleCoverageGaps(branch ?? undefined),
    inspectionMonths(branch ?? undefined),
  ]);

  // Super admins: the one-time "scoring revised" notices (hidden once nothing changed).
  const notice = isSuperAdmin(user) ? await planRescoreNotices().catch(() => null) : null;
  const gradeStr = (s: { score: number; grade: string }) => `${s.score}/20 ${s.grade}`;
  const noticeTechs: NoticeRow[] = (notice?.techs ?? []).map((t) => ({
    who: t.name,
    email: t.email,
    alreadySent: t.alreadySent,
    detail: t.items.map((it) => `${it.vehicleLabel}: ${gradeStr(it.before)} → ${gradeStr(it.after)}`).join(" · "),
  }));
  const noticeManagers: NoticeRow[] = (notice?.managers ?? []).map((m) => ({
    who: `${m.name ?? "No manager on file"} · ${branchLabel(m.branch)}`,
    email: m.email,
    alreadySent: m.alreadySent,
    detail: m.items.length ? `${m.items.length} re-scored inspection${m.items.length === 1 ? "" : "s"}` : "Methodology notice only",
  }));
  const sampleTech = notice?.techs[0] ? techEmail(notice.techs[0]) : null;
  const sampleMgr = notice?.managers.find((m) => m.items.length) ?? notice?.managers[0];
  const sampleManager = sampleMgr ? managerEmail(sampleMgr) : null;

  // Month-picker options: every month that has data, plus the current to-do month
  // and whatever month is selected — de-duped, newest first.
  const monthKey = (y: number, m: number) => y * 100 + m;
  const optionMap = new Map<number, { year: number; month: number }>();
  for (const m of [...monthsWithData, { year: todo.year, month: todo.month }, { year: selYear, month: selMonth }]) {
    optionMap.set(monthKey(m.year, m.month), m);
  }
  const monthOptions = [...optionMap.values()].sort((a, b) => monthKey(b.year, b.month) - monthKey(a.year, a.month));

  const branchParam = (key: string | null) => {
    const p = new URLSearchParams();
    if (key) p.set("branch", key);
    p.set("year", String(selYear));
    p.set("month", String(selMonth));
    return `/my-branch/inspections?${p.toString()}`;
  };
  const monthParam = (y: number, m: number) => {
    const p = new URLSearchParams();
    if (requested) p.set("branch", requested);
    p.set("year", String(y));
    p.set("month", String(m));
    return `/my-branch/inspections?${p.toString()}`;
  };

  const inspectHref = (vehicleId: string, hasReport: boolean) =>
    `/fleet/${vehicleId}/inspect?${hasReport ? "view=report&" : ""}src=branch&year=${selYear}&month=${selMonth}${requested ? `&branch=${requested}` : ""}`;

  return (
    <>
      <PageHeader
        title="Vehicle Inspections"
        subtitle={`${MONTHS[selMonth]} ${selYear} — ${insp.completed}/${insp.total} complete${insp.pending > 0 ? ` · ${insp.pending} pending` : ""}`}
      />

      {/* Month selector — read any month's reports; rolling grades span all months. */}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <span className="text-[11px] uppercase tracking-wider text-muted">Month</span>
        <div className="flex flex-wrap gap-1 rounded-xl bg-black/[0.06] p-1">
          {monthOptions.map((m) => {
            const active = m.year === selYear && m.month === selMonth;
            const isTodo = todo.isOctoberGrace && m.year === todo.year && m.month === todo.month;
            return (
              <Link
                key={monthKey(m.year, m.month)}
                href={monthParam(m.year, m.month)}
                className={`rounded-lg px-3 py-1.5 text-xs font-medium ${active ? "bg-emerald-grad text-white shadow-sm" : "text-ink/80 hover:bg-black/[0.04]"}`}
              >
                {MONTHS_SHORT[m.month]} {m.year}
                {isTodo ? <span className={`ml-1 ${active ? "text-white/80" : "text-muted"}`}>· due</span> : null}
              </Link>
            );
          })}
        </div>
      </div>

      {locked ? null : (
        <div className="mb-4 flex flex-wrap gap-1 rounded-xl bg-black/20 p-1 w-fit">
          <BranchPill href={branchParam(null)} label="All branches" active={branch === null} />
          {BRANCHES.map((b) => (
            <BranchPill key={b.key} href={branchParam(b.key)} label={b.label} active={branch === b.key} />
          ))}
        </div>
      )}

      {notice && notice.techs.length > 0 ? (
        <RescoreNotices
          techs={noticeTechs}
          managers={noticeManagers}
          sampleTech={sampleTech ? { subject: sampleTech.subject, text: sampleTech.text } : null}
          sampleManager={sampleManager ? { subject: sampleManager.subject, text: sampleManager.text } : null}
        />
      ) : null}

      {viewingGrace ? (
        <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-800">
          <span className="font-semibold">October grace window.</span> Any inspection completed through end of day
          <span className="font-medium"> Friday, Nov 6</span> counts toward <span className="font-medium">October {selYear}</span> —
          including spare-truck and catch-up inspections. November inspections open automatically on Monday, Nov 9.
        </div>
      ) : null}

      {/* Selected month's inspection status */}
      <Card className="p-0 overflow-hidden mb-5">
        <div className="px-4 py-3 border-b border-line flex items-center justify-between gap-2">
          <span className="text-sm font-medium text-ink">{MONTHS[selMonth]} {selYear} · by vehicle</span>
          <span className="text-xs text-muted tabular-nums">{insp.completed}/{insp.total} complete{insp.pending > 0 ? ` · ${insp.pending} pending` : ""}</span>
        </div>
        {insp.rows.length === 0 ? (
          <p className="px-4 py-8 text-center text-sm text-muted">No active vehicles.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-muted border-b border-line">
                  <th className="px-4 py-2 font-medium">Vehicle</th>
                  <th className="px-3 py-2 font-medium">Branch</th>
                  <th className="px-3 py-2 font-medium">Technician</th>
                  <th className="px-3 py-2 font-medium">{MONTHS[selMonth]} status</th>
                  <th className="px-4 py-2 font-medium text-right">Action</th>
                </tr>
              </thead>
              <tbody>
                {insp.rows.map((r) => (
                  <tr key={r.id} className="border-b border-line last:border-0">
                    <td className="px-4 py-2 font-medium">{r.unitNumber ? `#${r.unitNumber} · ` : ""}{r.name}</td>
                    <td className="px-3 py-2 text-muted">{r.branch ? branchLabel(r.branch) : "—"}</td>
                    <td className="px-3 py-2 text-muted">{r.assignedTo ?? "—"}</td>
                    <td className="px-3 py-2">
                      {r.inspection ? (
                        <span className="inline-flex items-center gap-1.5">
                          <span className={gradeChip(r.inspection.grade)}>{r.inspection.grade}</span>
                          <span className="text-xs text-muted tabular-nums">{r.inspection.scorePct}%</span>
                        </span>
                      ) : (
                        <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-700">Pending · {MONTHS_SHORT[selMonth]}</span>
                      )}
                    </td>
                    <td className="px-4 py-2 text-right">
                      <Link href={inspectHref(r.id, !!r.inspection)} className="text-xs font-medium text-brand-700 hover:underline">
                        {r.inspection ? "View report" : "Start inspection"}
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Spare / additional vehicles inspected this month (not on the required list,
            e.g. spares inspected to help cover a branch). Always count as completed. */}
        {insp.extraRows.length > 0 ? (
          <>
            <div className="px-4 py-2 border-t border-line bg-black/[0.02] text-xs font-medium text-muted">
              Additional vehicles inspected in {MONTHS[selMonth]} {selYear} · spares &amp; catch-up (not on the required list)
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <tbody>
                  {insp.extraRows.map((r) => (
                    <tr key={r.id} className="border-b border-line last:border-0">
                      <td className="px-4 py-2 font-medium">{r.unitNumber ? `#${r.unitNumber} · ` : ""}{r.name}</td>
                      <td className="px-3 py-2 text-muted">{r.branch ? branchLabel(r.branch) : "—"}</td>
                      <td className="px-3 py-2 text-muted">{r.assignedTo ?? "—"}</td>
                      <td className="px-3 py-2">
                        {r.inspection ? (
                          <span className="inline-flex items-center gap-1.5">
                            <span className={gradeChip(r.inspection.grade)}>{r.inspection.grade}</span>
                            <span className="text-xs text-muted tabular-nums">{r.inspection.scorePct}%</span>
                          </span>
                        ) : null}
                      </td>
                      <td className="px-4 py-2 text-right">
                        <Link href={inspectHref(r.id, true)} className="text-xs font-medium text-brand-700 hover:underline">View report</Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        ) : null}
      </Card>

      {/* Coverage gaps — techs / advisors with no vehicle linked (fix these) */}
      <Card className="p-0 overflow-hidden mb-5">
        <div className="px-4 py-3 border-b border-line text-sm font-medium text-ink">
          Needs a vehicle linked · technicians &amp; service advisors
          {coverageGaps.length > 0 ? <span className="ml-2 rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-700">{coverageGaps.length}</span> : null}
        </div>
        {coverageGaps.length === 0 ? (
          <p className="px-4 py-8 text-center text-sm text-muted">Every active technician and service advisor has a vehicle linked.</p>
        ) : (
          <>
            <p className="px-4 pt-3 text-xs text-muted">These people have no vehicle assigned, so nothing shows for them on inspections. Link a truck on <Link href="/fleet/assignments" className="text-brand-700 hover:underline">Fleet → Driver assignments</Link>.</p>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-muted border-b border-line">
                    <th className="px-4 py-2 font-medium">Name</th>
                    <th className="px-3 py-2 font-medium">Role</th>
                    <th className="px-4 py-2 font-medium">Branch</th>
                  </tr>
                </thead>
                <tbody>
                  {coverageGaps.map((g) => (
                    <tr key={g.id} className="border-b border-line last:border-0">
                      <td className="px-4 py-2 font-medium">{g.name}</td>
                      <td className="px-3 py-2 text-muted">{g.role ?? "—"}</td>
                      <td className="px-4 py-2 text-muted">{g.branch ? branchLabel(g.branch) : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </Card>

      {/* Technician grades (rolling across all months — feeds the quarterly scorecard) */}
      <Card className="p-0 overflow-hidden">
        <div className="px-4 py-3 border-b border-line flex items-center justify-between gap-2">
          <span className="text-sm font-medium text-ink">Technician grades · rolling average</span>
          <span className="text-xs text-muted">All months · feeds the quarterly scorecard</span>
        </div>
        {grades.length === 0 ? (
          <p className="px-4 py-8 text-center text-sm text-muted">No inspections recorded yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-muted border-b border-line">
                  <th className="px-4 py-2 font-medium">Technician</th>
                  <th className="px-3 py-2 font-medium text-right">Inspections</th>
                  <th className="px-3 py-2 font-medium text-right">Avg score</th>
                  <th className="px-3 py-2 font-medium">Last inspected</th>
                  <th className="px-4 py-2 font-medium text-center">Grade</th>
                </tr>
              </thead>
              <tbody>
                {grades.map((g) => (
                  <tr key={g.technicianName} className="border-b border-line last:border-0">
                    <td className="px-4 py-2 font-medium">{g.technicianName}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-muted">{g.count}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{g.avgPct}%</td>
                    <td className="px-3 py-2 text-muted">{MONTHS_SHORT[g.lastDate.getMonth() + 1]} {g.lastDate.getFullYear()}</td>
                    <td className="px-4 py-2 text-center"><span className={gradeChip(gradeLetter(g.avgPct))}>{g.grade}</span></td>
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

function BranchPill({ href, label, active }: { href: string; label: string; active: boolean }) {
  return (
    <Link href={href} className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${active ? "bg-emerald-grad text-white shadow" : "text-muted hover:text-ink"}`}>
      {label}
    </Link>
  );
}
