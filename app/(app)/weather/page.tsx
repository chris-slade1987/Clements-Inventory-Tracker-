import Link from "next/link";
import { requireUser, branchLocked } from "@/lib/auth";
import { BRANCHES } from "@/lib/management";
import { getTerritory, getAllTerritories, getScheduledStops, todayET, type TerritoryView } from "@/lib/weather/service";
import { fiveDay, hourLabel, updatedAgo } from "@/lib/weather/ui";
import type { RiskLevel } from "@/lib/weather/types";
import CommandClock from "@/components/weather/CommandClock";
import WeatherRadarMap from "@/components/weather/WeatherRadarMap";
import WeatherGlyph, { glyphFor } from "@/components/weather/WeatherGlyph";
import FiveDayOutlook from "@/components/weather/FiveDayOutlook";
import Gauge from "@/components/weather/Gauge";
import { pestPressure, pressureDomainLabel, type PressureCard } from "@/lib/weather/pests";

// Weather Ops — the intel "command deck": a dark, Palantir/ops-wall surface (HUD grid,
// bracketed panels, glowing status lamps, instrument gauges, advisory ticker) built on
// the CanopyOS palette + Helvetica Neue — no new colors or fonts. Managers land on their
// station; admins/leadership get the station board + any station's detail. See
// docs/WEATHER-OPS.md and docs/BRAND_KIT.md.
export const dynamic = "force-dynamic";

const LAMP: Record<RiskLevel, { dot: string; ring: string }> = {
  green: { dot: "#1F9D57", ring: "rgba(31,157,87,.55)" },
  yellow: { dot: "#E3B23C", ring: "rgba(227,178,60,.55)" },
  red: { dot: "#DC2626", ring: "rgba(220,38,38,.65)" },
};
const postureLabel = (r: RiskLevel) => (r === "red" ? "RED · HIGH RISK" : r === "yellow" ? "AMBER · CAUTION" : "GREEN · ALL CLEAR");
const rank = (r: RiskLevel) => (r === "red" ? 2 : r === "yellow" ? 1 : 0);
const activeFlags = (t: TerritoryView) => t.flags.filter((f) => f.code !== "FERT_BLACKOUT");

function Lamp({ risk, size = 10, live }: { risk: RiskLevel; size?: number; live?: boolean }) {
  const { dot, ring } = LAMP[risk];
  const pulse = live ?? risk !== "green";
  return <span className={`inline-block rounded-full ${pulse ? "wx-lamp-live" : ""}`} style={{ width: size, height: size, background: dot, boxShadow: `0 0 8px ${ring}`, ["--wx-ring" as string]: ring }} />;
}

/** Dark intel panel with corner brackets. */
function Panel({ code, title, right, className = "", children }: { code?: string; title: string; right?: React.ReactNode; className?: string; children: React.ReactNode }) {
  return (
    <section className={`relative rounded-xl border border-white/10 bg-white/[0.03] p-4 ${className}`}>
      <Brackets />
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-[11px] uppercase tracking-[0.18em] text-muted">
          {code && <span className="text-brand-300">{code}</span>}
          <span>{title}</span>
        </div>
        {right}
      </div>
      <div className="mt-3">{children}</div>
    </section>
  );
}
function Brackets() {
  const c = "pointer-events-none absolute h-3 w-3 border-brand-400/50";
  return (
    <>
      <span className={`${c} left-1.5 top-1.5 border-l border-t`} />
      <span className={`${c} right-1.5 top-1.5 border-r border-t`} />
      <span className={`${c} bottom-1.5 left-1.5 border-b border-l`} />
      <span className={`${c} bottom-1.5 right-1.5 border-b border-r`} />
    </>
  );
}

export default async function WeatherPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const user = await requireUser();
  const canSeeAll = !branchLocked(user) || user.seniorLeadership;
  const sp = await searchParams;
  const requested = BRANCHES.find((b) => b.key === sp.branch)?.key ?? null;

  let selected: TerritoryView | null = null;
  let all: TerritoryView[] = [];
  if (!canSeeAll) {
    if (!user.branch) {
      return (
        <Deck title="Weather Operations" subtitle="No station assigned" scope="all" updatedAt={null} stale risk="green" tickerItems={[]}>
          <Panel code="//" title="Station"><p className="text-sm text-muted">No territory is assigned to your account. Ask an admin to set your branch.</p></Panel>
        </Deck>
      );
    }
    selected = await getTerritory(user.branch, { withBriefing: true });
  } else {
    all = await getAllTerritories({ withBriefing: false });
    // Default the board to the user's assigned branch (or HQ/first branch for a no-branch
    // admin) so a station is always open — never a blank "awaiting selection".
    const effBranch = requested ?? user.branch ?? BRANCHES[0].key;
    selected = await getTerritory(effBranch, { withBriefing: true });
  }

  const worst = all.length ? all.reduce<RiskLevel>((a, t) => (rank(t.risk) > rank(a) ? t.risk : a), "green") : selected?.risk ?? "green";
  const headRisk = selected?.risk ?? worst;
  const updatedAt = selected?.updatedAt ?? all.map((t) => t.updatedAt).filter(Boolean).sort().slice(-1)[0] ?? null;
  const stale = selected ? selected.stale : all.some((t) => t.stale);
  const scope = selected?.branch ?? "all";
  const ticker = buildTicker(selected, all);
  const stops = selected ? await getScheduledStops(selected.branch) : [];

  return (
    <Deck
      title={selected ? `${selected.label} Station` : "All Stations"}
      subtitle="Canopy Command · Weather Intelligence"
      scope={scope}
      updatedAt={updatedAt}
      stale={stale}
      risk={headRisk}
      settings={canSeeAll}
      tickerItems={ticker}
      instruments={selected ? <Gauges t={selected} /> : canSeeAll ? <NetworkReadout all={all} worst={worst} /> : null}
    >
      {canSeeAll && (
        <div>
          <div className="mb-2 text-[11px] uppercase tracking-[0.18em] text-muted">Station board</div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {all.map((t) => <StationTile key={t.branch} t={t} selected={selected?.branch === t.branch} />)}
          </div>
        </div>
      )}

      {selected ? <Detail t={selected} stops={stops} /> : canSeeAll ? (
        <Panel code="//" title="Awaiting selection"><p className="text-sm text-muted">Select a station above to open its ops brief, radar scope, outlook, and timeline.</p></Panel>
      ) : null}
    </Deck>
  );
}

/** The dark ops ground: classification bar, command header, instruments, ticker. */
function Deck({
  title, subtitle, scope, updatedAt, stale, risk, settings, tickerItems, instruments, children,
}: {
  title: string; subtitle: string; scope: string; updatedAt: string | null; stale: boolean; risk: RiskLevel;
  settings?: boolean; tickerItems: string[]; instruments?: React.ReactNode; children: React.ReactNode;
}) {
  return (
    <div className="surface-dark bg-forest-grad relative overflow-hidden rounded-2xl border border-white/10 shadow-[0_20px_60px_-30px_rgba(0,0,0,.8)]">
      <div aria-hidden className="wx-grid pointer-events-none absolute inset-0 opacity-70" />
      <div className="relative">
      {/* Classification / system bar */}
      <div className="flex items-center justify-between border-b border-white/10 bg-black/20 px-4 py-1.5 text-[10px] uppercase tracking-[0.2em] text-muted">
        <span className="flex items-center gap-2"><span className="h-1.5 w-1.5 rounded-full bg-brand-400" /> Weather Ops</span>
        <span className="hidden sm:inline">Internal // Operations</span>
        <span className="flex items-center gap-1.5"><Lamp risk={risk} size={7} /> {postureLabel(risk).split(" · ")[0]}</span>
      </div>

      <div className="space-y-5 p-4 sm:p-6">
        {/* Command header */}
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="text-[11px] uppercase tracking-[0.18em] text-muted">{subtitle}</div>
            <h1 className="mt-1 text-2xl font-light tracking-tight text-ink sm:text-3xl">{title}</h1>
            <div className="mt-2 inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/5 px-3 py-1">
              <Lamp risk={risk} size={9} />
              <span className="text-[11px] uppercase tracking-[0.14em] text-ink">{postureLabel(risk)}</span>
            </div>
          </div>
          <div className="flex flex-col items-end gap-2">
            <CommandClock scope={scope} updatedAt={updatedAt} stale={stale} />
            {settings && <Link href="/weather/settings" className="text-[11px] uppercase tracking-[0.14em] text-muted hover:text-ink">Settings →</Link>}
          </div>
        </div>

        {instruments}

        {/* Advisory ticker */}
        <Ticker items={tickerItems} />

        {children}
      </div>
      </div>
    </div>
  );
}

function Ticker({ items }: { items: string[] }) {
  const line = items.length ? items : ["All stations nominal — no active advisories"];
  const run = [...line, ...line]; // duplicated for a seamless loop
  // Keep a steady, readable pace regardless of how many advisories there are: ~11s per
  // item (longer lists scroll proportionally longer, not faster). Hover pauses it.
  const durationS = Math.max(45, line.length * 11);
  return (
    <div className="wx-ticker-wrap relative overflow-hidden rounded-lg border border-white/10 bg-black/20">
      <div className="flex items-center gap-2 border-b border-white/5 px-3 py-1 text-[10px] uppercase tracking-[0.2em] text-brand-300">Advisory feed</div>
      <div className="whitespace-nowrap py-1.5">
        <div className="wx-ticker-track inline-block" style={{ animationDuration: `${durationS}s` }}>
          {run.map((s, i) => (
            <span key={i} className="mx-6 text-[12px] tracking-wide text-ink/90">
              <span className="mr-1.5 text-brand-300">▸</span>{s}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

function buildTicker(selected: TerritoryView | null, all: TerritoryView[]): string[] {
  const out: string[] = [];
  const src = selected ? [selected] : all;
  for (const t of src) {
    for (const a of t.alerts) out.push(`${t.label.toUpperCase()} — ${a.event.toUpperCase()}`);
    for (const f of activeFlags(t)) out.push(`${t.label.toUpperCase()} — ${f.label}: ${f.meaning}`);
  }
  return out;
}

function Gauges({ t }: { t: TerritoryView }) {
  const c = t.current;
  return (
    <div className="grid grid-cols-2 gap-2 rounded-xl border border-white/10 bg-white/[0.02] p-3 sm:grid-cols-4">
      <Gauge label="Temp" value={c?.tempF ?? null} max={110} unit="°F" zones={{ amber: 95, red: 103 }} />
      <Gauge label="Humidity" value={c?.humidity ?? null} max={100} unit="% RH" />
      <Gauge label="Wind" value={c?.windMph ?? null} max={30} unit="MPH" zones={{ amber: 10, red: 15 }} />
      <Gauge label="Rain" value={c?.pop ?? null} max={100} unit="% POP" zones={{ amber: 50, red: 80 }} />
    </div>
  );
}

function NetworkReadout({ all, worst }: { all: TerritoryView[]; worst: RiskLevel }) {
  const alertsTotal = all.reduce((n, t) => n + t.alerts.length, 0);
  const advTotal = all.reduce((n, t) => n + activeFlags(t).length, 0);
  const peakTemp = Math.max(...all.map((t) => t.current?.tempF ?? -999));
  const peakWind = Math.max(...all.map((t) => t.current?.windMph ?? 0));
  const items: [string, string][] = [
    ["Stations", String(all.length)],
    ["Network posture", postureLabel(worst).split(" · ")[0]],
    ["Advisories", String(advTotal)],
    ["Active alerts", String(alertsTotal)],
    ["Peak temp", peakTemp > -999 ? `${peakTemp}°` : "—"],
    ["Peak wind", `${peakWind} mph`],
  ];
  return (
    <div className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-white/10 bg-white/5 sm:grid-cols-3 lg:grid-cols-6">
      {items.map(([l, v]) => (
        <div key={l} className="bg-black/20 px-3 py-3">
          <div className="text-[10px] uppercase tracking-[0.16em] text-muted">{l}</div>
          <div className="mt-1 text-xl font-light tabular-nums text-ink">{v}</div>
        </div>
      ))}
    </div>
  );
}

function StationTile({ t, selected }: { t: TerritoryView; selected: boolean }) {
  const af = activeFlags(t);
  // Selected tile flips to a WHITE card: `surface-light` re-scopes text-ink/text-muted/
  // border-line to dark-on-light, and the brand/alert accents darken to stay readable.
  const accent = selected ? "text-brand-700" : "text-brand-300";
  const amber = selected ? "text-amber-600" : "text-amber-300";
  const red = selected ? "text-red-600" : "text-red-300";
  return (
    <Link
      href={`/weather?branch=${t.branch}`}
      className={`relative rounded-xl border p-4 transition ${
        selected
          ? "surface-light border-line bg-white shadow-[0_12px_34px_-14px_rgba(0,0,0,.55)]"
          : "border-white/10 bg-white/[0.03] hover:bg-white/[0.06]"
      }`}
    >
      {!selected && <Brackets />}
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium text-ink">{t.label}</span>
        <Lamp risk={t.risk} />
      </div>
      <div className="mt-2 flex items-baseline gap-2">
        <span className="text-3xl font-light tabular-nums text-ink">{t.current?.tempF != null ? `${t.current.tempF}°` : "—"}</span>
        <WeatherGlyph kind={glyphFor(t.current?.short ?? "")} className={`h-6 w-6 ${accent}`} />
      </div>
      <div className="mt-0.5 truncate text-xs text-muted">{t.current?.short ?? "No data"}</div>
      <div className="mt-2 grid grid-cols-3 gap-1 border-t border-line pt-2 text-center">
        <Mini label="Wind" value={t.current?.windMph != null ? `${t.current.windMph}` : "—"} />
        <Mini label="Rain" value={t.current?.pop != null ? `${t.current.pop}%` : "—"} />
        <Mini label="Hum" value={t.current?.humidity != null ? `${t.current.humidity}%` : "—"} />
      </div>
      <div className="mt-2 flex items-center justify-between text-[11px]">
        <span className={af.length ? amber : "text-muted"}>{af.length} advisor{af.length === 1 ? "y" : "ies"}</span>
        {t.alerts.length > 0 && <span className={`font-medium ${red}`}>{t.alerts.length} alert{t.alerts.length > 1 ? "s" : ""}</span>}
      </div>
      <div className="mt-2 flex items-center justify-between border-t border-line pt-2">
        <span className="flex items-center gap-1.5 text-[9px] uppercase tracking-[0.14em] text-muted">
          <Sparkline values={fiveDay(t.daily).map((d) => d.hi).filter((n): n is number => n != null)} className={`h-4 w-16 ${accent}`} />
          5-day
        </span>
        <span className="text-[10px] text-muted">{t.stale ? "stale · " : ""}upd {updatedAgo(t.updatedAt)}</span>
      </div>
    </Link>
  );
}
function Sparkline({ values, className }: { values: number[]; className?: string }) {
  if (values.length < 2) return <span className={className} />;
  const w = 64, h = 16, min = Math.min(...values), max = Math.max(...values), span = max - min || 1;
  const pts = values.map((v, i) => `${(i / (values.length - 1)) * w},${h - ((v - min) / span) * (h - 3) - 1.5}`).join(" ");
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className={className} fill="none" stroke="currentColor" strokeWidth={1.4} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <polyline points={pts} />
    </svg>
  );
}
function Mini({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-sm font-light tabular-nums text-ink">{value}</div>
      <div className="text-[9px] uppercase tracking-[0.14em] text-muted">{label}</div>
    </div>
  );
}

function Detail({ t, stops }: { t: TerritoryView; stops: { lat: number; lng: number }[] }) {
  const date = todayET();
  const strip = fiveDay(t.daily);
  const center = t.locations.find((l) => Number.isFinite(l.lat) && Number.isFinite(l.lon)) ?? null;
  const radarStation = t.locations.find((l) => l.radarStation)?.radarStation ?? null;
  const rainHours = new Set(t.flags.find((f) => f.code === "RAIN_WINDOW")?.hours ?? []);
  const thunderHours = new Set(t.flags.find((f) => f.code === "THUNDER")?.hours ?? []);
  const timeline = t.hourly.filter((h) => h.time.slice(0, 10) === date && Number(h.time.slice(11, 13)) >= 6 && Number(h.time.slice(11, 13)) <= 20);
  const nowHour = Number(new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hour: "2-digit", hourCycle: "h23" }).format(new Date()));
  const b = t.briefing;
  const af = activeFlags(t);
  const blackout = t.flags.find((f) => f.code === "FERT_BLACKOUT");

  // Pest & agronomic pressure (weather + season → likely pest/disease pressure).
  const month = Number(date.slice(5, 7));
  const todayHi = Math.max(t.current?.tempF ?? -999, ...timeline.map((h) => h.tempF ?? -999));
  const pTemp = todayHi > -900 ? todayHi : t.current?.tempF ?? null;
  const nextPops = strip.map((d) => d.pop);
  const rainFlag = t.flags.some((f) => f.code === "RAIN_WINDOW" || f.code === "HEAVY_RAIN");
  const rainActive = rainFlag || (t.current?.pop ?? 0) >= 50 || nextPops.slice(0, 3).some((p) => p >= 50);
  const dry = !rainActive && (t.current?.pop ?? 100) < 25 && nextPops.slice(0, 2).every((p) => p < 30);
  const heavyRain = t.flags.some((f) => f.code === "HEAVY_RAIN");
  const pests = pestPressure({ month, tempF: pTemp, humidity: t.current?.humidity ?? null, rainActive, dry, heavyRain });

  const elevatedPests = pests.filter((p) => p.level === "elevated");
  return (
    <div className="space-y-4">
      {/* Pest & agronomic pressure — the headline "what the weather means", up top + loud */}
      <Panel code="01" title="Pest & agronomic pressure" className={elevatedPests.length ? "ring-1 ring-amber-400/40" : ""} right={
        <span className={`rounded-full border px-2.5 py-0.5 text-[10px] uppercase tracking-[0.14em] ${elevatedPests.length ? "border-amber-400/50 bg-amber-400/15 text-amber-200" : "border-white/10 bg-white/5 text-muted"}`}>
          {elevatedPests.length} elevated
        </span>
      }>
        {pests.length === 0 ? (
          <p className="text-sm text-muted">No weather-driven pest or turf-disease pressure flagged for today. Normal service focus.</p>
        ) : (
          <>
            {elevatedPests.length > 0 && (
              <p className="mb-3 text-sm text-ink/90">
                Today&apos;s weather favors <span className="font-medium text-amber-200">{elevatedPests.map((p) => p.title).join(", ")}</span>. Steer scouting + service and set customer expectations.
              </p>
            )}
            <div className="grid grid-cols-1 gap-2.5 md:grid-cols-2">
              {pests.map((p) => <PressureRow key={p.key} p={p} />)}
            </div>
            <p className="mt-3 text-[11px] text-muted">Weather + seasonal likelihood for the Treasure Coast — scout to confirm before treating. Ask Canopy for product/treatment specifics.</p>
          </>
        )}
      </Panel>

      {/* Brief + advisories */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Panel code="02" title={`Ops brief · ${t.label}`} className="lg:col-span-2" right={<span className="text-[10px] uppercase tracking-[0.14em] text-muted">{t.briefingModel === "fallback" ? "Rules" : "Canopy AI"}</span>}>
          <h2 className="text-xl font-light tracking-tight text-ink">{b?.headline ?? "Forecast ready"}</h2>
          {b?.summary && <p className="mt-2 text-sm leading-relaxed text-ink/90">{b.summary}</p>}
          <div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-2">
            {b?.bestWorkWindow && <Info label="Best work window" value={b.bestWorkWindow} />}
            {b?.crewSafety && <Info label="Crew safety" value={b.crewSafety} />}
            {b?.byServiceLine?.lawn && <Info label="Lawn" value={b.byServiceLine.lawn} />}
            {b?.byServiceLine?.pest && <Info label="Pest" value={b.byServiceLine.pest} />}
            {b?.byServiceLine?.termite && <Info label="Termite" value={b.byServiceLine.termite} />}
            {b?.lookAhead && <Info label="Look ahead" value={b.lookAhead} />}
          </div>
        </Panel>

        <Panel code="03" title="Advisories">
          {af.length === 0 && !blackout ? (
            <p className="text-sm text-muted">No ops advisories today. Normal scheduling.</p>
          ) : (
            <ul className="space-y-2.5">
              {af.map((f) => (
                <li key={f.code} className="flex items-start gap-2.5 text-sm">
                  <span className="mt-1"><Lamp risk={f.level === "red" ? "red" : "yellow"} size={8} live={false} /></span>
                  <span><span className="font-medium text-ink">{f.label}.</span> <span className="text-muted">{f.meaning}</span>{f.hours?.length ? <span className="text-muted"> ({f.hours.map(hourLabel).join(", ")})</span> : null}</span>
                </li>
              ))}
              {blackout && (
                <li className="flex items-start gap-2.5 text-sm">
                  <span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-slate-400" />
                  <span><span className="font-medium text-ink">{blackout.label}.</span> <span className="text-muted">{blackout.meaning}</span></span>
                </li>
              )}
            </ul>
          )}
        </Panel>
      </div>

      {/* Radar scope — big, full width */}
      <Panel code="04" title={`Radar scope${radarStation ? ` · NWS ${radarStation}` : ""}`} right={<span className="text-[10px] uppercase tracking-[0.14em] text-muted">Live loop</span>}>
        {center ? (
          <WeatherRadarMap lat={center.lat} lon={center.lon} label={t.label} height={520} stops={stops} offices={t.locations.filter((l) => Number.isFinite(l.lat) && Number.isFinite(l.lon)).map((l) => ({ label: l.name, lat: l.lat, lon: l.lon }))} />
        ) : (
          <p className="text-sm text-muted">Radar loads once a forecast point is set for this station.</p>
        )}
      </Panel>

      {/* 5-day outlook — below the radar; click a day to expand its hourly detail + summary */}
      <Panel code="05" title="5-day outlook" right={<span className="text-[10px] uppercase tracking-[0.14em] text-muted">Tap a day</span>}>
        <FiveDayOutlook hourly={t.hourly} today={date} />
      </Panel>

      {/* Ops timeline */}
      {timeline.length > 0 && (
        <Panel code="06" title="Ops timeline · 6a–8p" right={
          <div className="flex items-center gap-3 text-[10px] uppercase tracking-[0.14em] text-muted">
            <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-sm bg-sky-400/50" /> rain</span>
            <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-sm bg-purple-400/50" /> thunder</span>
            <span className="inline-flex items-center gap-1"><span className="h-3 w-px bg-brand-400" /> now</span>
          </div>
        }>
          <div className="overflow-x-auto">
            <div className="flex gap-1.5" style={{ minWidth: timeline.length * 58 }}>
              {timeline.map((h) => {
                const hr = Number(h.time.slice(11, 13));
                const isThunder = thunderHours.has(h.time) || h.thunder;
                const isRain = rainHours.has(h.time);
                const isNow = hr === nowHour;
                const bg = isThunder ? "bg-purple-500/20 border-purple-400/40" : isRain ? "bg-sky-500/20 border-sky-400/40" : "border-white/10 bg-white/[0.02]";
                return (
                  <div key={h.time} className={`relative w-[52px] shrink-0 rounded-lg border px-1 py-2 text-center ${bg} ${isNow ? "ring-2 ring-brand-400" : ""}`}>
                    {isNow && <span className="wx-now absolute -top-2 left-1/2 -translate-x-1/2 rounded-full bg-brand-500 px-1 text-[8px] font-medium uppercase tracking-wide text-white">now</span>}
                    <div className="text-[10px] text-muted">{hourLabel(h.time)}</div>
                    <WeatherGlyph kind={glyphFor(h.short)} className="mx-auto my-0.5 h-4 w-4 text-brand-300" />
                    <div className="text-sm font-light tabular-nums text-ink">{h.tempF != null ? `${h.tempF}°` : "—"}</div>
                    <div className="text-[10px] text-brand-300">{h.pop}%</div>
                    <div className="text-[10px] text-muted">{h.windMph != null ? `${h.windMph}mph` : ""}</div>
                  </div>
                );
              })}
            </div>
          </div>
        </Panel>
      )}

      {/* Alerts */}
      {t.alerts.length > 0 && (
        <Panel code="07" title="Active NWS alerts" right={<span className="text-[10px] uppercase tracking-[0.14em] text-red-300">{t.alerts.length} active</span>}>
          <ul className="grid grid-cols-1 gap-3 md:grid-cols-2">
            {t.alerts.map((a, i) => (
              <li key={i} className="rounded-lg border border-red-400/40 bg-red-500/10 p-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium text-red-200">{a.event}</span>
                  <span className="text-[10px] uppercase tracking-[0.14em] text-red-300">{a.severity}</span>
                </div>
                <p className="mt-1 text-sm text-red-100">{a.headline}</p>
                {a.description && <p className="mt-1 line-clamp-4 whitespace-pre-line text-xs text-red-200/80">{a.description}</p>}
              </li>
            ))}
          </ul>
        </Panel>
      )}
    </div>
  );
}

function PressureRow({ p }: { p: PressureCard }) {
  const elevated = p.level === "elevated";
  return (
    <div className={`rounded-lg border p-3 ${elevated ? "border-amber-400/40 bg-amber-400/[0.07]" : "border-white/10 bg-white/[0.02]"}`}>
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className={`h-2 w-2 rounded-full ${elevated ? "bg-amber-400" : "bg-brand-400/70"}`} />
          <span className="text-sm font-medium text-ink">{p.title}</span>
        </div>
        <span className="rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-[9px] uppercase tracking-[0.14em] text-muted">{pressureDomainLabel(p.domain)}</span>
      </div>
      <p className="mt-1 text-xs text-muted">{p.driver}</p>
      <p className="mt-1.5 text-xs text-ink/90"><span className="text-brand-300">▸</span> {p.rec}</p>
    </div>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-white/10 bg-white/[0.02] px-3 py-2">
      <div className="text-[10px] uppercase tracking-[0.14em] text-muted">{label}</div>
      <div className="mt-0.5 text-sm text-ink/90">{value}</div>
    </div>
  );
}
