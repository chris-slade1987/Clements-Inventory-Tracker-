import Link from "next/link";
import { Card } from "@/components/ui";
import { requireUser, branchLocked } from "@/lib/auth";
import { BRANCHES } from "@/lib/management";
import { getTerritory, getAllTerritories, todayET, type TerritoryView } from "@/lib/weather/service";
import { fiveDay, hourLabel } from "@/lib/weather/ui";
import type { Flag, RiskLevel } from "@/lib/weather/types";
import CommandClock from "@/components/weather/CommandClock";
import WeatherRadarMap from "@/components/weather/WeatherRadarMap";

// Weather Ops — the "command deck": an airline/NWS-style operations console built on
// the CanopyOS brand (forest-green command band = chrome; light instrument panels =
// content). Managers land on their station; admins/leadership get the station board +
// any station's detail. Server-rendered; the clock + auto-sync are client. See
// docs/WEATHER-OPS.md and docs/BRAND_KIT.md.
export const dynamic = "force-dynamic";

const LAMP: Record<RiskLevel, { dot: string; ring: string }> = {
  green: { dot: "#1F9D57", ring: "rgba(31,157,87,.55)" },
  yellow: { dot: "#E3B23C", ring: "rgba(227,178,60,.55)" },
  red: { dot: "#DC2626", ring: "rgba(220,38,38,.6)" },
};
function postureLabel(r: RiskLevel): string {
  return r === "red" ? "RED · HIGH RISK" : r === "yellow" ? "AMBER · CAUTION" : "GREEN · ALL CLEAR";
}
function rank(r: RiskLevel): number {
  return r === "red" ? 2 : r === "yellow" ? 1 : 0;
}
function activeFlags(t: TerritoryView): Flag[] {
  return t.flags.filter((f) => f.code !== "FERT_BLACKOUT");
}

/** A status lamp; red/amber pulse slowly (reduced-motion safe via CSS). */
function Lamp({ risk, size = 10, live }: { risk: RiskLevel; size?: number; live?: boolean }) {
  const { dot, ring } = LAMP[risk];
  const pulse = live ?? risk !== "green";
  return (
    <span
      className={`inline-block rounded-full ${pulse ? "wx-lamp-live" : ""}`}
      style={{ width: size, height: size, background: dot, ["--wx-ring" as string]: ring }}
    />
  );
}

/** A labeled instrument readout (uppercase label + big tabular value). */
function Readout({ label, value, unit }: { label: string; value: string; unit?: string }) {
  return (
    <div className="min-w-[72px]">
      <div className="text-[10px] uppercase tracking-[0.18em] text-muted">{label}</div>
      <div className="mt-1 text-xl font-light tabular-nums leading-none text-ink">
        {value}
        {unit ? <span className="ml-0.5 text-xs text-muted">{unit}</span> : null}
      </div>
    </div>
  );
}

export default async function WeatherPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const user = await requireUser();
  const canSeeAll = !branchLocked(user) || user.seniorLeadership;
  const sp = await searchParams;
  const requested = BRANCHES.find((b) => b.key === sp.branch)?.key ?? null;

  // ---- Manager (single station) ----
  if (!canSeeAll) {
    if (!user.branch) {
      return (
        <CommandBand title="Weather Operations" subtitle="No station assigned" scope="all" updatedAt={null} stale risk="green">
          <div className="mt-4"><Card className="p-6 text-sm text-muted">No territory is assigned to your account. Ask an admin to set your branch.</Card></div>
        </CommandBand>
      );
    }
    const t = await getTerritory(user.branch, { withBriefing: true });
    return (
      <>
        <CommandBand title={`${t.label} Station`} subtitle="Weather Operations · Command Deck" scope={t.branch} updatedAt={t.updatedAt} stale={t.stale} risk={t.risk}>
          <InstrumentStrip t={t} />
        </CommandBand>
        <div className="mt-5"><TerritoryDetail t={t} /></div>
      </>
    );
  }

  // ---- Admin / leadership (station board + detail) ----
  const all = await getAllTerritories({ withBriefing: false });
  const selected = requested ? await getTerritory(requested, { withBriefing: true }) : null;
  const worst = all.reduce<RiskLevel>((acc, t) => (rank(t.risk) > rank(acc) ? t.risk : acc), "green");
  const alertsTotal = all.reduce((n, t) => n + t.alerts.length, 0);
  const peakTemp = Math.max(...all.map((t) => t.current?.tempF ?? -999));
  const peakWind = Math.max(...all.map((t) => t.current?.windMph ?? 0));

  return (
    <>
      <CommandBand
        title={selected ? `${selected.label} Station` : "All Stations"}
        subtitle="Weather Operations · Command Deck"
        scope={selected?.branch ?? "all"}
        updatedAt={selected?.updatedAt ?? all.map((t) => t.updatedAt).filter(Boolean).sort().slice(-1)[0] ?? null}
        stale={selected ? selected.stale : all.some((t) => t.stale)}
        risk={selected?.risk ?? worst}
        settings
      >
        {selected ? (
          <InstrumentStrip t={selected} />
        ) : (
          <div className="mt-4 flex flex-wrap gap-x-7 gap-y-3">
            <Readout label="Stations" value={String(all.length)} />
            <Readout label="Posture" value={postureLabel(worst).split(" · ")[0]} />
            <Readout label="Active alerts" value={String(alertsTotal)} />
            <Readout label="Peak temp" value={peakTemp > -999 ? `${peakTemp}` : "—"} unit="°F" />
            <Readout label="Peak wind" value={`${peakWind}`} unit="mph" />
          </div>
        )}
      </CommandBand>

      {/* Station board */}
      <div className="mt-5">
        <SectionLabel>Station board</SectionLabel>
        <div className="mt-2 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {all.map((t) => {
            const af = activeFlags(t);
            const isSel = requested === t.branch;
            return (
              <Link
                key={t.branch}
                href={`/weather?branch=${t.branch}`}
                className={`group rounded-xl border bg-card-grad p-4 transition hover:shadow-md ${isSel ? "border-brand-500 ring-1 ring-brand-500" : "border-line"}`}
              >
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium text-ink">{t.label}</span>
                  <Lamp risk={t.risk} />
                </div>
                <div className="mt-2 flex items-baseline gap-2">
                  <span className="text-3xl font-light tabular-nums text-ink">{t.current?.tempF != null ? `${t.current.tempF}°` : "—"}</span>
                  <span className="truncate text-xs text-muted">{t.current?.short ?? "No data"}</span>
                </div>
                <div className="mt-2 grid grid-cols-3 gap-1 border-t border-line pt-2 text-center">
                  <MiniStat label="Wind" value={t.current?.windMph != null ? `${t.current.windMph}` : "—"} />
                  <MiniStat label="Rain" value={t.current?.pop != null ? `${t.current.pop}%` : "—"} />
                  <MiniStat label="Hum" value={t.current?.humidity != null ? `${t.current.humidity}%` : "—"} />
                </div>
                <div className="mt-2 flex items-center justify-between text-[11px]">
                  <span className={af.length ? "font-medium text-amber-700" : "text-muted"}>{af.length} advisor{af.length === 1 ? "y" : "ies"}</span>
                  {t.alerts.length > 0 && <span className="font-medium text-red-600">{t.alerts.length} alert{t.alerts.length > 1 ? "s" : ""}</span>}
                </div>
              </Link>
            );
          })}
        </div>
      </div>

      {selected ? (
        <div className="mt-5"><TerritoryDetail t={selected} /></div>
      ) : (
        <Card className="mt-5 p-6 text-sm text-muted">Select a station above to open its ops brief, radar scope, hourly timeline, and advisories.</Card>
      )}
    </>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return <div className="text-[11px] uppercase tracking-[0.18em] text-muted">{children}</div>;
}
function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-sm font-light tabular-nums text-ink">{value}</div>
      <div className="text-[9px] uppercase tracking-[0.14em] text-muted">{label}</div>
    </div>
  );
}

/** The forest command band (chrome) wrapping the title, posture, clock + instruments. */
function CommandBand({
  title, subtitle, scope, updatedAt, stale, risk, settings, children,
}: {
  title: string; subtitle: string; scope: string; updatedAt: string | null; stale: boolean; risk: RiskLevel; settings?: boolean; children?: React.ReactNode;
}) {
  return (
    <section className="surface-dark bg-forest-grad overflow-hidden rounded-2xl border border-white/10 p-5 shadow-[0_14px_30px_-22px_rgba(8,37,24,.8)]">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="text-[11px] uppercase tracking-[0.18em] text-muted">{subtitle}</div>
          <h1 className="mt-1 flex items-center gap-2.5 text-2xl font-light tracking-tight text-ink sm:text-3xl">
            {title}
          </h1>
          <div className="mt-2 inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/5 px-3 py-1">
            <Lamp risk={risk} size={9} />
            <span className="text-[11px] uppercase tracking-[0.14em] text-ink">{postureLabel(risk)}</span>
          </div>
        </div>
        <div className="flex flex-col items-end gap-3">
          <CommandClock scope={scope} updatedAt={updatedAt} stale={stale} />
          {settings && (
            <Link href="/weather/settings" className="text-[11px] uppercase tracking-[0.14em] text-muted hover:text-ink">Settings →</Link>
          )}
        </div>
      </div>
      {children}
    </section>
  );
}

/** The cockpit instrument strip for one station. */
function InstrumentStrip({ t }: { t: TerritoryView }) {
  const af = activeFlags(t);
  return (
    <div className="mt-4 flex flex-wrap items-end gap-x-7 gap-y-3 border-t border-white/10 pt-4">
      <Readout label="Temp" value={t.current?.tempF != null ? `${t.current.tempF}` : "—"} unit="°F" />
      <Readout label="Humidity" value={t.current?.humidity != null ? `${t.current.humidity}` : "—"} unit="%" />
      <Readout label="Wind" value={t.current?.windMph != null ? `${t.current.windMph}` : "—"} unit="mph" />
      <Readout label="Rain" value={t.current?.pop != null ? `${t.current.pop}` : "—"} unit="%" />
      <Readout label="Advisories" value={String(af.length)} />
      <div className="min-w-[120px] flex-1">
        <div className="text-[10px] uppercase tracking-[0.18em] text-muted">Conditions</div>
        <div className="mt-1 truncate text-sm text-ink">{t.current?.short ?? "No current data"}</div>
      </div>
    </div>
  );
}

function PanelHeader({ eyebrow, risk, right }: { eyebrow: string; risk?: RiskLevel; right?: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between">
      <div className="flex items-center gap-2">
        {risk ? <Lamp risk={risk} size={8} /> : null}
        <span className="text-[11px] uppercase tracking-[0.18em] text-muted">{eyebrow}</span>
      </div>
      {right}
    </div>
  );
}

function TerritoryDetail({ t }: { t: TerritoryView }) {
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

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
      {/* Ops brief — spans two columns on desktop */}
      <Card className="p-5 lg:col-span-2">
        <PanelHeader eyebrow={`Ops brief · ${t.label}`} risk={t.risk} right={<span className="text-[10px] uppercase tracking-[0.14em] text-muted">{t.briefingModel === "fallback" ? "Rules" : "Canopy AI"}</span>} />
        <h2 className="mt-2 text-xl font-light tracking-tight text-ink">{b?.headline ?? "Forecast ready"}</h2>
        {b?.summary && <p className="mt-2 text-sm leading-relaxed text-ink">{b.summary}</p>}
        <div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-2">
          {b?.bestWorkWindow && <Info label="Best work window" value={b.bestWorkWindow} />}
          {b?.crewSafety && <Info label="Crew safety" value={b.crewSafety} />}
          {b?.byServiceLine?.lawn && <Info label="Lawn" value={b.byServiceLine.lawn} />}
          {b?.byServiceLine?.pest && <Info label="Pest" value={b.byServiceLine.pest} />}
          {b?.byServiceLine?.termite && <Info label="Termite" value={b.byServiceLine.termite} />}
          {b?.lookAhead && <Info label="Look ahead" value={b.lookAhead} />}
        </div>
      </Card>

      {/* Advisories */}
      <Card className="p-5">
        <PanelHeader eyebrow="Advisories" />
        {af.length === 0 && !blackout ? (
          <p className="mt-3 text-sm text-muted">No ops advisories today. Normal scheduling.</p>
        ) : (
          <ul className="mt-3 space-y-2.5">
            {af.map((f) => (
              <li key={f.code} className="flex items-start gap-2.5 text-sm">
                <span className="mt-1 inline-block"><Lamp risk={f.level === "red" ? "red" : "yellow"} size={8} live={false} /></span>
                <span>
                  <span className="font-medium text-ink">{f.label}.</span> <span className="text-muted">{f.meaning}</span>
                  {f.hours?.length ? <span className="text-muted"> ({f.hours.map(hourLabel).join(", ")})</span> : null}
                </span>
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
      </Card>

      {/* Radar scope — spans two columns */}
      <Card className="p-5 lg:col-span-2">
        <PanelHeader eyebrow={`Radar scope${radarStation ? ` · NWS ${radarStation}` : ""}`} right={<span className="text-[10px] uppercase tracking-[0.14em] text-muted">Live loop</span>} />
        {center ? (
          <WeatherRadarMap
            lat={center.lat}
            lon={center.lon}
            label={t.label}
            offices={t.locations.filter((l) => Number.isFinite(l.lat) && Number.isFinite(l.lon)).map((l) => ({ label: l.name, lat: l.lat, lon: l.lon }))}
          />
        ) : (
          <p className="mt-2 text-sm text-muted">Radar loads once a forecast point is set for this station.</p>
        )}
      </Card>

      {/* 5-day outlook */}
      <Card className="p-5">
        <PanelHeader eyebrow="5-day outlook" />
        <div className="mt-3 space-y-1.5">
          {strip.map((d, i) => (
            <div key={i} className="flex items-center gap-3 rounded-lg border border-line px-2.5 py-1.5">
              {d.icon ? <img src={d.icon} alt="" className="h-8 w-8 shrink-0 rounded" /> : <div className="h-8 w-8 shrink-0 rounded bg-black/5" />}
              <div className="min-w-0 flex-1">
                <div className="truncate text-xs font-medium text-ink" title={d.label}>{d.label}</div>
                <div className="text-[11px] text-brand-600">{d.pop}% rain</div>
              </div>
              <div className="text-sm tabular-nums text-ink">
                <span className="font-medium">{d.hi != null ? `${d.hi}°` : "—"}</span>
                {d.lo != null && <span className="text-muted"> / {d.lo}°</span>}
              </div>
            </div>
          ))}
        </div>
      </Card>

      {/* Ops timeline — full width */}
      {timeline.length > 0 && (
        <Card className="p-5 lg:col-span-3">
          <PanelHeader eyebrow="Ops timeline · 6a–8p" right={
            <div className="flex items-center gap-3 text-[10px] uppercase tracking-[0.14em] text-muted">
              <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-sm bg-sky-200" /> rain</span>
              <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-sm bg-purple-200" /> thunder</span>
              <span className="inline-flex items-center gap-1"><span className="h-3 w-px bg-brand-600" /> now</span>
            </div>
          } />
          <div className="mt-3 overflow-x-auto">
            <div className="flex gap-1.5" style={{ minWidth: timeline.length * 58 }}>
              {timeline.map((h) => {
                const hr = Number(h.time.slice(11, 13));
                const isThunder = thunderHours.has(h.time) || h.thunder;
                const isRain = rainHours.has(h.time);
                const isNow = hr === nowHour;
                const bg = isThunder ? "bg-purple-100 border-purple-200" : isRain ? "bg-sky-100 border-sky-200" : "border-line";
                return (
                  <div key={h.time} className={`relative w-[52px] shrink-0 rounded-lg border px-1 py-2 text-center ${bg} ${isNow ? "ring-2 ring-brand-500" : ""}`}>
                    {isNow && <span className="wx-now absolute -top-2 left-1/2 -translate-x-1/2 rounded-full bg-brand-600 px-1 text-[8px] font-medium uppercase tracking-wide text-white">now</span>}
                    <div className="text-[10px] text-muted">{hourLabel(h.time)}</div>
                    <div className="mt-0.5 text-sm font-light tabular-nums text-ink">{h.tempF != null ? `${h.tempF}°` : "—"}</div>
                    <div className="text-[10px] text-brand-600">{h.pop}%</div>
                    <div className="text-[10px] text-muted">{h.humidity != null ? `${h.humidity}rh` : ""}</div>
                    <div className="text-[10px] text-muted">{h.windMph != null ? `${h.windMph}mph` : ""}</div>
                  </div>
                );
              })}
            </div>
          </div>
        </Card>
      )}

      {/* Active alerts — full width, only when present */}
      {t.alerts.length > 0 && (
        <Card className="p-5 lg:col-span-3">
          <PanelHeader eyebrow="Active NWS alerts" right={<span className="text-[10px] uppercase tracking-[0.14em] text-red-600">{t.alerts.length} active</span>} />
          <ul className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2">
            {t.alerts.map((a, i) => (
              <li key={i} className="rounded-lg border border-red-200 bg-red-50 p-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium text-red-800">{a.event}</span>
                  <span className="text-[10px] uppercase tracking-[0.14em] text-red-600">{a.severity}</span>
                </div>
                <p className="mt-1 text-sm text-red-900">{a.headline}</p>
                {a.description && <p className="mt-1 line-clamp-4 whitespace-pre-line text-xs text-red-800/90">{a.description}</p>}
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-line bg-black/[0.02] px-3 py-2">
      <div className="text-[10px] uppercase tracking-[0.14em] text-muted">{label}</div>
      <div className="mt-0.5 text-sm text-ink">{value}</div>
    </div>
  );
}
