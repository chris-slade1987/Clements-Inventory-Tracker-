// Pure parser for the PestPac "Technician Schedule Report" export, sorted by
// [Technician, Branch] (the tab-separated .xls that is really TSV). No DB / no
// server-only imports so it can be unit-tested directly. The ingest layer
// (lib/routing-ingest.ts) consumes this and writes the Route* tables + matches
// technicians to Canopy. See docs/ROUTING-APPROVAL.md.

export type ParsedStop = {
  date: string; // "YYYY/MM/DD"
  time: string | null; // "08:00 AM" or null
  durMinutes: number; // scheduled duration from "HH:MM"
  schedule: string; // recurring schedule template code, e.g. "BJAN1MON"
  mapCode: string | null; // route-area sub-code when present
  service: string; // e.g. "PC-EOM"
  amount: number; // $ for the stop
  account: string; // PestPac account #
  customer: string;
  address: string;
  city: string;
  state: string;
  zip: string; // 5-digit, normalized out of ="34110-0309"
};

export type ParsedTech = {
  techNumber: string; // "01", "208", "403" …
  techName: string; // "JOSH", "MAURICE" …
  rawLabel: string; // "01 JOSH" — exactly as printed
  stops: ParsedStop[];
};

export type ParsedRouting = {
  periodStart: string | null; // "YYYY/MM/DD" from the report header
  periodEnd: string | null;
  techs: ParsedTech[];
  totalStops: number;
  totalAmount: number;
};

const DATE_RE = /^\d{4}\/\d{2}\/\d{2}/;

function durMinutes(s: string): number {
  const t = (s || "").trim();
  if (!t.includes(":")) return 0;
  const [h, m] = t.split(":");
  const hh = parseInt(h, 10);
  const mm = parseInt(m, 10);
  return (Number.isFinite(hh) ? hh * 60 : 0) + (Number.isFinite(mm) ? mm : 0);
}
function money(s: string): number {
  const n = parseFloat((s || "").replace(/[^0-9.\-]/g, ""));
  return Number.isFinite(n) ? n : 0;
}
function zip5(s: string): string {
  const m = /(\d{5})/.exec(s || "");
  return m ? m[1] : "";
}
/** "01 JOSH" → {number:"01", name:"JOSH"}; "208MAURICE" → {number:"208", name:"MAURICE"}. */
export function splitTechLabel(label: string): { number: string; name: string } {
  const t = label.trim();
  // number is the leading run of digits (optionally separated by a space)
  const m = /^(\d+)\s*(.*)$/.exec(t);
  if (m) return { number: m[1], name: m[2].trim() || t };
  const m2 = /^(\S+)\s+(.*)$/.exec(t);
  return m2 ? { number: m2[1], name: m2[2].trim() } : { number: "", name: t };
}

export function parseRoutingReport(text: string): ParsedRouting {
  const lines = text.split(/\r?\n/);
  const rows = lines.map((l) => l.split("\t"));
  let periodStart: string | null = null;
  let periodEnd: string | null = null;
  const techs: ParsedTech[] = [];
  let cur: ParsedTech | null = null;
  let totalStops = 0;
  let totalAmount = 0;

  for (const r of rows) {
    const c0 = (r[0] || "").trim();
    if (!c0) continue;
    if (c0 === "Start Date:" && r[1]) periodStart = r[1].trim();
    else if (c0 === "End Date:" && r[1]) periodEnd = r[1].trim();

    if (c0.startsWith("Technician:") && !r.join(" ").includes("[All]")) {
      const label = c0.replace("Technician:", "").trim();
      const { number, name } = splitTechLabel(label);
      cur = { techNumber: number, techName: name, rawLabel: label, stops: [] };
      techs.push(cur);
      continue;
    }

    // Data rows: 14 tab-separated fields beginning with a date.
    if (cur && r.length >= 14 && DATE_RE.test(c0)) {
      const stop: ParsedStop = {
        date: c0,
        time: (r[1] || "").trim() || null,
        durMinutes: durMinutes(r[2]),
        schedule: (r[3] || "").trim(),
        mapCode: (r[4] || "").trim() || null,
        service: (r[5] || "").trim(),
        amount: money(r[6]),
        account: (r[7] || "").trim(),
        customer: (r[8] || "").trim(),
        address: (r[9] || "").trim(),
        city: (r[10] || "").trim(),
        state: (r[11] || "").trim(),
        zip: zip5(r[12]),
      };
      cur.stops.push(stop);
      totalStops++;
      totalAmount += stop.amount;
    }
  }

  // Drop any technician rows that captured no stops (defensive).
  const withStops = techs.filter((t) => t.stops.length > 0);
  return { periodStart, periodEnd, techs: withStops, totalStops, totalAmount };
}

/** Group a tech's stops by day, preserving file order as the route sequence. */
export function groupByDay(stops: ParsedStop[]): { date: string; stops: ParsedStop[] }[] {
  const byDate = new Map<string, ParsedStop[]>();
  for (const s of stops) {
    if (!byDate.has(s.date)) byDate.set(s.date, []);
    byDate.get(s.date)!.push(s);
  }
  return [...byDate.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([date, ss]) => ({ date, stops: ss }));
}

/** Branch key from the tech number's leading digit(s): 2xx=Stuart, 3xx=Orlando,
 *  4xx=Naples, else Vero. A heuristic — the ingest layer prefers the Canopy
 *  technician's real branch when the match is confirmed. */
export function branchFromTechNumber(num: string): "vero" | "stuart" | "orlando" | "naples" {
  const n = (num || "").replace(/\D/g, "");
  if (n.length >= 3) {
    if (n.startsWith("2")) return "stuart";
    if (n.startsWith("3")) return "orlando";
    if (n.startsWith("4")) return "naples";
  }
  return "vero";
}
