import Link from "next/link";
import { Card, PageHeader, EmptyState } from "@/components/ui";
import { requireUser, scopedBranch } from "@/lib/auth";
import { BRANCHES, branchLabel } from "@/lib/management";
import { lastSeen } from "@/lib/gps-ui";
import { listGpsAlerts, GPS_ALERT_TYPES, GPS_ALERT_TYPE_META, type GpsAlertRow } from "@/lib/gps-detect";
import GpsAlertActions from "./GpsAlertActions";

export const dynamic = "force-dynamic";

const SEV_CHIP: Record<string, string> = {
  info: "bg-slate-100 text-slate-600",
  warning: "bg-amber-100 text-amber-700",
  critical: "bg-red-100 text-red-700",
};

export default async function GpsAlertsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const user = await requireUser();
  const sp = await searchParams;
  const requested = BRANCHES.find((b) => b.key === sp.branch)?.key ?? null;
  const branch = scopedBranch(user, requested);
  const view = sp.status === "cleared" ? "cleared" : "open";
  const typeFilter = GPS_ALERT_TYPES.includes((sp.type ?? "") as (typeof GPS_ALERT_TYPES)[number]) ? sp.type : undefined;
  const canAct = user.role === "admin" || user.role === "manager";

  const alerts = await listGpsAlerts({
    status: view,
    branch: branch ?? undefined,
    type: typeFilter,
  });

  const qp = (over: Record<string, string | undefined>) => {
    const params = new URLSearchParams();
    const merged = { branch: branch ?? undefined, status: view === "cleared" ? "cleared" : undefined, type: typeFilter, ...over };
    for (const [k, v] of Object.entries(merged)) if (v) params.set(k, v);
    const qs = params.toString();
    return `/fleet/gps/alerts${qs ? `?${qs}` : ""}`;
  };

  return (
    <>
      <div className="mb-2">
        <Link href="/fleet/gps" className="text-xs font-medium text-brand-300 hover:underline">← GPS Analytics</Link>
      </div>
      <PageHeader
        title="GPS Alerts"
        subtitle="Speeding, idling, after-hours, offline, out-of-area & AI-detected patterns"
      />

      {/* Open / Cleared toggle */}
      <div className="mb-3 flex flex-wrap gap-1 rounded-xl bg-black/20 p-1 w-fit">
        <TogglePill href={qp({ status: undefined })} label="Open" active={view === "open"} />
        <TogglePill href={qp({ status: "cleared" })} label="Cleared / history" active={view === "cleared"} />
      </div>

      {/* Branch filter (admins only). */}
      {user.role === "admin" ? (
        <div className="mb-3 flex flex-wrap gap-1 rounded-xl bg-black/20 p-1 w-fit">
          <TogglePill href={qp({ branch: undefined })} label="All branches" active={branch === null} />
          {BRANCHES.map((b) => (
            <TogglePill key={b.key} href={qp({ branch: b.key })} label={b.label} active={branch === b.key} />
          ))}
        </div>
      ) : null}

      {/* Type filter */}
      <div className="mb-4 flex flex-wrap gap-1">
        <TypePill href={qp({ type: undefined })} label="All types" active={!typeFilter} />
        {GPS_ALERT_TYPES.map((t) => (
          <TypePill key={t} href={qp({ type: t })} label={GPS_ALERT_TYPE_META[t].label} active={typeFilter === t} />
        ))}
      </div>

      {alerts.length === 0 ? (
        <EmptyState
          title={view === "open" ? "No open GPS alerts" : "No cleared GPS alerts"}
          hint={
            view === "open"
              ? "Detection runs on every fleet sync and webhook delivery. Run analysis from the GPS Analytics page to check now."
              : "Acknowledged and dismissed alerts appear here."
          }
        />
      ) : (
        <ul className="space-y-3" data-testid="gps-alert-list">
          {alerts.map((a) => (
            <li key={a.id}>
              <AlertCard alert={a} canAct={canAct && view === "open"} />
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

function AlertCard({ alert, canAct }: { alert: GpsAlertRow; canAct: boolean }) {
  const typeMeta = GPS_ALERT_TYPE_META[alert.type] ?? { label: alert.type, chip: "bg-slate-100 text-slate-600" };
  return (
    <Card className="p-4" data-testid="gps-alert">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <div className="mb-1 flex flex-wrap items-center gap-1.5">
            <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${typeMeta.chip}`}>{typeMeta.label}</span>
            <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${SEV_CHIP[alert.severity] ?? SEV_CHIP.warning}`}>{alert.severity}</span>
            {alert.aiGenerated ? (
              <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-medium text-emerald-700">AI</span>
            ) : null}
            {alert.status !== "open" ? (
              <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-500">
                {alert.status === "ack" ? "Acknowledged" : "Dismissed"}
              </span>
            ) : null}
          </div>
          <div className="text-sm font-medium text-ink">{alert.title}</div>
          {alert.detail ? <div className="mt-0.5 text-sm text-muted">{alert.detail}</div> : null}
          <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-muted">
            {alert.vehicle ? (
              <Link href={`/fleet/${alert.vehicle.id}`} className="font-medium text-brand-700 hover:underline">
                {alert.vehicle.unitNumber ? `${alert.vehicle.unitNumber} · ` : ""}{alert.vehicle.name}
              </Link>
            ) : null}
            {alert.branch ? <span>{branchLabel(alert.branch)}</span> : null}
            <span>{lastSeen(alert.createdAt)}</span>
            {alert.status !== "open" && alert.acknowledgedBy ? (
              <span>· by {alert.acknowledgedBy}{alert.resolvedAt ? ` ${lastSeen(alert.resolvedAt)}` : ""}</span>
            ) : null}
          </div>
        </div>
        {canAct ? <GpsAlertActions id={alert.id} /> : null}
      </div>
    </Card>
  );
}

function TogglePill({ href, label, active }: { href: string; label: string; active: boolean }) {
  return (
    <Link
      href={href}
      className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
        active ? "bg-emerald-grad text-[#05271c] shadow" : "text-mint hover:text-white"
      }`}
    >
      {label}
    </Link>
  );
}

function TypePill({ href, label, active }: { href: string; label: string; active: boolean }) {
  return (
    <Link
      href={href}
      className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
        active ? "border-brand-600 bg-brand-50 text-brand-700" : "border-line bg-surface text-muted hover:bg-black/[0.03]"
      }`}
    >
      {label}
    </Link>
  );
}
