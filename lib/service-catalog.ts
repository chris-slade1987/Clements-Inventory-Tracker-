// Canonical catalog of the services a field employee can be APPROVED to perform.
// These tags are stored on `Employee.approvedServices` as a JSON array of keys and
// surfaced on the org-chart tile + profile. Keep this list the single source of
// truth — the org-chart search, the tile editor, and any UI label map read from here.

export const SERVICE_TAGS = [
  { key: "bees", label: "Bees" },
  { key: "wasps", label: "Wasps" },
  { key: "rodents", label: "Rodents" },
  { key: "wildlife", label: "Wildlife" },
  { key: "termites", label: "Termites" },
  { key: "lawn", label: "Lawn & Ornamental" },
  { key: "mosquito", label: "Mosquito" },
  { key: "general", label: "General Pest" },
  { key: "consultations", label: "Consultations" },
] as const;

export type ServiceTagKey = (typeof SERVICE_TAGS)[number]["key"];

export const SERVICE_TAG_KEYS: readonly string[] = SERVICE_TAGS.map((t) => t.key);

const LABEL_BY_KEY: Record<string, string> = Object.fromEntries(
  SERVICE_TAGS.map((t) => [t.key, t.label]),
);

/** Human label for a service tag key (falls back to the raw key if unknown). */
export function serviceLabel(key: string): string {
  return LABEL_BY_KEY[key] ?? key;
}

/** True if a string is a known, canonical service tag key. */
export function isServiceTag(key: unknown): key is ServiceTagKey {
  return typeof key === "string" && SERVICE_TAG_KEYS.includes(key);
}

/**
 * Normalize arbitrary input (array of keys, or a JSON string of such an array)
 * down to a clean, de-duplicated list of VALID tag keys in catalog order.
 * Unknown keys are dropped. Used when saving tile edits so bad input can't land.
 */
export function sanitizeServiceTags(input: unknown): ServiceTagKey[] {
  let arr: unknown[] = [];
  if (Array.isArray(input)) arr = input;
  else if (typeof input === "string") {
    try {
      const parsed = JSON.parse(input);
      if (Array.isArray(parsed)) arr = parsed;
    } catch {
      // not JSON — treat a bare comma-separated string as a fallback
      arr = input.split(",").map((s) => s.trim());
    }
  }
  const seen = new Set<string>();
  for (const v of arr) {
    const k = typeof v === "string" ? v.trim().toLowerCase() : "";
    if (isServiceTag(k)) seen.add(k);
  }
  // Return in canonical catalog order for stable display.
  return SERVICE_TAGS.filter((t) => seen.has(t.key)).map((t) => t.key);
}

/** Serialize a clean tag list to the JSON string stored on the Employee row. */
export function serializeApprovedServices(input: unknown): string {
  return JSON.stringify(sanitizeServiceTags(input));
}

/** Parse the stored JSON into `{ key, label }[]` for the tile/profile payload. */
export function parseApprovedServices(stored: string | null | undefined): { key: string; label: string }[] {
  return sanitizeServiceTags(stored).map((key) => ({ key, label: serviceLabel(key) }));
}
