import "server-only";
import type { DayPoint, GridData, HourPoint, WxAlert } from "./types";
import { isOperationalAlert } from "./rules";

// Weather Ops — the data-source client. Free sources only, no API keys:
//   • National Weather Service (api.weather.gov) — points, hourly, daily, grid, alerts
//   • National Hurricane Center (nhc.noaa.gov/CurrentStorms.json) — active tropical systems
// NWS REQUIRES a descriptive User-Agent with contact info or it blocks the request.
// NWS also 500s intermittently, so every call retries with backoff; callers keep the
// last good snapshot on failure (never show an empty tile). See docs/WEATHER-OPS.md.

const UA = "CanopyOS (c.slade@clementspestcontrol.com)";
const HEADERS = { "User-Agent": UA, Accept: "application/geo+json" };

async function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

/** GET JSON with 3 tries and exponential backoff (0.5s, 1s, 2s). Throws on final fail. */
async function getJson<T>(url: string): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt > 0) await sleep(500 * 2 ** (attempt - 1));
    try {
      const res = await fetch(url, { headers: HEADERS, cache: "no-store" });
      if (res.status >= 500 || res.status === 429) {
        lastErr = new Error(`NWS ${res.status} for ${url}`);
        continue; // retryable
      }
      if (!res.ok) throw new Error(`NWS ${res.status} for ${url}: ${(await res.text()).slice(0, 300)}`);
      return (await res.json()) as T;
    } catch (e) {
      lastErr = e; // network error — retry
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

export type PointInfo = {
  gridId: string;
  gridX: number;
  gridY: number;
  radarStation: string | null;
  forecastUrl: string;
  forecastHourlyUrl: string;
  forecastGridDataUrl: string;
};

/** Resolve /points/{lat},{lon} → grid + forecast URLs. Cache these; they don't change. */
export async function resolvePoint(lat: number, lon: number): Promise<PointInfo> {
  const data = await getJson<{
    properties: {
      gridId: string; gridX: number; gridY: number; radarStation?: string;
      forecast: string; forecastHourly: string; forecastGridData: string;
    };
  }>(`https://api.weather.gov/points/${lat.toFixed(4)},${lon.toFixed(4)}`);
  const p = data.properties;
  return {
    gridId: p.gridId,
    gridX: p.gridX,
    gridY: p.gridY,
    radarStation: p.radarStation ?? null,
    forecastUrl: p.forecast,
    forecastHourlyUrl: p.forecastHourly,
    forecastGridDataUrl: p.forecastGridData,
  };
}

// Wind comes back as strings like "5 to 10 mph" or "10 mph". Parse and use the HIGH end.
export function parseWindHigh(s: string | null | undefined): number | null {
  if (!s) return null;
  const nums = (s.match(/\d+(\.\d+)?/g) ?? []).map(Number).filter((n) => Number.isFinite(n));
  return nums.length ? Math.max(...nums) : null;
}

const THUNDER_RE = /(thunder|t-?storm|lightning)/i;

type NwsPeriod = {
  number: number;
  name: string;
  startTime: string;
  isDaytime: boolean;
  temperature: number | null;
  temperatureUnit: string;
  probabilityOfPrecipitation?: { value: number | null } | null;
  relativeHumidity?: { value: number | null } | null;
  windSpeed?: string | null;
  windDirection?: string | null;
  shortForecast: string;
  icon?: string | null;
};

/** forecastHourly → normalized HourPoint[]. */
export async function fetchHourly(url: string): Promise<HourPoint[]> {
  const data = await getJson<{ properties: { periods: NwsPeriod[] } }>(url);
  return (data.properties.periods ?? []).map((p) => ({
    time: p.startTime,
    tempF: p.temperature ?? null,
    pop: p.probabilityOfPrecipitation?.value ?? 0,
    humidity: p.relativeHumidity?.value ?? null,
    windMph: parseWindHigh(p.windSpeed),
    windDir: p.windDirection ?? null,
    gustMph: null, // gusts come from the gridpoint feed
    short: p.shortForecast ?? "",
    thunder: THUNDER_RE.test(p.shortForecast ?? ""),
  }));
}

/** forecast (day/night periods) → DayPoint[] for the 5-day strip. */
export async function fetchDaily(url: string): Promise<DayPoint[]> {
  const data = await getJson<{ properties: { periods: NwsPeriod[] } }>(url);
  return (data.properties.periods ?? []).map((p) => ({
    name: p.name,
    isDaytime: p.isDaytime,
    tempF: p.temperature ?? null,
    short: p.shortForecast ?? "",
    pop: p.probabilityOfPrecipitation?.value ?? null,
    icon: p.icon ?? null,
  }));
}

// A gridpoint time series: { uom, values: [{ validTime: "ISO/PnДT..", value }] }.
type GridSeries = { values?: { validTime: string; value: number | null }[] } | undefined;

/** Start ISO of an ISO8601 interval "2026-07-15T06:00:00+00:00/PT1H". */
function intervalStart(validTime: string): string {
  return validTime.split("/")[0];
}
/** Eastern-time calendar date ("YYYY-MM-DD") for an instant — gridpoint times are UTC. */
function etDate(d: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(d);
}

/**
 * forecastGridData → trimmed GridData we actually use:
 *   qpf24In  — max forecast precip (inches) across any rolling 24h ahead
 *   maxGustMph, maxHeatIndexF — peaks across the horizon
 *   thunderHours — hours where a thunder/lightning-ish field is present
 * Values are metric in the raw feed (mm, km/h, °C); converted here.
 */
export async function fetchGrid(url: string): Promise<GridData> {
  const data = await getJson<{
    properties: Record<string, unknown> & {
      quantitativePrecipitation?: GridSeries;
      windGust?: GridSeries;
      maxHeatIndex?: GridSeries;
      heatIndex?: GridSeries;
      apparentTemperature?: GridSeries;
      probabilityOfThunder?: GridSeries;
      thunderstormProbability?: GridSeries;
      lightningActivityLevel?: GridSeries;
    };
  }>(url);
  const props = data.properties;

  // QPF: feed is mm per interval. Build an hourly mm array over the next 24h, max any
  // 24h rolling sum (here: just the next-24h total, which the 24h window reduces to).
  const now = Date.now();
  const horizon = now + 48 * 3600 * 1000;
  let mm24 = 0;
  for (const v of props.quantitativePrecipitation?.values ?? []) {
    const start = new Date(intervalStart(v.validTime)).getTime();
    if (start >= now && start <= now + 24 * 3600 * 1000 && typeof v.value === "number") mm24 += v.value;
  }
  const qpf24In = mm24 > 0 ? Math.round((mm24 / 25.4) * 100) / 100 : 0;

  const maxGustMph = maxSeries(props.windGust, (kmh) => kmh * 0.621371, horizon);
  const heatC = maxSeries(props.maxHeatIndex ?? props.heatIndex ?? props.apparentTemperature, (c) => c, horizon);
  const maxHeatIndexF = heatC == null ? null : Math.round((heatC * 9) / 5 + 32);

  // Thunder: is any gridpoint thunder/lightning probability non-zero TODAY (ET)? This
  // is a secondary, boolean trigger — the precise flagged hours come from the hourly
  // shortForecast text (reliable + in local time), so we don't try to pin grid hours.
  const today = etDate(new Date(now));
  let thunderLikely = false;
  const thunderSeries = props.probabilityOfThunder ?? props.thunderstormProbability ?? props.lightningActivityLevel;
  for (const v of thunderSeries?.values ?? []) {
    const start = new Date(intervalStart(v.validTime));
    if (start.getTime() >= now && start.getTime() <= horizon && typeof v.value === "number" && v.value > 0 && etDate(start) === today) {
      thunderLikely = true;
      break;
    }
  }
  return { qpf24In, maxGustMph: maxGustMph == null ? null : Math.round(maxGustMph), maxHeatIndexF, thunderLikely };
}

function maxSeries(s: GridSeries, convert: (v: number) => number, horizon: number): number | null {
  const now = Date.now();
  let max: number | null = null;
  for (const v of s?.values ?? []) {
    const start = new Date(intervalStart(v.validTime)).getTime();
    if (start >= now && start <= horizon && typeof v.value === "number") {
      const c = convert(v.value);
      if (max == null || c > max) max = c;
    }
  }
  return max;
}

/** GET /alerts/active?point=lat,lon → trimmed WxAlert[]. */
export async function fetchAlerts(lat: number, lon: number): Promise<WxAlert[]> {
  const data = await getJson<{
    features: { properties: { event: string; severity: string; headline?: string; description?: string; onset?: string | null; ends?: string | null } }[];
  }>(`https://api.weather.gov/alerts/active?point=${lat.toFixed(4)},${lon.toFixed(4)}`);
  return (data.features ?? [])
    .filter((f) => isOperationalAlert(f.properties.event)) // drop coastal/marine/aquatic noise
    .map((f) => ({
      event: f.properties.event,
      severity: f.properties.severity ?? "Unknown",
      headline: f.properties.headline ?? f.properties.event,
      description: (f.properties.description ?? "").slice(0, 2000),
      onset: f.properties.onset ?? null,
      ends: f.properties.ends ?? null,
    }));
}

/**
 * NHC active storms → is any tropical system affecting Florida? CurrentStorms.json
 * lists active systems in the Atlantic/E-Pacific; we flag when an Atlantic-basin
 * system is active (the NWS point alerts carry the precise local watch/warning, so
 * this is the coarse "a storm is out there" signal the rules OR together).
 */
export async function fetchTropicalActive(): Promise<boolean> {
  try {
    const data = await getJson<{ activeStorms?: { id?: string; binNumber?: string; basin?: string }[] }>(
      "https://www.nhc.noaa.gov/CurrentStorms.json"
    );
    const storms = data.activeStorms ?? [];
    return storms.some((s) => {
      const b = (s.basin ?? "").toLowerCase();
      const id = (s.id ?? "").toUpperCase();
      return b.includes("atlantic") || b === "al" || id.startsWith("AL");
    });
  } catch {
    return false; // NHC down → don't block; NWS point alerts still carry local tropical watches
  }
}

export const NWS_BUILD = "weather-nws-1";
