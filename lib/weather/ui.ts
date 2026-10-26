// Weather Ops — pure presentational helpers shared by the dashboard tile, the
// /weather page, and settings. No server-only, no JSX, so client components import
// it freely. Color tokens follow the portal (brand green = good, amber = caution,
// red = stop). See docs/WEATHER-OPS.md.
import type { DayPoint, HourPoint, RiskLevel } from "./types";

export function riskLabel(risk: RiskLevel): string {
  return risk === "red" ? "Red — high risk" : risk === "yellow" ? "Yellow — caution" : "Green — clear";
}
export function riskShort(risk: RiskLevel): string {
  return risk === "red" ? "Red" : risk === "yellow" ? "Caution" : "Clear";
}
/** Pill classes for a risk badge. */
export function riskBadgeClass(risk: RiskLevel): string {
  if (risk === "red") return "bg-red-50 text-red-700 border-red-200";
  if (risk === "yellow") return "bg-amber-50 text-amber-700 border-amber-200";
  return "bg-brand-50 text-brand-700 border-brand-200";
}
/** Solid dot color for a risk indicator. */
export function riskDotClass(risk: RiskLevel): string {
  if (risk === "red") return "bg-red-500";
  if (risk === "yellow") return "bg-amber-500";
  return "bg-brand-500";
}

export type DayCard = { label: string; short: string; icon: string | null; hi: number | null; lo: number | null; pop: number };

/** A day split into Morning / Midday / Afternoon rundowns from the hourly feed. */
export type DayPart = { label: string; temp: string; rain: string; sky: string; pop: number };
export function dayParts(hours: HourPoint[]): DayPart[] {
  const seg = (lo: number, hi: number) => hours.filter((h) => { const x = Number(h.time.slice(11, 13)); return x >= lo && x <= hi; });
  const build = (label: string, hrs: HourPoint[]): DayPart | null => {
    if (!hrs.length) return null;
    const temps = hrs.map((h) => h.tempF).filter((n): n is number => n != null);
    const tmin = temps.length ? Math.min(...temps) : null;
    const tmax = temps.length ? Math.max(...temps) : null;
    const pop = Math.max(0, ...hrs.map((h) => h.pop));
    const temp = tmin != null ? (tmin === tmax ? `${tmax}°` : `${tmin}–${tmax}°`) : "—";
    const rain = pop >= 60 ? `likely rain ${pop}%` : pop >= 30 ? `${pop}% rain` : "mostly dry";
    const counts = new Map<string, number>();
    for (const h of hrs) counts.set(h.short, (counts.get(h.short) || 0) + 1);
    const sky = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "";
    return { label, temp, rain, sky, pop };
  };
  return [build("Morning", seg(6, 11)), build("Midday", seg(12, 15)), build("Afternoon", seg(16, 20))].filter((x): x is DayPart => !!x);
}

/** Collapse NWS day/night periods into up-to-5 day cards (hi/lo + rain% + condition). */
export function fiveDay(daily: DayPoint[]): DayCard[] {
  const days: DayCard[] = [];
  let cur: DayCard | null = null;
  for (const p of daily) {
    if (p.isDaytime) {
      cur = { label: p.name, short: p.short, icon: p.icon, hi: p.tempF, lo: null, pop: p.pop ?? 0 };
      days.push(cur);
    } else if (cur && cur.lo == null) {
      cur.lo = p.tempF;
      cur.pop = Math.max(cur.pop, p.pop ?? 0);
      if (!cur.short) cur.short = p.short;
    } else {
      cur = { label: p.name, short: p.short, icon: p.icon, hi: null, lo: p.tempF, pop: p.pop ?? 0 };
      days.push(cur);
    }
  }
  return days.slice(0, 5);
}

/** "12 min ago" / "3 hr ago" / "just now" from an ISO timestamp. */
export function updatedAgo(iso: string | null): string {
  if (!iso) return "never";
  const ms = Date.now() - new Date(iso).getTime();
  const min = Math.round(ms / 60000);
  if (min < 1) return "just now";
  if (min < 60) return `${min} min ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr} hr ago`;
  return `${Math.round(hr / 24)} d ago`;
}

/** Radar loop GIF for a station, e.g. "KMLB" → ridge standard loop. */
export function radarLoopUrl(station: string | null): string | null {
  if (!station) return null;
  return `https://radar.weather.gov/ridge/standard/${station}_loop.gif`;
}

/** Local ET hour label for an NWS ISO time, e.g. "2pm". */
export function hourLabel(iso: string): string {
  const h = Number(iso.slice(11, 13));
  if (h === 0) return "12am";
  if (h < 12) return `${h}am`;
  if (h === 12) return "12pm";
  return `${h - 12}pm`;
}
