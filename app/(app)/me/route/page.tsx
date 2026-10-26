import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { Card, PageHeader, EmptyState } from "@/components/ui";
import { Gauge } from "@/components/motivation";
import { getTechRouteView } from "@/lib/branch-production-ingest";

// Technician route/tech home — a field tech's own route completion, production and the
// accounts they still owe this month. Mobile-first (techs are on phones). Matched to the
// loaded production data by name; a friendly empty state shows when no route is linked.
export const dynamic = "force-dynamic";

const money = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;
function monthLabel(pk: string): string {
  const [y, m] = pk.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
}

export default async function MyRoutePage() {
  const user = await requireUser();
  const view = await getTechRouteView(user.name);

  if (!view) {
    return (
      <div className="space-y-5">
        <PageHeader title="Your route" subtitle={user.name?.split(" ")[0] ? `Hi, ${user.name.split(" ")[0]}` : undefined} />
        <EmptyState
          title="No route linked yet"
          hint="We couldn't match your login to a route in this month's loaded reports. Ask your branch manager to link your route — then your stops, completion and accounts to catch up will show here."
        />
        <Link href="/me" className="inline-block text-sm font-medium text-brand-700 hover:underline">Go to the Employee Hub →</Link>
      </div>
    );
  }

  const caughtUp = view.leftBehind.length === 0;

  return (
    <div className="space-y-5">
      <PageHeader
        title="Your route"
        subtitle={`Route ${view.route} · ${monthLabel(view.periodKey)}`}
      />

      {/* Completion hero */}
      <Card className="p-5">
        <div className="flex flex-col items-center gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-4">
            <Gauge value={view.completionPct} target={100} size={132} label="Completion" />
            <div>
              <div className="text-3xl font-light tabular-nums text-ink">{view.completedCount}<span className="text-lg text-muted">/{view.scheduledCount}</span></div>
              <div className="text-xs text-muted">stops completed</div>
              <div className="mt-2 text-sm text-ink">{money(view.completedDollars)} <span className="text-xs text-muted">of {money(view.scheduledDollars)} scheduled</span></div>
            </div>
          </div>
          <div className="grid grid-cols-3 gap-3 text-center sm:gap-5">
            <Stat label="Remaining" value={String(view.remainingCount)} />
            <Stat label="Callbacks" value={String(view.callbacks)} tone={view.callbacks > 0 ? "warn" : "good"} />
            <Stat label="Projected" value={`${view.projectedPct}%`} />
          </div>
        </div>
      </Card>

      {/* Accounts to catch up — the tech's own left-behind list */}
      <Card className="p-0 overflow-hidden">
        <div className="flex items-center justify-between border-b border-line px-4 py-3">
          <div className="text-sm font-medium text-ink">Accounts to catch up</div>
          <span className={`text-xs font-medium ${view.leftBehindCount > 0 ? "text-red-600" : "text-brand-600"}`}>
            {view.leftBehindCount} {view.leftBehindCount === 1 ? "account" : "accounts"}{view.leftBehindCount > 0 ? ` · ${money(view.leftBehindDollars)}` : ""}
          </span>
        </div>
        {caughtUp ? (
          <p className="px-4 py-8 text-center text-sm text-muted">You&rsquo;re all caught up — nothing left behind this month. Nice work.</p>
        ) : (
          <ul className="divide-y divide-line">
            {view.leftBehind.map((j) => (
              <li key={j.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3">
                <span className="text-sm font-medium text-ink">{j.customer ?? `Acct ${j.account}`}</span>
                <span className="text-xs text-muted">{j.service ?? "service"}</span>
                {j.scheduledDate ? <span className="text-xs text-muted">· was due {j.scheduledDate}</span> : null}
                <span className="ml-auto text-sm tabular-nums text-ink">{money(j.dollars)}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Link href="/me" className="inline-block text-sm font-medium text-brand-700 hover:underline">Go to the Employee Hub →</Link>
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: "good" | "warn" }) {
  const c = tone === "warn" ? "text-amber-600" : "text-ink";
  return (
    <div>
      <div className={`text-xl font-light tabular-nums ${c}`}>{value}</div>
      <div className="text-[11px] uppercase tracking-wide text-muted">{label}</div>
    </div>
  );
}
