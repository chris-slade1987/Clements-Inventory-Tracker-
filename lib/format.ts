export function money(n: number | null | undefined): string {
  if (n == null) return "—";
  return n.toLocaleString("en-US", { style: "currency", currency: "USD" });
}

export function qty(n: number | null | undefined): string {
  if (n == null) return "—";
  // Trim trailing zeros but keep up to 2 decimals.
  return Number(n.toFixed(2)).toLocaleString("en-US");
}

export function dateShort(d: Date | string): string {
  return new Date(d).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}
