// ---------------------------------------------------------------------------
// Cancellation Center — PestPac "Gain & Loss Report" parser (pure; no I/O).
//
// The Cancellation Center reads ONE format: the Gain & Loss Report run for a
// single calendar month (or month-to-date), "Sorted by: [Branch, Route]". Layout
// (tab-separated text saved as .xls):
//
//   Start Date: 2026/11/01 · End Date: 2026/11/16 (header block)
//   Branch: Naples - Branch 4
//   Route: 403 | Location | Name | Address | Service | Gains Count | Gains Value |
//                Loss Count | Loss Value | Price Change Count | Price Change Value | Net
//   120611 | Czaban, John | 28502 Highgate Drive, Bonita Springs, FL 34135 | PC-EOM |
//            '' | '' | 1 | 420.00 | 0 | 0.00 | -420.00
//   Totals Route: 403 … / Totals Branch: … / Report Totals …
//
// Account rows are positional: 0 account · 1 customer · 2 address · 3 service ·
// 4 gains count · 5 gains value · 6 loss count · 7 loss value · 8/9 price change ·
// 10 net. Only rows with a loss (count or value) are cancellations; gains and
// price changes are ignored here. "Report Totals" is read back to prove the parse.
// The older "Tech 1" grouping (no branch / route header) is rejected with a clear
// message, because it can't be broken out by branch reliably.
// ---------------------------------------------------------------------------

import type { Division } from "@/lib/constants";

export type CancellationRow = {
  branch: string; // vero | stuart | orlando | naples
  route: string;
  account: string;
  customer: string;
  address: string;
  city: string;
  zip: string;
  serviceCode: string;
  division: Division;
  lossCount: number;
  lossValue: number;
};

export type ParsedCancellations = {
  startDate: string; // YYYY-MM-DD
  endDate: string; // YYYY-MM-DD
  periodKey: string; // YYYY-MM (from the start date)
  rows: CancellationRow[];
  reportLossCount: number | null; // "Report Totals" loss count, when present
  reportLossValue: number | null;
};

export class CancellationParseError extends Error {}

const num = (s: string | undefined): number => {
  const n = Number(String(s ?? "").replace(/[$,\s]/g, ""));
  return Number.isFinite(n) ? n : 0;
};

function isoDate(s: string): string {
  const m = String(s || "").trim().match(/^(\d{4})[/-](\d{1,2})[/-](\d{1,2})/);
  if (m) return `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;
  const u = String(s || "").trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (u) return `${u[3]}-${u[1].padStart(2, "0")}-${u[2].padStart(2, "0")}`;
  return "";
}

/** "Naples - Branch 4" → "naples"; unknown → "" (caller falls back to the route). */
export function branchFromHeader(text: string): string {
  const t = text.toLowerCase();
  if (t.includes("vero")) return "vero";
  if (t.includes("stuart")) return "stuart";
  if (t.includes("orlando")) return "orlando";
  if (t.includes("naples")) return "naples";
  const n = t.match(/branch\s*(\d)/);
  return n ? ({ "1": "vero", "2": "stuart", "3": "orlando", "4": "naples" } as Record<string, string>)[n[1]] ?? "" : "";
}

/** 3-digit routes: 2xx Stuart, 3xx Orlando, 4xx Naples; everything else Vero. */
function branchFromRoute(route: string): string {
  const n = route.replace(/\D/g, "");
  if (n.length >= 3) {
    if (n.startsWith("2")) return "stuart";
    if (n.startsWith("3")) return "orlando";
    if (n.startsWith("4")) return "naples";
  }
  return "vero";
}

/**
 * PestPac service code → service division. Prefix rules, most specific first.
 * Codes not covered fall to OTHER (shown on the dashboard so they can be mapped).
 */
export function divisionForService(code: string): Division {
  const c = code.trim().toUpperCase();
  if (!c) return "OTHER";
  if (/MOSQ|^MM\b|^MM-/.test(c)) return "MOSQUITO";
  if (/^R-|RODENT|^RAT\b/.test(c)) return "RODENT";
  if (/^SEN\b|^SEN-|SENTRICON|^RE-FILL|^T-|TERMITE|^WDO|BORATE|^TERM/.test(c)) return "TERMITE";
  if (/^PC\b|^PC-|^IPM\b|^IPM-/.test(c)) return "GHP";
  if (/^L\b|^L-|^LW\b|^LW-|^GR\b|^GR-|^A-FIRE|LAWN|SHRUB|TURF|PALM|TREE|WEED/.test(c)) return "LO";
  return "OTHER";
}

/** "28502 Highgate Drive, Bonita Springs, FL 34135" → city + 5-digit zip. */
export function splitAddress(address: string): { city: string; zip: string } {
  const parts = address.split(",").map((p) => p.trim()).filter(Boolean);
  const zip = address.match(/\b(\d{5})(?:-\d{4})?\s*$/)?.[1] ?? "";
  // City is the part before the "FL 34135" state/zip part.
  let city = "";
  if (parts.length >= 3) city = parts[parts.length - 2];
  else if (parts.length === 2) city = parts[1].replace(/\b[A-Z]{2}\s+\d{5}(-\d{4})?$/, "").trim();
  // One spelling per city ("Port Saint Lucie" / "Port St. Lucie" → "Port St Lucie").
  city = city.replace(/\./g, "").replace(/\s+/g, " ").toLowerCase().replace(/\b\w/g, (ch) => ch.toUpperCase()).replace(/\bSaint\b/g, "St");
  return { city, zip };
}

export function parseCancellationReport(text: string): ParsedCancellations {
  const lines = text.split(/\r?\n/);
  const head = lines.slice(0, 12).join("\n").toLowerCase();
  if (!head.includes("gain & loss report") && !head.includes("gain and loss report")) {
    throw new CancellationParseError("This isn't a PestPac Gain & Loss Report. Run Reports → Gain & Loss, sorted by Branch, Route.");
  }

  let startDate = "";
  let endDate = "";
  for (const line of lines.slice(0, 12)) {
    const c = line.split("\t").map((x) => x.trim());
    if (/^start date:/i.test(c[0] ?? "")) startDate = isoDate(c[1] ?? "");
    if (/^end date:/i.test(c[0] ?? "")) endDate = isoDate(c[1] ?? "");
  }
  if (!startDate || !endDate) throw new CancellationParseError("Couldn't read the report's Start Date / End Date.");
  if (startDate.slice(0, 7) !== endDate.slice(0, 7)) {
    throw new CancellationParseError(
      `This report covers ${startDate} to ${endDate}. Run it for one calendar month at a time (month-to-date is fine).`,
    );
  }

  let branch = "";
  let route = "";
  let sawBranch = false;
  let sawTech = false;
  let reportLossCount: number | null = null;
  let reportLossValue: number | null = null;
  const rows: CancellationRow[] = [];

  for (const line of lines) {
    const c = line.split("\t");
    const col0 = (c[0] ?? "").trim();
    if (!col0) continue;
    if (/^Branch:/i.test(col0)) { branch = branchFromHeader(col0.replace(/^Branch:\s*/i, "")); sawBranch = true; continue; }
    if (/^Tech 1:/i.test(col0)) { sawTech = true; continue; }
    if (/^Route:/i.test(col0)) { route = col0.replace(/^Route:\s*/i, "").trim(); continue; }
    if (/^Report Totals/i.test(col0)) { reportLossCount = num(c[6]); reportLossValue = num(c[7]); continue; }
    if (/^Totals/i.test(col0)) continue;
    if (!/^\d+$/.test(col0)) continue; // account rows start with the location number

    const lossCount = num(c[6]);
    const lossValue = num(c[7]);
    if (lossCount <= 0 && lossValue <= 0) continue; // a gain or price change, not a cancellation
    const address = (c[2] ?? "").trim();
    const serviceCode = (c[3] ?? "").trim().toUpperCase();
    rows.push({
      branch: branch || branchFromRoute(route),
      route,
      account: col0,
      customer: (c[1] ?? "").trim(),
      address,
      ...splitAddress(address),
      serviceCode,
      division: divisionForService(serviceCode),
      lossCount,
      lossValue: Math.round(lossValue * 100) / 100,
    });
  }

  if (!sawBranch && sawTech) {
    throw new CancellationParseError("This report is grouped by technician. Re-run the Gain & Loss Report sorted by Branch, Route.");
  }
  if (!sawBranch) throw new CancellationParseError("No Branch headings found. Re-run the Gain & Loss Report sorted by Branch, Route.");

  return { startDate, endDate, periodKey: startDate.slice(0, 7), rows, reportLossCount, reportLossValue };
}

/** Sum check against "Report Totals" (null when the report had no totals line). */
export function totalsMatch(p: ParsedCancellations): boolean | null {
  if (p.reportLossValue == null) return null;
  const v = p.rows.reduce((s, r) => s + r.lossValue, 0);
  const n = p.rows.reduce((s, r) => s + r.lossCount, 0);
  return Math.abs(v - p.reportLossValue) < 0.01 && (p.reportLossCount == null || n === p.reportLossCount);
}
