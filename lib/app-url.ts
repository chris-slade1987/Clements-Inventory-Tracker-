// Canonical app URL + brand name, shared so email links and branding don't drift.
// The base-URL expression was copy-pasted at ~14 call sites; the brand name was
// spelled two ways ("Canopy OS" vs "CanopyOS"). One source of truth for both.

/** The product name — use everywhere user-facing (emails, page titles). */
export const BRAND = "CanopyOS";

/**
 * Absolute base URL for building links in emails / tokens. Prefers the
 * explicitly configured URL; falls back to the public one; empty string if
 * neither is set (callers should then fall back to the live request host).
 */
export function appUrl(): string {
  return (process.env.APP_URL || process.env.NEXT_PUBLIC_APP_URL || "").replace(/\/$/, "");
}
