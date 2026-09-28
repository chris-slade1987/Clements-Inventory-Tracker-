// Pure vehicle-display helper — safe to import from both server and client
// components (no server-only dependencies). The GPS/Verizon subsystem was
// removed; only the vehicle title helper below is still in use.

/**
 * Truck display title: "2019 Ford Transit 250" from year/make/model, falling
 * back to the vehicle's stored name when the structured fields are missing.
 */
export function vehicleTitle(v: { year?: number | null; make?: string | null; model?: string | null; name?: string | null }): string {
  const parts = [v.year != null ? String(v.year) : null, v.make, v.model].filter((s): s is string => Boolean(s && s.trim()));
  const built = parts.join(" ").trim();
  return built || (v.name ?? "").trim() || "Vehicle";
}
