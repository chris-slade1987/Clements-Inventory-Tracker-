// Pure UI helpers for GPS status — safe to import from both server and client
// components (no server-only dependencies).

export type GpsStatus = "moving" | "idle" | "stopped" | "offline";

export const STATUS_META: Record<GpsStatus, { label: string; color: string; chip: string }> = {
  moving: { label: "Moving", color: "#059669", chip: "bg-emerald-100 text-emerald-700" },
  idle: { label: "Idling", color: "#d97706", chip: "bg-amber-100 text-amber-700" },
  stopped: { label: "Stopped", color: "#475569", chip: "bg-slate-200 text-slate-700" },
  offline: { label: "Offline", color: "#9ca3af", chip: "bg-slate-100 text-slate-500" },
};

/**
 * Truck display title: "2019 Ford Transit 250" from year/make/model, falling
 * back to the vehicle's stored name when the structured fields are missing.
 */
export function vehicleTitle(v: { year?: number | null; make?: string | null; model?: string | null; name?: string | null }): string {
  const parts = [v.year != null ? String(v.year) : null, v.make, v.model].filter((s): s is string => Boolean(s && s.trim()));
  const built = parts.join(" ").trim();
  return built || (v.name ?? "").trim() || "Vehicle";
}

/** "3 min ago", "2 hr ago", "yesterday" — compact last-seen phrasing. */
export function lastSeen(ts: Date | string): string {
  const d = typeof ts === "string" ? new Date(ts) : ts;
  const mins = Math.round((Date.now() - d.getTime()) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs} hr ago`;
  const days = Math.round(hrs / 24);
  return days === 1 ? "yesterday" : `${days} days ago`;
}
