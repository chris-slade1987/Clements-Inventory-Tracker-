import Link from "next/link";
import { redirect } from "next/navigation";
import { Card, PageHeader, EmptyState } from "@/components/ui";
import { requireUser } from "@/lib/auth";
import { BRANCHES, branchLabel } from "@/lib/management";
import { dateShort } from "@/lib/format";
import {
  approvedPtoInRange,
  pendingPtoInRange,
  pendingRequestsForBranch,
  overlapForRequests,
  decisionLog,
  balancesForAll,
  canViewAllPto,
  ptoTypeLabel,
} from "@/lib/pto";
import PtoMonthCalendar, { type PtoEvent } from "@/components/PtoMonthCalendar";
import PtoReviewPanel from "@/components/PtoReviewPanel";

export const dynamic = "force-dynamic";

const TABS = [
  { key: "pending", label: "Pending" },
  { key: "calendar", label: "Calendar" },
  { key: "history", label: "History" },
  { key: "balances", label: "Balances" },
] as const;
type TabKey = (typeof TABS)[number]["key"];

function parseMonth(v: string | undefined): { year: number; month: number } {
  const now = new Date();
  if (v && /^\d{4}-\d{1,2}$/.test(v)) {
    const [y, m] = v.split("-").map(Number);
    if (m >= 1 && m <= 12) return { year: y, month: m };
  }
  return { year: now.getUTCFullYear(), month: now.getUTCMonth() + 1 };
}

const BASE = "/management/people/pto";

export default async function PtoCenterPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const user = await requireUser();
  // The PTO Center — admins + HR only.
  if (!canViewAllPto(user)) redirect("/me");

  const sp = await searchParams;
  const tab: TabKey = (TABS.find((t) => t.key === sp.tab)?.key ?? "pending") as TabKey;
  const branch = BRANCHES.find((b) => b.key === sp.branch)?.key ?? null;

  // Preserve helpers so tabs keep the branch and pills keep the tab/month.
  const withParams = (params: Record<string, string | null>) => {
    const sp2 = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) if (v) sp2.set(k, v);
    const s = sp2.toString();
    return s ? `${BASE}?${s}` : BASE;
  };

  return (
    <>
      <PageHeader title="PTO Center" subtitle="Company-wide approvals, calendar, decision history, and balances" />

      {/* Tabs (segmented) */}
      <div className="mb-4 flex flex-wrap gap-1 rounded-xl bg-black/20 p-1 w-fit">
        {TABS.map((t) => (
          <TabLink key={t.key} href={withParams({ tab: t.key, branch })} label={t.label} active={tab === t.key} />
        ))}
      </div>

      {/* Branch pills (kept on every tab). */}
      <div className="mb-4 flex flex-wrap gap-1 rounded-xl bg-black/20 p-1 w-fit">
        <Pill href={withParams({ tab, month: sp.month ?? null })} label="All branches" active={branch === null} />
        {BRANCHES.map((b) => (
          <Pill key={b.key} href={withParams({ tab, branch: b.key, month: sp.month ?? null })} label={b.label} active={branch === b.key} />
        ))}
      </div>

      {tab === "pending" ? <PendingTab branch={branch} /> : null}
      {tab === "calendar" ? <CalendarTab branch={branch} month={sp.month} /> : null}
      {tab === "history" ? <HistoryTab branch={branch} /> : null}
      {tab === "balances" ? <BalancesTab branch={branch} /> : null}
    </>
  );
}

// ---- Pending tab (act + oversee) -----------------------------------------
async function PendingTab({ branch }: { branch: string | null }) {
  const pending = await pendingRequestsForBranch(branch);
  const overlap = await overlapForRequests(pending);
  const monthOf = (d: Date) => `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;

  return (
    <PtoReviewPanel
      showBranch
      pending={pending.map((r) => ({
        id: r.id,
        employeeName: r.employee.name,
        branchLabel: r.employee.branch ? branchLabel(r.employee.branch) : null,
        days: r.days,
        type: ptoTypeLabel(r.type).toLowerCase(),
        startDate: r.startDate.toISOString(),
        endDate: r.endDate.toISOString(),
        note: r.note,
        overlap: overlap.get(r.id),
        calendarHref: `${BASE}?tab=calendar&month=${monthOf(r.startDate)}${r.employee.branch ? `&branch=${r.employee.branch}` : ""}`,
      }))}
    />
  );
}

// ---- Calendar tab (approved solid + pending outlined) --------------------
async function CalendarTab({ branch, month }: { branch: string | null; month: string | undefined }) {
  const { year, month: m } = parseMonth(month);
  const from = new Date(Date.UTC(year, m - 1, 1));
  const to = new Date(Date.UTC(year, m, 0, 23, 59, 59));
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

  return (
    <PtoMonthCalendar
      year={year}
      month={m}
      events={approved.map(toEvent)}
      pending={pending.map(toEvent)}
      basePath={BASE}
      preserve={{ tab: "calendar", ...(branch ? { branch } : {}) }}
      showBranch={branch === null}
    />
  );
}

// ---- History tab (decision log) ------------------------------------------
async function HistoryTab({ branch }: { branch: string | null }) {
  const log = await decisionLog(branch, 200);
  if (log.length === 0) return <EmptyState title="No decisions yet" hint="Approved and denied requests will appear here." />;

  return (
    <Card className="p-0 overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-muted border-b border-line">
              <th className="px-4 py-2 font-medium">Employee</th>
              <th className="px-3 py-2 font-medium">Branch</th>
              <th className="px-3 py-2 font-medium">Type</th>
              <th className="px-3 py-2 font-medium">Dates</th>
              <th className="px-3 py-2 font-medium text-right">Days</th>
              <th className="px-3 py-2 font-medium">Decision</th>
              <th className="px-3 py-2 font-medium">By</th>
              <th className="px-4 py-2 font-medium">Note</th>
            </tr>
          </thead>
          <tbody>
            {log.map((r) => (
              <tr key={r.id} className="border-b border-line last:border-0 align-top">
                <td className="px-4 py-2 font-medium text-ink">{r.employee.name}</td>
                <td className="px-3 py-2 text-muted">{r.employee.branch ? branchLabel(r.employee.branch) : "—"}</td>
                <td className="px-3 py-2 text-muted capitalize">{ptoTypeLabel(r.type).toLowerCase()}</td>
                <td className="px-3 py-2 text-muted whitespace-nowrap">
                  {dateShort(r.startDate)}{r.days > 1 ? ` – ${dateShort(r.endDate)}` : ""}
                </td>
                <td className="px-3 py-2 text-right tabular-nums text-muted">{r.days}</td>
                <td className="px-3 py-2">
                  <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium ${r.status === "approved" ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-600"}`}>
                    {r.status === "approved" ? "Approved" : "Denied"}
                  </span>
                </td>
                <td className="px-3 py-2 text-muted whitespace-nowrap">
                  {r.reviewedByName ?? "—"}
                  {r.decidedAt ? <div className="text-[11px] text-muted/80">{dateShort(r.decidedAt)}</div> : null}
                </td>
                <td className="px-4 py-2 text-muted">{r.decisionNote ? `“${r.decisionNote}”` : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

// ---- Balances tab --------------------------------------------------------
async function BalancesTab({ branch }: { branch: string | null }) {
  const year = new Date().getUTCFullYear();
  const rows = await balancesForAll(year, branch);
  if (rows.length === 0) return <EmptyState title="No active employees" hint="No one to show for this branch." />;

  return (
    <Card className="p-0 overflow-hidden">
      <div className="px-4 py-3 border-b border-line text-sm font-medium text-ink">Balances — {year}</div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-muted border-b border-line">
              <th className="px-4 py-2 font-medium">Employee</th>
              <th className="px-3 py-2 font-medium">Branch</th>
              <th className="px-3 py-2 font-medium text-right">Allowance</th>
              <th className="px-3 py-2 font-medium text-right">Used</th>
              <th className="px-3 py-2 font-medium text-right">Remaining</th>
              <th className="px-4 py-2 font-medium text-right">Pending</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((e) => (
              <tr key={e.id} className="border-b border-line last:border-0">
                <td className="px-4 py-2 font-medium text-ink">{e.name}</td>
                <td className="px-3 py-2 text-muted">{e.branch ? branchLabel(e.branch) : "—"}</td>
                <td className="px-3 py-2 text-right tabular-nums text-muted">{e.allowance}</td>
                <td className="px-3 py-2 text-right tabular-nums text-muted">{e.used}</td>
                <td className={`px-3 py-2 text-right tabular-nums font-medium ${e.remaining < 0 ? "text-red-600" : "text-emerald-600"}`}>{e.remaining}</td>
                <td className={`px-4 py-2 text-right tabular-nums ${e.pending ? "text-amber-600 font-medium" : "text-muted"}`}>{e.pending || "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

function TabLink({ href, label, active }: { href: string; label: string; active: boolean }) {
  return (
    <Link href={href} className={`rounded-lg px-4 py-1.5 text-xs font-medium transition-colors ${active ? "bg-emerald-grad text-[#05271c] shadow" : "text-mint hover:text-white"}`}>{label}</Link>
  );
}

function Pill({ href, label, active }: { href: string; label: string; active: boolean }) {
  return (
    <Link href={href} className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${active ? "bg-emerald-grad text-[#05271c] shadow" : "text-mint hover:text-white"}`}>{label}</Link>
  );
}
