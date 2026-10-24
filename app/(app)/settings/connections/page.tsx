import { redirect } from "next/navigation";
import { requireUser, homePath } from "@/lib/auth";
import { canManageAccessRights } from "@/lib/access";
import { calendarLiveProbe } from "@/lib/google-calendar";
import { PageHeader, Card } from "@/components/ui";
import {
  getConnectionsHealth,
  summarizeHealth,
  type ConnStatus,
  type ConnectorHealth,
} from "@/lib/connections-health";
import TestEmailButton from "./TestEmailButton";

// Super-admin-only, read-only health board for every external data connector
// (Theme 8 — the integration spine). Self-guarded with canManageAccessRights
// (Chris, Julie, April), mirroring Settings & Admin → Access Rights.
export const dynamic = "force-dynamic";

// Exact brand semantic colors (docs/BRAND_KIT.md §Semantic). Status ONLY — never
// an accent. "not-configured" uses the neutral muted token.
const STATUS_COLOR: Record<ConnStatus, string> = {
  healthy: "#1F7A45", // positive
  stale: "#E3B23C", // warning
  error: "#DC2626", // danger
  "not-configured": "#5C6B62", // muted
};

function relTime(isoStr: string | null): string {
  if (!isoStr) return "never";
  const then = new Date(isoStr).getTime();
  if (!Number.isFinite(then)) return "—";
  const diff = Date.now() - then;
  if (diff < 0) return "in the future";
  const s = Math.floor(diff / 1000);
  if (s < 60) return "just now";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} min${m === 1 ? "" : "s"} ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} hour${h === 1 ? "" : "s"} ago`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d} day${d === 1 ? "" : "s"} ago`;
  const mo = Math.floor(d / 30);
  if (mo < 12) return `${mo} month${mo === 1 ? "" : "s"} ago`;
  return `${Math.floor(mo / 12)} year${Math.floor(mo / 12) === 1 ? "" : "s"} ago`;
}

function absTime(isoStr: string | null): string {
  if (!isoStr) return "—";
  const d = new Date(isoStr);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "America/New_York",
    timeZoneName: "short",
  });
}

function StatusChip({ status, label }: { status: ConnStatus; label: string }) {
  const color = STATUS_COLOR[status];
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium"
      style={{ color, backgroundColor: `${color}1A`, border: `1px solid ${color}40` }}
    >
      <span aria-hidden="true" className="h-2 w-2 rounded-full" style={{ backgroundColor: color }} />
      {label}
    </span>
  );
}

function BudgetBar({ budget }: { budget: NonNullable<ConnectorHealth["budget"]> }) {
  const frac = budget.fraction;
  const pct = frac != null ? Math.round(frac * 100) : null;
  // Color the fill by consumption so an approaching overage reads at a glance.
  const fill =
    frac == null ? "#5C6B62" : frac >= 0.9 ? "#DC2626" : frac >= 0.7 ? "#E3B23C" : "#1F7A45";
  return (
    <div className="mt-4">
      <div className="flex items-center justify-between text-xs text-muted">
        <span>{budget.label}</span>
        <span className="tabular-nums">
          {budget.used != null ? `${budget.used} / ${budget.limit} used` : `limit ${budget.limit}`}
          {budget.remaining != null ? ` · ${budget.remaining} left` : ""}
        </span>
      </div>
      <div
        className="mt-1.5 h-2 w-full overflow-hidden rounded-full bg-black/[0.06]"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={budget.limit}
        aria-valuenow={budget.used ?? undefined}
        aria-label={budget.label}
      >
        <div className="h-full rounded-full" style={{ width: `${pct ?? 0}%`, backgroundColor: fill }} />
      </div>
    </div>
  );
}

function ConnectorCard({ c }: { c: ConnectorHealth }) {
  return (
    <Card className="p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-lg font-light text-ink truncate">{c.name}</h3>
          <p className="mt-0.5 text-xs text-muted">{c.category}</p>
        </div>
        <StatusChip status={c.status} label={c.statusLabel} />
      </div>

      <dl className="mt-4 grid grid-cols-1 gap-x-4 gap-y-3 sm:grid-cols-2">
        <div>
          <dt className="text-xs text-muted">Mode</dt>
          <dd className="text-sm text-ink">{c.mode}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted">{c.lastSyncLabel}</dt>
          <dd className="text-sm text-ink">
            {relTime(c.lastSync)}
            <span className="block text-xs text-muted">{absTime(c.lastSync)}</span>
          </dd>
        </div>
      </dl>

      {c.budget ? <BudgetBar budget={c.budget} /> : null}

      {c.detail ? <p className="mt-4 text-sm text-muted">{c.detail}</p> : null}

      {c.facts.length > 0 ? (
        <div className="mt-4 border-t border-line pt-3">
          <dl className="space-y-1.5">
            {c.facts.map((f) => (
              <div key={f.label} className="flex items-baseline justify-between gap-3 text-xs">
                <dt className="text-muted">{f.label}</dt>
                <dd className="text-ink text-right tabular-nums">{f.value}</dd>
              </div>
            ))}
          </dl>
        </div>
      ) : null}

      {c.envKeys.length > 0 ? (
        <div className="mt-4 flex flex-wrap items-center gap-1.5">
          <span className="text-xs text-muted">Gated by</span>
          {c.envKeys.map((k) => (
            <code key={k} className="rounded bg-black/[0.05] px-1.5 py-0.5 text-[11px] text-ink">
              {k}
            </code>
          ))}
        </div>
      ) : null}

      {c.key === "email" ? <TestEmailButton configured={c.live} /> : null}
    </Card>
  );
}

export default async function ConnectionsPage() {
  const user = await requireUser();
  if (!canManageAccessRights(user)) redirect(homePath(user));

  const connectors = await getConnectionsHealth();

  // Google Calendar: when the key parses, do a LIVE probe (impersonating the viewing
  // super admin) so the tile reflects whether Google actually honors the service
  // account — this is where a missing domain-wide-delegation grant shows up, which a
  // credential-only check can't catch. Overrides the calendar connector in place.
  const calIdx = connectors.findIndex((c) => c.key === "google-calendar");
  if (calIdx >= 0 && connectors[calIdx].live && user.email) {
    const probe = await calendarLiveProbe(user.email);
    const base = connectors[calIdx];
    connectors[calIdx] = probe.ok
      ? {
          ...base,
          status: "healthy",
          statusLabel: "Healthy",
          detail:
            "Service account connected and a live free/busy call to Google succeeded. Suggested Times and calendar invites will work.",
          facts: [{ label: "Live check", value: "Passed" }, ...base.facts.slice(1)],
        }
      : {
          ...base,
          status: "error",
          statusLabel: "Error",
          detail: `The key is valid, but the live Google call FAILED: ${probe.error}`,
          facts: [{ label: "Live check", value: "Failed — see detail" }, ...base.facts.slice(1)],
        };
  }

  const summary = summarizeHealth(connectors);

  const summaryTiles: { status: ConnStatus; label: string; count: number }[] = [
    { status: "healthy", label: "Healthy", count: summary.healthy },
    { status: "stale", label: "Stale", count: summary.stale },
    { status: "error", label: "Error", count: summary.error },
    { status: "not-configured", label: "Not configured", count: summary["not-configured"] },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Data Connections"
        subtitle="Read-only health of every system Canopy connects — freshness, mode, and budget. This board observes; it never syncs or changes an external system."
      />

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {summaryTiles.map((t) => (
          <Card key={t.status} className="p-4">
            <div className="flex items-center gap-2">
              <span
                aria-hidden="true"
                className="h-2.5 w-2.5 rounded-full"
                style={{ backgroundColor: STATUS_COLOR[t.status] }}
              />
              <span className="text-xs text-muted">{t.label}</span>
            </div>
            <div className="mt-2 text-2xl font-light text-ink tabular-nums">{t.count}</div>
          </Card>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {connectors.map((c) => (
          <ConnectorCard key={c.key} c={c} />
        ))}
      </div>

      <p className="text-xs text-muted">
        Health is derived from stored sync timestamps, webhook rows, and quota headers already captured by Canopy. The one
        exception is Google Workspace Calendar, which runs a quick live free/busy check on load so a delegation problem shows up
        here. Only the names of the environment variables that gate each connector are shown, never any secret value.
      </p>
    </div>
  );
}
