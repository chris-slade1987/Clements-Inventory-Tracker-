import Link from "next/link";
import { Card, PageHeader } from "@/components/ui";
import { requireUser, branchLocked } from "@/lib/auth";
import { BRANCHES } from "@/lib/management";
import { getTerritory, getAllTerritories, todayET, type TerritoryView } from "@/lib/weather/service";
import { fiveDay, hourLabel, riskBadgeClass, riskDotClass, riskLabel, updatedAgo } from "@/lib/weather/ui";
import type { RiskLevel } from "@/lib/weather/types";
import RefreshButton from "@/components/weather/RefreshButton";
import WeatherRadarMap from "@/components/weather/WeatherRadarMap";

// Weather Ops — the full forecast page. Managers land directly on their territory;
// admins/leadership get an all-territories grid and can open any one. Server-rendered
// (refresh-on-read runs in the service). See docs/WEATHER-OPS.md.
export const dynamic = "force-dynamic";

export default async function WeatherPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const user = await requireUser();
  const canSeeAll = !branchLocked(user) || user.seniorLeadership;
  const sp = await searchParams;
  const requested = BRANCHES.find((b) => b.key === sp.branch)?.key ?? null;

  if (!canSeeAll) {
    if (!user.branch) {
      return (
        <>
          <PageHeader title="Weather Ops" subtitle="What the forecast means for routing & service completion" />
          <Card className="p-6 text-sm text-muted">No territory is assigned to your account. Ask an admin to set your branch.</Card>
        </>
      );
    }
    const t = await getTerritory(user.branch, { withBriefing: true });
    return (
      <>
        <PageHeader title="Weather Ops" subtitle={`${t.label} · ${t.current?.short ?? "forecast"}`} actions={<RefreshButton scope={user.branch} />} />
        <TerritoryDetail t={t} />
      </>
    );
  }

  // Admin / leadership — grid of all territories, plus a selected detail.
  const all = await getAllTerritories({ withBriefing: false });
  const selected = requested ? await getTerritory(requested, { withBriefing: true }) : null;
  const worst = all.reduce<RiskLevel>((acc, t) => (rank(t.risk) > rank(acc) ? t.risk : acc), "green");

  return (
    <>
      <PageHeader
        title="Weather Ops"
        subtitle={`All territories · worst risk today: ${riskLabel(worst)}`}
        actions={
          <div className="flex items-center gap-3">
            <RefreshButton scope={requested ?? "all"} />
            <Link href="/weather/settings" className="text-sm text-brand-600 hover:underline">Settings</Link>
          </div>
        }
      />

      <div className="mb-5 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {all.map((t) => (
          <Link
            key={t.branch}
            href={`/weather?branch=${t.branch}`}
            className={`rounded-xl border p-4 transition hover:shadow-sm ${requested === t.branch ? "border-brand-400 bg-brand-50/40" : "border-line bg-surface"}`}
          >
            <div className="flex items-center justify-between">
              <span className="font-medium">{t.label}</span>
              <RiskBadge risk={t.risk} />
            </div>
            <div className="mt-2 flex items-baseline gap-2">
              <span className="text-2xl font-light tabular-nums">{t.current?.tempF != null ? `${t.current.tempF}°` : "—"}</span>
              <span className="truncate text-xs text-muted">{t.current?.short ?? "No data"}</span>
            </div>
            <div className="mt-1 text-[11px] text-muted">
              {t.flags.filter((f) => f.code !== "FERT_BLACKOUT").length} flag(s) · updated {updatedAgo(t.updatedAt)}
            </div>
            {t.alerts.length > 0 && <div className="mt-1 text-[11px] font-medium text-red-600">{t.alerts.length} active alert{t.alerts.length > 1 ? "s" : ""}</div>}
          </Link>
        ))}
      </div>

      {selected ? (
        <TerritoryDetail t={selected} />
      ) : (
        <Card className="p-6 text-sm text-muted">Select a territory above to open its hourly timeline, briefing, radar, and alerts.</Card>
      )}
    </>
  );
}

function rank(r: RiskLevel): number {
  return r === "red" ? 2 : r === "yellow" ? 1 : 0;
}

function RiskBadge({ risk }: { risk: RiskLevel }) {
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium ${riskBadgeClass(risk)}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${riskDotClass(risk)}`} />
      {riskLabel(risk)}
    </span>
  );
}

function TerritoryDetail({ t }: { t: TerritoryView }) {
  const date = todayET();
  const strip = fiveDay(t.daily);
  const radarStation = t.locations.find((l) => l.radarStation)?.radarStation ?? null;
  const center = t.locations.find((l) => Number.isFinite(l.lat) && Number.isFinite(l.lon)) ?? null;

  // Flagged-hour sets for timeline shading.
  const rainHours = new Set(t.flags.find((f) => f.code === "RAIN_WINDOW")?.hours ?? []);
  const thunderHours = new Set(t.flags.find((f) => f.code === "THUNDER")?.hours ?? []);
  const timeline = t.hourly.filter((h) => h.time.slice(0, 10) === date && Number(h.time.slice(11, 13)) >= 6 && Number(h.time.slice(11, 13)) <= 20);

  const b = t.briefing;
  const activeFlags = t.flags.filter((f) => f.code !== "FERT_BLACKOUT");
  const blackout = t.flags.find((f) => f.code === "FERT_BLACKOUT");

  return (
    <div className="space-y-5">
      {/* AI briefing */}
      <Card className="p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <div className="text-[11px] uppercase tracking-wide text-muted">Ops briefing · {t.label}</div>
            <h2 className="mt-0.5 text-lg font-light text-ink">{b?.headline ?? "Forecast"}</h2>
          </div>
          <RiskBadge risk={t.risk} />
        </div>
        {b?.summary && <p className="mt-2 text-sm text-ink">{b.summary}</p>}
        <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
          {b?.bestWorkWindow && (
            <Info label="Best work window" value={b.bestWorkWindow} />
          )}
          {b?.crewSafety && <Info label="Crew safety" value={b.crewSafety} />}
          {b?.byServiceLine?.lawn && <Info label="Lawn" value={b.byServiceLine.lawn} />}
          {b?.byServiceLine?.pest && <Info label="Pest" value={b.byServiceLine.pest} />}
          {b?.byServiceLine?.termite && <Info label="Termite" value={b.byServiceLine.termite} />}
          {b?.lookAhead && <Info label="Look ahead" value={b.lookAhead} />}
        </div>
        <div className="mt-3 text-[11px] text-muted">
          {t.stale ? "Stale data · " : ""}Updated {updatedAgo(t.updatedAt)}
          {t.briefingModel ? ` · briefing: ${t.briefingModel === "fallback" ? "rules fallback" : "Canopy AI"}` : ""}
        </div>
      </Card>

      {/* Flags */}
      {(activeFlags.length > 0 || blackout) && (
        <Card className="p-5">
          <div className="text-[11px] uppercase tracking-wide text-muted">Today&apos;s ops flags</div>
          <ul className="mt-2 space-y-2">
            {activeFlags.map((f) => (
              <li key={f.code} className="flex items-start gap-2 text-sm">
                <span className={`mt-1 h-2 w-2 shrink-0 rounded-full ${f.level === "red" ? "bg-red-500" : "bg-amber-500"}`} />
                <span><span className="font-medium">{f.label}.</span> <span className="text-muted">{f.meaning}</span>{f.hours?.length ? <span className="text-muted"> ({f.hours.map((h) => hourLabel(h)).join(", ")})</span> : null}</span>
              </li>
            ))}
            {blackout && (
              <li className="flex items-start gap-2 text-sm">
                <span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-slate-400" />
                <span><span className="font-medium">{blackout.label}.</span> <span className="text-muted">{blackout.meaning}</span></span>
              </li>
            )}
          </ul>
        </Card>
      )}

      {/* Hourly timeline 6am–8pm, flagged hours shaded */}
      {timeline.length > 0 && (
        <Card className="p-5">
          <div className="flex items-center justify-between">
            <div className="text-[11px] uppercase tracking-wide text-muted">Today · 6am–8pm</div>
            <div className="flex items-center gap-3 text-[10px] text-muted">
              <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-sm bg-sky-200" /> rain</span>
              <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-sm bg-purple-200" /> thunder</span>
            </div>
          </div>
          <div className="mt-3 overflow-x-auto">
            <div className="flex gap-1.5" style={{ minWidth: timeline.length * 56 }}>
              {timeline.map((h) => {
                const isThunder = thunderHours.has(h.time) || h.thunder;
                const isRain = rainHours.has(h.time);
                const bg = isThunder ? "bg-purple-100 border-purple-200" : isRain ? "bg-sky-100 border-sky-200" : "border-line";
                return (
                  <div key={h.time} className={`w-14 shrink-0 rounded-lg border px-1 py-2 text-center ${bg}`}>
                    <div className="text-[10px] text-muted">{hourLabel(h.time)}</div>
                    <div className="mt-0.5 text-sm font-light tabular-nums">{h.tempF != null ? `${h.tempF}°` : "—"}</div>
                    <div className="text-[10px] text-brand-600">{h.pop}%</div>
                    <div className="text-[10px] text-muted">{h.windMph != null ? `${h.windMph}mph` : ""}</div>
                  </div>
                );
              })}
            </div>
          </div>
        </Card>
      )}

      {/* 5-day */}
      {strip.length > 0 && (
        <Card className="p-5">
          <div className="text-[11px] uppercase tracking-wide text-muted">5-day outlook</div>
          <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-5">
            {strip.map((d, i) => (
              <div key={i} className="rounded-xl border border-line p-3 text-center">
                <div className="truncate text-xs font-medium" title={d.label}>{d.label}</div>
                {d.icon && <img src={d.icon} alt="" className="mx-auto mt-1 h-10 w-10 rounded" />}
                <div className="mt-1 text-sm tabular-nums">
                  <span className="font-medium">{d.hi != null ? `${d.hi}°` : "—"}</span>
                  {d.lo != null && <span className="text-muted"> / {d.lo}°</span>}
                </div>
                <div className="text-[11px] text-brand-600">{d.pop}% rain</div>
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* Alerts */}
      {t.alerts.length > 0 && (
        <Card className="p-5">
          <div className="text-[11px] uppercase tracking-wide text-red-600">Active alerts</div>
          <ul className="mt-2 space-y-3">
            {t.alerts.map((a, i) => (
              <li key={i} className="rounded-lg border border-red-200 bg-red-50 p-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium text-red-800">{a.event}</span>
                  <span className="text-[11px] uppercase text-red-600">{a.severity}</span>
                </div>
                <p className="mt-1 text-sm text-red-900">{a.headline}</p>
                {a.description && <p className="mt-1 whitespace-pre-line text-xs text-red-800/90">{a.description}</p>}
              </li>
            ))}
          </ul>
        </Card>
      )}

      {/* Radar — OSM roads basemap + animated RainViewer overlay */}
      <Card className="p-5">
        <div className="flex items-center justify-between">
          <div className="text-[11px] uppercase tracking-wide text-muted">Radar{radarStation ? ` · NWS ${radarStation}` : ""}</div>
          <span className="text-[11px] text-muted">Live radar loop</span>
        </div>
        {center ? (
          <WeatherRadarMap lat={center.lat} lon={center.lon} label={t.label} />
        ) : (
          <p className="mt-2 text-sm text-muted">Radar loads once a forecast point is set for this territory.</p>
        )}
      </Card>
    </div>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-line px-3 py-2">
      <div className="text-[10px] uppercase tracking-wide text-muted">{label}</div>
      <div className="mt-0.5 text-sm text-ink">{value}</div>
    </div>
  );
}
