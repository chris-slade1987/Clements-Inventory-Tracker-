import Link from "next/link";
import { Card, PageHeader } from "@/components/ui";
import { requireUser, scopedBranch } from "@/lib/auth";
import { BRANCHES, branchLabel } from "@/lib/management";
import { fleetLiveSummary } from "@/lib/gps";
import { STATUS_META, lastSeen } from "@/lib/gps-ui";
import {
  gpsUtilization,
  gpsExceptionCounts,
  gpsVehicleRollup,
  gpsNarrative,
  hasGpsInsightsKey,
  GPS_ALERT_TYPE_META,
  GPS_THRESHOLDS,
} from "@/lib/gps-detect";
import RunAnalysisButton from "./RunAnalysisButton";

export const dynamic = "force-dynamic";

const EXCEPTION_TYPES = ["speeding", "idle", "after_hours", "offline", "out_of_area"] as const;

export default async function GpsDashboardPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const user = await requireUser();
  const sp = await searchParams;
  const requested = BRANCHES.find((b) => b.key === sp.branch)?.key ?? null;
  const branch = scopedBranch(user, requested);
  const scope = branch ?? undefined;

  const [summary, util, exceptions, rollup, narrative] = await Promise.all([
    fleetLiveSummary(scope),
    gpsUtilization(new Date(), scope),
    gpsExceptionCounts(scope),
    gpsVehicleRollup(new Date(), scope),
    gpsNarrative(new Date(), scope),
  ]);

  const isSample = summary.sample || util.sample;
  const alertsHref = (type?: string) => {
    const params = new URLSearchParams();
    if (branch) params.set("branch", branch);
    if (type) params.set("type", type);
    const qs = params.toString();
    return `/fleet/gps/alerts${qs ? `?${qs}` : ""}`;
  };

  return (
    <>
      <div className="mb-2">
        <Link href="/fleet" className="text-xs font-medium text-brand-700 hover:underline">← Fleet</Link>
      </div>
      <PageHeader
        title="GPS Analytics"
        subtitle="Fleet utilization, exceptions & AI insights from Verizon Connect Reveal"
        actions={user.role === "admin" ? <RunAnalysisButton /> : undefined}
      />

      {isSample ? (
        <Card className="mb-4 border-amber-200 bg-amber-50 p-3 text-sm text-amber-800" data-testid="sample-banner">
          <span className="font-medium">Sample data</span> — connect Verizon Connect Reveal (set the
          <code className="mx-1 rounded bg-amber-100 px-1">VERIZON_*</code> environment variables) to go live.
          These figures are simulated; no alerts are ever filed from sample data.
        </Card>
      ) : null}

      {/* Branch filter (admins only — branch managers are pinned). */}
      {user.role === "admin" ? (
        <div className="mb-4 flex flex-wrap gap-1 rounded-xl bg-black/20 p-1 w-fit">
          <BranchPill href="/fleet/gps" label="All branches" active={branch === null} />
          {BRANCHES.map((b) => (
            <BranchPill key={b.key} href={`/fleet/gps?branch=${b.key}`} label={b.label} active={branch === b.key} />
          ))}
        </div>
      ) : null}

      {/* Fleet status strip */}
      <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted">Fleet status</div>
      <div className="grid gap-3 grid-cols-2 lg:grid-cols-5 mb-2">
        <Tile label="Tracked" value={String(summary.linked)} />
        <Tile label="Moving" value={String(summary.moving)} color={STATUS_META.moving.color} />
        <Tile label="Idling" value={String(summary.idle)} color={STATUS_META.idle.color} />
        <Tile label="Stopped" value={String(summary.stopped)} color={STATUS_META.stopped.color} />
        <Tile label="Offline" value={String(summary.offline)} color={STATUS_META.offline.color} />
      </div>
      <p className="mb-5 text-xs text-muted">
        {summary.lastSyncAt ? `Last sync ${lastSeen(summary.lastSyncAt)}` : "No sync yet"}
        {summary.lastSyncOk === false ? " · last sync failed" : ""} ·{" "}
        <Link href="/fleet/map" className="text-brand-700 hover:underline">Open Live Map →</Link>
      </p>

      {/* Utilization */}
      <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted">Utilization</div>
      <div className="grid gap-3 grid-cols-2 lg:grid-cols-5 mb-5">
        <Tile label="Active today" value={String(util.activeToday)} />
        <Tile label="Miles today" value={util.milesToday.toLocaleString()} />
        <Tile label="Miles this week" value={util.milesWeek.toLocaleString()} />
        <Tile label="Stops today" value={String(util.stopsToday)} />
        <Tile label="Avg trip (mi)" value={String(util.avgTripMi)} />
      </div>

      {/* Exceptions (trailing window; clickable to the alerts section) */}
      <div className="mb-2 flex items-center justify-between">
        <span className="text-xs font-semibold uppercase tracking-wider text-muted">
          Open exceptions · last {GPS_THRESHOLDS.WINDOW_DAYS} days
        </span>
        <Link href={alertsHref()} className="text-xs font-medium text-brand-700 hover:underline">All GPS alerts →</Link>
      </div>
      <div className="grid gap-3 grid-cols-2 lg:grid-cols-5 mb-5">
        {EXCEPTION_TYPES.map((t) => (
          <Link key={t} href={alertsHref(t)} data-testid={`exception-${t}`}>
            <Card className="p-4 hover:bg-black/[0.02] transition-colors">
              <div className="text-xs uppercase tracking-wider text-muted">{GPS_ALERT_TYPE_META[t].label}</div>
              <div className="mt-1 text-2xl font-light tabular-nums">{exceptions[t] ?? 0}</div>
            </Card>
          </Link>
        ))}
      </div>

      {/* AI insights */}
      <Card className="mb-5 p-4" data-testid="gps-insights">
        <div className="mb-2 flex items-center gap-2">
          <span className="text-sm font-medium text-ink">AI insights</span>
          {narrative.aiGenerated ? (
            <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-medium text-emerald-700">AI</span>
          ) : (
            <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-500">Rules-based</span>
          )}
          {(exceptions.ai_pattern ?? 0) > 0 ? (
            <Link href={alertsHref("ai_pattern")} className="ml-auto text-xs font-medium text-brand-700 hover:underline">
              {exceptions.ai_pattern} AI pattern alert{exceptions.ai_pattern === 1 ? "" : "s"} →
            </Link>
          ) : null}
        </div>
        <p className="text-sm leading-relaxed text-muted whitespace-pre-line">{narrative.text}</p>
        {!hasGpsInsightsKey() ? (
          <p className="mt-2 text-xs text-muted">
            Set an <code className="rounded bg-black/[0.05] px-1">ANTHROPIC_API_KEY</code> (or{" "}
            <code className="rounded bg-black/[0.05] px-1">INSIGHTS_ANTHROPIC_API_KEY</code>) in the hosting environment to
            enable AI-written pattern analysis. Rule-based detection runs without it.
          </p>
        ) : null}
      </Card>

      {/* Per-vehicle rollup */}
      <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted">Per-vehicle rollup</div>
      <Card className="p-0 overflow-hidden" data-testid="gps-rollup">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-muted border-b border-line">
                <th className="px-4 py-2 font-medium">Vehicle</th>
                <th className="px-3 py-2 font-medium">Branch</th>
                <th className="px-3 py-2 font-medium">Last seen</th>
                <th className="px-3 py-2 font-medium text-right">Miles today</th>
                <th className="px-3 py-2 font-medium text-right">Trips</th>
                <th className="px-3 py-2 font-medium">Open flags</th>
              </tr>
            </thead>
            <tbody>
              {rollup.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-6 text-center text-sm text-muted">
                    No tracked vehicles with GPS data yet.
                    {user.role === "admin" ? " Sync the fleet from the Live Map to populate this." : ""}
                  </td>
                </tr>
              ) : (
                rollup.map((r) => (
                  <tr key={r.vehicleId ?? r.verizonNumber} className="border-b border-line last:border-0">
                    <td className="px-4 py-2">
                      {r.vehicleId ? (
                        <Link href={`/fleet/${r.vehicleId}`} className="font-medium text-brand-700 hover:underline">
                          {r.unitNumber ? `${r.unitNumber} · ` : ""}{r.name}
                        </Link>
                      ) : (
                        <span className="font-medium text-ink">{r.unitNumber ? `${r.unitNumber} · ` : ""}{r.name}</span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-muted">{r.branch ? branchLabel(r.branch) : "—"}</td>
                    <td className="px-3 py-2 text-muted">{r.lastSeen ? lastSeen(r.lastSeen) : "—"}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{r.todayMiles.toLocaleString()}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{r.trips}</td>
                    <td className="px-3 py-2">
                      {r.openAlertTypes.length === 0 ? (
                        <span className="text-xs text-muted">—</span>
                      ) : (
                        <span className="flex flex-wrap gap-1">
                          {r.openAlertTypes.map((t) => (
                            <Link key={t} href={alertsHref(t)} className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${GPS_ALERT_TYPE_META[t]?.chip ?? "bg-slate-100 text-slate-600"}`}>
                              {GPS_ALERT_TYPE_META[t]?.label ?? t}
                            </Link>
                          ))}
                        </span>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </Card>
    </>
  );
}

function BranchPill({ href, label, active }: { href: string; label: string; active: boolean }) {
  return (
    <Link
      href={href}
      className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
        active ? "bg-emerald-grad text-white shadow" : "text-muted hover:text-ink"
      }`}
    >
      {label}
    </Link>
  );
}

function Tile({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <Card className="p-4">
      <div className="text-xs uppercase tracking-wider text-muted">{label}</div>
      <div className="mt-1 text-2xl font-light tabular-nums" style={color ? { color } : undefined}>{value}</div>
    </Card>
  );
}
