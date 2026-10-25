"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { Card } from "@/components/ui";
import type { BriefingContent, Flag, RiskLevel } from "@/lib/weather/types";
import { fiveDay, riskBadgeClass, riskDotClass, riskShort, updatedAgo } from "@/lib/weather/ui";

// Manager-dashboard Weather Ops tile. A branch-locked manager sees their single
// territory (current conditions, risk, AI headline, 5-day strip, alerts). An admin
// sees a compact row across all four territories with the worst-risk rollup. Data
// comes from the scoped /api/weather, so the server decides what this user may see.

type Territory = {
  branch: string;
  label: string;
  risk: RiskLevel;
  flags: Flag[];
  current: { tempF: number | null; short: string; windMph: number | null; pop: number | null; humidity: number | null } | null;
  daily: { name: string; isDaytime: boolean; tempF: number | null; short: string; pop: number | null; icon: string | null }[];
  alerts: { event: string; headline: string }[];
  briefing: BriefingContent | null;
  updatedAt: string | null;
  stale: boolean;
};

const RISK_RANK: Record<RiskLevel, number> = { green: 0, yellow: 1, red: 2 };

export default function WeatherTile({ canSeeAll }: { canSeeAll: boolean }) {
  const [data, setData] = useState<Territory[] | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let live = true;
    const url = canSeeAll ? "/api/weather?branch=all&brief=0" : "/api/weather?brief=1";
    fetch(url)
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((j) => { if (live) setData(j.territories ?? []); })
      .catch(() => { if (live) setError(true); });
    return () => { live = false; };
  }, [canSeeAll]);

  if (error) {
    return (
      <Card className="p-4 mb-5">
        <Header />
        <p className="mt-2 text-sm text-muted">Weather is temporarily unavailable. Try the full page.</p>
        <Link href="/weather" className="mt-2 inline-block text-sm text-brand-600 hover:underline">Open Weather Ops →</Link>
      </Card>
    );
  }
  if (!data) {
    return (
      <Card className="p-4 mb-5">
        <Header />
        <div className="mt-3 h-20 animate-pulse rounded-lg bg-black/5" />
      </Card>
    );
  }

  if (canSeeAll) return <AdminRow territories={data} />;
  const t = data[0];
  if (!t) {
    return (
      <Card className="p-4 mb-5">
        <Header />
        <p className="mt-2 text-sm text-muted">No territory assigned to your account.</p>
      </Card>
    );
  }
  return <ManagerCard t={t} />;
}

function Header() {
  return (
    <div className="flex items-center justify-between">
      <div className="text-[11px] uppercase tracking-wide text-muted">Weather Ops</div>
      <Link href="/weather" className="text-xs text-brand-600 hover:underline">Full forecast →</Link>
    </div>
  );
}

function RiskBadge({ risk }: { risk: RiskLevel }) {
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium ${riskBadgeClass(risk)}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${riskDotClass(risk)}`} />
      {riskShort(risk)}
    </span>
  );
}

function ManagerCard({ t }: { t: Territory }) {
  const strip = fiveDay(t.daily);
  return (
    <Card className="p-4 mb-5">
      <div className="flex items-center justify-between">
        <div className="text-[11px] uppercase tracking-wide text-muted">Weather Ops · {t.label}</div>
        <Link href="/weather" className="text-xs text-brand-600 hover:underline">Full forecast →</Link>
      </div>

      <div className="mt-2 flex items-start justify-between gap-3">
        <div>
          <div className="flex items-baseline gap-2">
            <span className="text-3xl font-light tabular-nums">{t.current?.tempF != null ? `${t.current.tempF}°` : "—"}</span>
            <span className="text-sm text-muted">{t.current?.short ?? "No current data"}</span>
          </div>
          <div className="mt-0.5 text-xs text-muted">
            {t.current?.windMph != null ? `Wind ${t.current.windMph} mph` : ""}
            {t.current?.pop != null ? ` · ${t.current.pop}% rain` : ""}
            {t.current?.humidity != null ? ` · ${t.current.humidity}% humidity` : ""}
          </div>
        </div>
        <RiskBadge risk={t.risk} />
      </div>

      {t.briefing?.headline && (
        <p className="mt-3 rounded-lg bg-brand-50/60 px-3 py-2 text-sm font-medium text-ink">{t.briefing.headline}</p>
      )}

      {t.alerts.length > 0 && (
        <div className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800">
          <span className="font-semibold">Active alert:</span> {t.alerts[0].event}
          {t.alerts.length > 1 ? ` (+${t.alerts.length - 1} more)` : ""}
        </div>
      )}

      {strip.length > 0 && (
        <div className="mt-3 grid grid-cols-5 gap-1.5">
          {strip.map((d, i) => (
            <div key={i} className="rounded-lg border border-line px-1.5 py-2 text-center">
              <div className="truncate text-[10px] text-muted" title={d.label}>{shortLabel(d.label)}</div>
              <div className="mt-0.5 text-sm font-light tabular-nums">{d.hi != null ? `${d.hi}°` : d.lo != null ? `${d.lo}°` : "—"}</div>
              <div className="text-[10px] text-brand-600">{d.pop}%</div>
            </div>
          ))}
        </div>
      )}

      <div className="mt-3 flex items-center justify-between text-[11px] text-muted">
        <span>{t.stale ? "Stale · " : ""}Updated {updatedAgo(t.updatedAt)}</span>
        <Link href="/weather" className="text-brand-600 hover:underline">Open Weather Ops</Link>
      </div>
    </Card>
  );
}

function AdminRow({ territories }: { territories: Territory[] }) {
  const worst = territories.reduce<RiskLevel>((acc, t) => (RISK_RANK[t.risk] > RISK_RANK[acc] ? t.risk : acc), "green");
  return (
    <Card className="p-4 mb-5">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-[11px] uppercase tracking-wide text-muted">Weather Ops · all territories</span>
          <RiskBadge risk={worst} />
        </div>
        <Link href="/weather" className="text-xs text-brand-600 hover:underline">Full forecast →</Link>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
        {territories.map((t) => (
          <Link key={t.branch} href={`/weather?branch=${t.branch}`} className="rounded-lg border border-line px-3 py-2 hover:bg-black/[0.02]">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium">{t.label}</span>
              <span className={`h-2 w-2 rounded-full ${riskDotClass(t.risk)}`} />
            </div>
            <div className="mt-1 flex items-baseline gap-1">
              <span className="text-xl font-light tabular-nums">{t.current?.tempF != null ? `${t.current.tempF}°` : "—"}</span>
              <span className="truncate text-[11px] text-muted">{t.current?.short ?? ""}</span>
            </div>
            {t.alerts.length > 0 && <div className="mt-1 text-[10px] font-medium text-red-600">{t.alerts.length} alert{t.alerts.length > 1 ? "s" : ""}</div>}
          </Link>
        ))}
      </div>
    </Card>
  );
}

function shortLabel(name: string): string {
  if (/^today$/i.test(name)) return "Today";
  if (/^tonight$/i.test(name)) return "Tonight";
  const wd = name.match(/^(Sun|Mon|Tue|Wed|Thu|Fri|Sat)/i);
  return wd ? wd[0] : name.slice(0, 3);
}
