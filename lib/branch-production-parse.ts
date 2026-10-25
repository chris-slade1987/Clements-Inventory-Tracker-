// Branch Command — parsers for the weekly PestPac production reports, pinned to the
// real export formats (tab-separated .xls). PURE + unit-tested. Each returns normalized
// rows that feed lib/branch-production.ts. Join key everywhere is the PestPac account #.
// See docs/BRANCH-COMMAND-REPORTS.md.

const isoDate = (s: string): string => (s || "").trim().slice(0, 10).replace(/\//g, "-");
const money = (v: string): number => Number(String(v ?? "").replace(/[^0-9.\-]/g, "")) || 0;
const int = (v: string): number => { const n = parseInt(String(v ?? "").replace(/[^0-9\-]/g, ""), 10); return Number.isFinite(n) ? n : 0; };
const routeOf = (tech: string): string => tech.match(/^(\d+)/)?.[1] ?? tech.trim();

export type CompletedService = { account: string; date: string; service: string; dollars: number; techName: string };
export type OpenAppt = { account: string; date: string; service: string; route: string; techName: string; dollars: number };
export type UnservicedOrder = { account: string; date: string; service: string; route: string; techName: string; dollars: number; name: string };
export type RouteGainLoss = { account: string; service: string; route: string; techName: string; gainsCount: number; gainsValue: number; lossCount: number; lossValue: number; net: number };

/**
 * Technician Production Report → completed services. Columns (0-indexed after the
 * "Invoice Date" header row): 5 Work Date · 6 Location(account) · 8 Service · 11 Amount · 2 Tech.
 */
export function parseProductionReport(text: string): CompletedService[] {
  const lines = text.split(/\r?\n/);
  const hi = lines.findIndex((l) => l.startsWith("Invoice Date"));
  if (hi === -1) return [];
  const out: CompletedService[] = [];
  for (let i = hi + 1; i < lines.length; i++) {
    const c = lines[i].split("\t");
    if (c.length < 12) continue;
    const account = (c[6] || "").trim();
    if (!/^\d/.test(account)) continue;
    out.push({ account, date: isoDate(c[5]), service: (c[8] || "").trim().toUpperCase(), dollars: money(c[11]), techName: (c[2] || "").trim() });
  }
  return out;
}

/**
 * Appointment List (open appointments ahead) → 4-line records. The service-date line
 * (col0 = "YYYY/MM/DD Weekday") carries 2 Location(account) · 6 Service Type; the tech +
 * price are the line ABOVE (col0 tech, col1 price); the route is the line BELOW (col5).
 */
export function parseAppointmentList(text: string): OpenAppt[] {
  const lines = text.split(/\r?\n/);
  const out: OpenAppt[] = [];
  for (let i = 0; i < lines.length; i++) {
    const c = lines[i].split("\t");
    if (!/^\d{4}\/\d{2}\/\d{2}\s/.test(c[0] || "")) continue;
    const account = (c[2] || "").trim();
    if (!/^\d/.test(account)) continue;
    const prev = (lines[i - 1] || "").split("\t");
    const next = (lines[i + 1] || "").split("\t");
    out.push({
      account, date: isoDate(c[0]), service: (c[6] || "").trim().toUpperCase(),
      route: (next[5] || "").trim(), techName: (prev[0] || "").trim(), dollars: money(prev[1]),
    });
  }
  return out;
}

/**
 * Unserviced / Uncommitted Orders Report → outstanding orders. Data rows start with a
 * numeric Order #: 0 Order · 1 Location(account) · 2 Name · 3 Work Date · 7 Technician ·
 * 9 Service Total · 10 Service. "Totals ..." lines are skipped (non-numeric col0).
 */
export function parseUnservicedReport(text: string): UnservicedOrder[] {
  const lines = text.split(/\r?\n/);
  const out: UnservicedOrder[] = [];
  for (const line of lines) {
    const c = line.split("\t");
    if (!/^\d+$/.test((c[0] || "").trim())) continue; // order #
    const account = (c[1] || "").trim();
    if (!/^\d/.test(account)) continue;
    const date = isoDate(c[3] || "");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
    const tech = (c[7] || "").trim();
    out.push({ account, date, service: (c[10] || "").trim().toUpperCase(), route: routeOf(tech), techName: tech, dollars: money(c[9]), name: (c[2] || "").trim() });
  }
  return out;
}

/**
 * Gain & Loss Report → per-account route changes (gains = new starts, losses =
 * cancellations) with net value. Grouped by "Tech 1: .." then "Route: ..". Account
 * data rows: 0 Location · 1 Service · 2 Gains Count · 3 Gains Value · 4 Loss Count ·
 * 5 Loss Value · 8 Net. "Totals .." lines skipped. These are route-size moves, NOT sales.
 */
export function parseGainLossReport(text: string): RouteGainLoss[] {
  const lines = text.split(/\r?\n/);
  let route = "";
  let tech = "";
  const out: RouteGainLoss[] = [];
  for (const line of lines) {
    const c = line.split("\t");
    const col0 = (c[0] || "").trim();
    if (/^Tech 1:/i.test(col0)) { tech = col0.replace(/^Tech 1:\s*/i, "").trim(); continue; }
    if (/^Route:/i.test(col0)) { route = col0.replace(/^Route:\s*/i, "").trim(); continue; }
    if (/^Totals/i.test(col0)) continue;
    if (!/^\d/.test(col0)) continue; // account rows start with a digit
    out.push({
      account: col0, service: (c[1] || "").trim().toUpperCase(), route, techName: tech,
      gainsCount: int(c[2]), gainsValue: money(c[3]), lossCount: int(c[4]), lossValue: money(c[5]), net: money(c[8]),
    });
  }
  return out;
}
