import Link from "next/link";
import { Card, PageHeader } from "@/components/ui";
import { requireUser, scopedBranch } from "@/lib/auth";
import { BRANCHES, branchLabel } from "@/lib/management";
import { latestPositions, fleetLiveSummary } from "@/lib/gps";
import { STATUS_META, lastSeen, vehicleTitle, type GpsStatus } from "@/lib/gps-ui";
import FleetMap from "@/components/gps/FleetMap";
import GpsRefreshButton from "./GpsRefreshButton";

export const dynamic = "force-dynamic";

export default async function FleetMapPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const user = await requireUser();
  const sp = await searchParams;
  const requested = BRANCHES.find((b) => b.key === sp.branch)?.key ?? null;
  const branch = scopedBranch(user, requested);

  const [positions, summary] = await Promise.all([
    latestPositions(branch ?? undefined),
    fleetLiveSummary(branch ?? undefined),
  ]);

  const markers = positions.map((p) => ({
    id: p.vehicleId,
    lat: p.lat,
    lng: p.lng,
    // Truck labeled by year/make/model, with the unit number as a prefix.
    label: p.linked ? `${p.unitNumber ? `#${p.unitNumber} · ` : ""}${vehicleTitle(p)}` : p.name,
    color: STATUS_META[p.status].color,
    lines: [
      ...(p.linked ? [`Driver: ${p.driver?.trim() || "Unassigned"}`] : []),
      `${STATUS_META[p.status].label}${p.speed != null ? ` · ${Math.round(p.speed)} mph` : ""}`,
      `Ignition: ${p.ignition == null ? "—" : p.ignition ? "On" : "Off"}`,
      `Seen ${lastSeen(p.ts)}`,
      ...(p.address ? [p.address] : []),
      ...(p.linked ? [] : ["Not matched to a fleet vehicle"]),
    ],
    href: p.linked ? `/fleet/${p.vehicleId}` : undefined,
  }));

  return (
    <>
      <div className="mb-2">
        <Link href="/fleet" className="text-xs font-medium text-brand-700 hover:underline">← Fleet</Link>
      </div>
      <PageHeader
        title="Live Map"
        subtitle="Near-real-time vehicle locations from Verizon Connect Reveal"
        actions={user.role === "admin" ? <GpsRefreshButton /> : undefined}
      />

      {summary.sample ? (
        <Card className="mb-4 border-amber-200 bg-amber-50 p-3 text-sm text-amber-800" data-testid="sample-banner">
          <span className="font-medium">Sample data</span> — connect Verizon Connect Reveal (set the
          <code className="mx-1 rounded bg-amber-100 px-1">VERIZON_*</code> environment variables) to go live.
          These positions are simulated so the map and panels can be demoed.
        </Card>
      ) : null}

      {summary.lastSyncOk === false ? (
        <Card className="mb-4 border-red-200 bg-red-50 p-3 text-sm text-red-700" data-testid="sync-error">
          Last sync failed{summary.lastSyncError ? `: ${summary.lastSyncError}` : "."} The positions below may be stale.
        </Card>
      ) : null}

      {/* Branch filter (admins / exec only — branch managers are pinned) */}
      {user.role === "admin" ? (
        <div className="mb-4 flex flex-wrap gap-1 rounded-xl bg-black/20 p-1 w-fit">
          <BranchPill href="/fleet/map" label="All branches" active={branch === null} />
          {BRANCHES.map((b) => (
            <BranchPill key={b.key} href={`/fleet/map?branch=${b.key}`} label={b.label} active={branch === b.key} />
          ))}
        </div>
      ) : null}

      <div className="grid gap-3 grid-cols-2 lg:grid-cols-5 mb-4">
        <Stat label="Tracked" value={String(summary.linked)} />
        <Stat label="Moving" value={String(summary.moving)} tone="moving" />
        <Stat label="Idling" value={String(summary.idle)} tone="idle" />
        <Stat label="Stopped" value={String(summary.stopped)} tone="stopped" />
        <Stat label="Offline" value={String(summary.offline)} tone="offline" />
      </div>

      {/* The base map ALWAYS renders (centered on Florida by default), even with
          zero positions — the empty hint is shown as an overlay rather than
          replacing the map, so a manager always sees a map. */}
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2 relative" data-testid="fleet-map">
          <FleetMap markers={markers} height={960} />
          {positions.length === 0 ? (
            <div className="pointer-events-none absolute inset-0 z-[500] flex items-start justify-center p-4">
              <div className="pointer-events-auto max-w-sm rounded-xl border border-line bg-white/95 p-4 text-center shadow-lg backdrop-blur" data-testid="map-empty-hint">
                <div className="text-sm font-medium text-ink">No vehicle locations yet</div>
                <div className="mt-1 text-xs text-muted">
                  {user.role === "admin"
                    ? "Press Refresh to sync. Without Verizon credentials, a sample set is generated so you can preview the map."
                    : "Locations appear once an admin syncs the fleet."}
                </div>
              </div>
            </div>
          ) : null}
        </div>

        {positions.length > 0 ? (
          <Card className="p-0 overflow-hidden" data-testid="vehicle-list">
            <div className="px-4 py-3 border-b border-line text-sm font-medium text-ink">
              Vehicles ({positions.length})
            </div>
            <ul className="divide-y divide-line max-h-[920px] overflow-y-auto">
              {positions.map((p) => {
                const meta = STATUS_META[p.status];
                const inner = (
                  <>
                    <span className="mt-0.5 inline-block h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: meta.color }} />
                    <span className="flex-1 min-w-0">
                      <span className="block truncate text-sm font-medium text-ink">
                        {p.unitNumber ? `#${p.unitNumber} · ` : ""}{p.linked ? vehicleTitle(p) : p.name}
                      </span>
                      {p.linked ? (
                        <span className="block truncate text-xs text-ink/70">
                          {(p.driver?.trim() || "Unassigned")}
                        </span>
                      ) : null}
                      <span className="block truncate text-xs text-muted">
                        {branchLabel(p.branch ?? "")}{p.branch ? " · " : ""}{p.address ?? "—"}
                      </span>
                      <span className="mt-1 flex flex-wrap items-center gap-1.5">
                        <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${meta.chip}`}>{meta.label}</span>
                        {p.speed != null ? <span className="text-[11px] text-muted tabular-nums">{Math.round(p.speed)} mph</span> : null}
                        <span className="text-[11px] text-muted">· {lastSeen(p.ts)}</span>
                      </span>
                    </span>
                  </>
                );
                return (
                  <li key={p.vehicleId}>
                    {p.linked ? (
                      <Link href={`/fleet/${p.vehicleId}`} className="flex items-start gap-3 px-4 py-3 hover:bg-black/[0.02]">{inner}</Link>
                    ) : (
                      <div className="flex items-start gap-3 px-4 py-3" title="Live plot not matched to a fleet vehicle">{inner}</div>
                    )}
                  </li>
                );
              })}
            </ul>
          </Card>
        ) : null}
      </div>

      <p className="mt-4 text-xs text-muted">
        Near-real-time: positions come from each vehicle&apos;s latest status-history entry (Reveal has no live
        &ldquo;current position&rdquo; endpoint). Alerts arrive via the webhook receiver.
      </p>
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

function Stat({ label, value, tone }: { label: string; value: string; tone?: GpsStatus }) {
  const color = tone ? STATUS_META[tone].color : undefined;
  return (
    <Card className="p-4">
      <div className="text-xs uppercase tracking-wider text-muted">{label}</div>
      <div className="mt-1 text-2xl font-light tabular-nums" style={color ? { color } : undefined}>{value}</div>
    </Card>
  );
}
