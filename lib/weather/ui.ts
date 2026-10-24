// Weather Ops — pure presentational helpers shared by the dashboard tile, the
// /weather page, and settings. No server-only, no JSX, so client components import
// it freely. Color tokens follow the portal (brand green = good, amber = caution,
// red = stop). See docs/WEATHER-OPS.md.
import type { DayPoint, RiskLevel } from "./types";

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

export type DayCard = { label: string; icon: string | null; hi: number | null; lo: number | null; pop: number };

/** Collapse NWS day/night periods into up-to-5 day cards (hi/lo + rain%). */
export function fiveDay(daily: DayPoint[]): DayCard[] {
  const days: DayCard[] = [];
  let cur: DayCard | null = null;
  for (const p of daily) {
    if (p.isDaytime) {
      cur = { label: p.name, icon: p.icon, hi: p.tempF, lo: null, pop: p.pop ?? 0 };
      days.push(cur);
    } else if (cur && cur.lo == null) {
      cur.lo = p.tempF;
      cur.pop = Math.max(cur.pop, p.pop ?? 0);
    } else {
      cur = { label: p.name, icon: p.icon, hi: null, lo: p.tempF, pop: p.pop ?? 0 };
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
