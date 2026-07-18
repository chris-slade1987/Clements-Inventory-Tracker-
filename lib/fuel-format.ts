// Client-safe fuel helpers (no server imports) shared by the vehicle fuel panel
// and the fleet fuel dashboard: the date-range modes + plausibility guards.

export type FuelRangeMode = "30d" | "month" | "quarter" | "custom";

export const FUEL_RANGE_MODES: { key: FuelRangeMode; label: string }[] = [
  { key: "30d", label: "Last 30 days" },
  { key: "month", label: "Last month" },
  { key: "quarter", label: "Last quarter" },
  { key: "custom", label: "Custom" },
];

// Coast's Calculated MPG / cost-per-gallon can be garbage when a driver mis-keys
// the odometer or a token 0.1 gal is recorded on a $60 charge. Keep only sane
// readings out of the averages.
export const okMpg = (x: number | null | undefined): x is number => x != null && x >= 2 && x <= 40;
export const okCpg = (x: number | null | undefined): x is number => x != null && x >= 1.5 && x <= 8;

const DAY = 864e5;
export const isoDay = (d: Date) => d.toISOString().slice(0, 10);
export const fmtRangeDate = (isoStr: string) =>
  new Date(isoStr).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });

/**
 * Resolve a [start, end] window for the selected mode, anchored to the most
 * recent data date (not "today") so the default always lands on real data.
 */
export function computeFuelRange(
  mode: FuelRangeMode,
  anchor: Date,
  customStart: string,
  customEnd: string,
): [Date, Date] {
  if (mode === "30d") return [new Date(anchor.getTime() - 30 * DAY), anchor];
  if (mode === "month") return [new Date(Date.UTC(anchor.getUTCFullYear(), anchor.getUTCMonth(), 1)), anchor];
  if (mode === "quarter") return [new Date(Date.UTC(anchor.getUTCFullYear(), anchor.getUTCMonth() - 2, 1)), anchor];
  const s = customStart ? new Date(`${customStart}T00:00:00Z`) : new Date(0);
  const e = customEnd ? new Date(`${customEnd}T23:59:59Z`) : anchor;
  return [s, e];
}
