import type { ReactNode } from "react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Card, PageHeader } from "@/components/ui";
import { requireUser, isBoardObserver, isFieldOpsDirector, homePath } from "@/lib/auth";
import { BRANCHES, branchLabel } from "@/lib/management";
import { listAudits, openFollowUps } from "@/lib/audit";
import { warehouseStatus } from "@/lib/warehouse";
import MyReviewsCard from "@/components/MyReviewsCard";
import { listVehicles, isDueSoon } from "@/lib/fleet";

export const dynamic = "force-dynamic";

export default async function FieldOpsHomePage() {
  const user = await requireUser();
  if (isBoardObserver(user)) redirect("/management/board");
  // Field ops command center — the Director of Field Ops, admins, senior leadership.
  if (!(user.role === "admin" || user.seniorLeadership || isFieldOpsDirector(user))) redirect(homePath(user));

  const now = new Date();
  const year = now.getUTCFullYear();
  const month = now.getUTCMonth() + 1;
  const quarter = Math.floor(now.getUTCMonth() / 3) + 1;
  const monthLabel = new Date(Date.UTC(year, month - 1, 1)).toLocaleDateString("en-US", { month: "long", timeZone: "UTC" });

  const [audits, followUps, whStatuses, vehicles] = await Promise.all([
    listAudits(),
    openFollowUps(),
    Promise.all(BRANCHES.map(async (b) => ({ branch: b, ...(await warehouseStatus(year, month, b.key)) }))),
    listVehicles(undefined, "active"),
  ]);

  // Which branches have submitted this quarter's field audit.
  const auditedThisQuarter = new Set(
    audits.filter((a) => a.year === year && a.quarter === quarter && a.status === "submitted").map((a) => a.branch),
  );
  const auditsMissing = BRANCHES.filter((b) => !auditedThisQuarter.has(b.key));

  // Which branches are missing this month's warehouse safety inspection.
  const whMissing = whStatuses.filter((s) => !s.done).map((s) => s.branch);
  const whDone = BRANCHES.length - whMissing.length;

  const dueSoon = vehicles.filter((v) => isDueSoon(v));

  const actions: ActionItem[] = [
    { href: "/management/audits", label: `Branches without a Q${quarter} field audit`, count: auditsMissing.length, tone: "red",
      chips: auditsMissing.map((b) => b.label) },
    { href: "/management/audits", label: "Open audit follow-ups", count: followUps.length, tone: "amber" },
    { href: "/management/compliance", label: `Branches missing the ${monthLabel} warehouse inspection`, count: whMissing.length, tone: "amber",
      chips: whMissing.map((b) => b.label) },
    { href: "/fleet", label: "Vehicles due for service", count: dueSoon.length, tone: "amber" },
  ];
  const needAttention = actions.filter((a) => a.count > 0).sort((a, b) => TONE_RANK[a.tone] - TONE_RANK[b.tone] || b.count - a.count);
  const totalOpen = needAttention.reduce((s, a) => s + a.count, 0);

  return (
    <>
      <PageHeader
        title="Field Ops Command Center"
        subtitle={totalOpen > 0 ? `${totalOpen} item${totalOpen === 1 ? "" : "s"} across the branches need attention` : "All branches are current on audits, inspections & service"}
        actions={<Link href="/management/audits" className="text-sm font-medium text-brand-700 hover:underline">Branch audits →</Link>}
      />

      <MyReviewsCard userId={user.id} />

      {/* Snapshot */}
      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label={`Branches audited · Q${quarter}`} value={`${auditedThisQuarter.size}/${BRANCHES.length}`} href="/management/audits" tone={auditsMissing.length > 0 ? "amber" : "emerald"} />
        <Stat label="Open follow-ups" value={String(followUps.length)} href="/management/audits" tone={followUps.length > 0 ? "amber" : undefined} />
        <Stat label={`Warehouse checks · ${monthLabel}`} value={`${whDone}/${BRANCHES.length}`} href="/management/compliance" tone={whMissing.length > 0 ? "amber" : "emerald"} />
        <Stat label="Vehicles due for service" value={String(dueSoon.length)} href="/fleet" tone={dueSoon.length > 0 ? "amber" : undefined} />
      </div>

      {/* Needs attention */}
      <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">Needs your attention</div>
      {needAttention.length === 0 ? (
        <Card className="mb-6 flex items-center gap-3 p-4">
          <span className="grid h-9 w-9 place-items-center rounded-lg bg-emerald-100 text-emerald-700">
            <Icon d="M20 6L9 17l-5-5" />
          </span>
          <div>
            <div className="text-sm font-medium text-ink">Every branch is current.</div>
            <div className="text-xs text-muted">Audits submitted, warehouse inspections logged, and no vehicles overdue for service.</div>
          </div>
        </Card>
      ) : (
        <div className="mb-6 grid grid-cols-1 gap-3 lg:grid-cols-2">
          {needAttention.map((a, i) => (
            <ActionCard key={`${a.href}-${i}`} {...a} />
          ))}
        </div>
      )}

      {/* Per-branch status matrix */}
      <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">Branch status</div>
      <Card className="mb-6 p-0 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-muted border-b border-line">
                <th className="px-4 py-2 font-medium">Branch</th>
                <th className="px-3 py-2 font-medium text-center">Q{quarter} audit</th>
                <th className="px-3 py-2 font-medium text-center">{monthLabel} warehouse</th>
                <th className="px-3 py-2 font-medium text-right">Open follow-ups</th>
              </tr>
            </thead>
            <tbody>
              {BRANCHES.map((b) => {
                const audited = auditedThisQuarter.has(b.key);
                const wh = whStatuses.find((s) => s.branch.key === b.key)?.done ?? false;
                const fu = followUps.filter((f) => f.branch === b.key).length;
                return (
                  <tr key={b.key} className="border-b border-line last:border-0">
                    <td className="px-4 py-2 font-medium">
                      <Link href={`/management/audits?branch=${b.key}`} className="text-brand-700 hover:underline">{b.label}</Link>
                    </td>
                    <td className="px-3 py-2 text-center"><StatusDot ok={audited} okText="Submitted" badText="Missing" /></td>
                    <td className="px-3 py-2 text-center"><StatusDot ok={wh} okText="Logged" badText="Missing" /></td>
                    <td className={`px-3 py-2 text-right tabular-nums ${fu > 0 ? "text-amber-600 font-medium" : "text-muted"}`}>{fu}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>

      {/* Field ops areas */}
      <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">Field ops areas</div>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
        <AreaTile href="/management/audits" title="Branch audits" hint="Quarterly on-site oversight & follow-ups"
          icon={<Icon d="M9 12l2 2 4-4m-2-6l7 3v5c0 4-3 7-7 8-4-1-7-4-7-8V7z" />}
          badge={auditsMissing.length > 0 ? { text: `${auditsMissing.length} due`, tone: "red" } : undefined} />
        <AreaTile href="/checklists/oversight" title="Checklist oversight" hint="Weekly & monthly manager checklists"
          icon={<Icon d="M4 6h16M4 12h10M4 18h7M15 15l2 2 4-4" />} />
        <AreaTile href="/fleet" title="Fleet" hint="Vehicles, maintenance & operating cost"
          icon={<Icon d="M3 13l2-5h11l3 5M5 13h14v4H5zM7 17a2 2 0 104 0M15 17a2 2 0 104 0" />}
          badge={dueSoon.length > 0 ? { text: `${dueSoon.length} due`, tone: "amber" } : undefined} />
        <AreaTile href="/management/scorecards" title="Manager scorecards" hint="Quarterly branch-manager reviews"
          icon={<Icon d="M9 17v-6M12 17V7M15 17v-3M4 5a2 2 0 012-2h12a2 2 0 012 2v14a2 2 0 01-2 2H6a2 2 0 01-2-2z" />} />
        <AreaTile href="/management/compliance" title="Compliance" hint="Licenses, warehouse safety & renewals"
          icon={<Icon d="M12 3l8 4v5c0 5-3.5 8-8 9-4.5-1-8-4-8-9V7z" />} />
        <AreaTile href="/management" title="Branch performance" hint="Budget vs actual by branch"
          icon={<Icon d="M4 19V5m0 14h16M8 15l3-4 3 2 4-6" />} />
      </div>
    </>
  );
}

type Tone = "red" | "amber" | "emerald" | "slate";
type ActionItem = { href: string; label: string; count: number; tone: Tone; chips?: string[] };

const TONE_RANK: Record<Tone, number> = { red: 0, amber: 1, emerald: 2, slate: 3 };

const BADGE_TONE: Record<string, string> = {
  red: "bg-red-100 text-red-700",
  amber: "bg-amber-100 text-amber-700",
  emerald: "bg-emerald-100 text-emerald-700",
  slate: "bg-slate-100 text-slate-600",
};

const STAT_TONE: Record<string, string> = { amber: "text-amber-600", emerald: "text-emerald-600" };

function Stat({ label, value, href, tone }: { label: string; value: string; href: string; tone?: "amber" | "emerald" }) {
  return (
    <Link href={href}>
      <Card className="p-4 transition-colors hover:border-brand-200">
        <div className="text-xs uppercase tracking-wider text-muted">{label}</div>
        <div className={`mt-1 text-2xl font-light tabular-nums ${tone ? STAT_TONE[tone] : ""}`}>{value}</div>
      </Card>
    </Link>
  );
}

function ActionCard({ href, label, count, tone, chips }: ActionItem) {
  return (
    <Link href={href} className="group flex items-start gap-3 rounded-xl border border-line bg-surface p-4 transition-colors hover:border-brand-200 hover:bg-black/[0.02]">
      <span className={`grid h-11 w-11 shrink-0 place-items-center rounded-lg text-lg font-semibold tabular-nums ${BADGE_TONE[tone]}`}>{count}</span>
      <div className="min-w-0">
        <div className="text-sm font-medium text-ink group-hover:text-brand-700">{label}</div>
        {chips && chips.length > 0 ? (
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {chips.map((c) => (
              <span key={c} className="rounded-full bg-black/[0.04] px-2 py-0.5 text-[11px] font-medium text-muted">{c}</span>
            ))}
          </div>
        ) : (
          <div className="text-xs text-muted">Open →</div>
        )}
      </div>
    </Link>
  );
}

function StatusDot({ ok, okText, badText }: { ok: boolean; okText: string; badText: string }) {
  return ok ? (
    <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-medium text-emerald-700">{okText}</span>
  ) : (
    <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-700">{badText}</span>
  );
}

function Icon({ d }: { d: string }) {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round">
      <path d={d} />
    </svg>
  );
}

function AreaTile({
  href, title, hint, icon, badge,
}: {
  href: string;
  title: string;
  hint: string;
  icon: ReactNode;
  badge?: { text: string; tone: Tone };
}) {
  return (
    <Link href={href} className="group flex flex-col gap-3 rounded-xl border border-line bg-surface p-4 transition-colors hover:border-brand-200 hover:bg-black/[0.02]">
      <div className="flex items-start justify-between gap-2">
        <span className="grid h-9 w-9 place-items-center rounded-lg bg-brand-100 text-brand-700">{icon}</span>
        {badge ? <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${BADGE_TONE[badge.tone]}`}>{badge.text}</span> : null}
      </div>
      <div>
        <div className="text-sm font-medium text-ink group-hover:text-brand-700">{title}</div>
        <div className="text-xs text-muted line-clamp-1">{hint}</div>
      </div>
    </Link>
  );
}
