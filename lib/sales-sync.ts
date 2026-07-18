import { prisma } from "@/lib/prisma";

// Sales Center sync. Reads the hourly-updated Google Sheet (opportunity-level
// export) as CSV, rolls it up into branch / rep / source / month metrics, and
// stores a snapshot the dashboard reads. Live in production (Vercel can reach
// Google); the dev sandbox's network blocks docs.google.com.

const DEFAULT_SHEET = "https://docs.google.com/spreadsheets/d/1adUpkFNWhZvLG_FDnzpLcDWrqNx0Jdw-lIDXLCp9_BA/edit";

/** Turn any Google Sheets URL into a CSV export URL for the first tab. */
export function toCsvUrl(url: string): string {
  const m = url.match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/);
  const id = m?.[1];
  if (!id) return url;
  const gid = url.match(/[#&?]gid=(\d+)/)?.[1] ?? "0";
  return `https://docs.google.com/spreadsheets/d/${id}/export?format=csv&gid=${gid}`;
}

export async function salesSheetUrl(): Promise<string> {
  if (process.env.SALES_SHEET_URL) return process.env.SALES_SHEET_URL;
  const s = await prisma.setting.findUnique({ where: { key: "sales_sheet_url" } }).catch(() => null);
  return s?.value || DEFAULT_SHEET;
}

// ---- CSV parsing -----------------------------------------------------------

/** Minimal RFC-4180 CSV parser (quoted fields, embedded commas/newlines). */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [], field = "", inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else inQuotes = false; }
      else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ",") { row.push(field); field = ""; }
    else if (c === "\n") { row.push(field); rows.push(row); row = []; field = ""; }
    else if (c === "\r") { /* skip */ }
    else field += c;
  }
  if (field !== "" || row.length) { row.push(field); rows.push(row); }
  return rows;
}

export type Opportunity = {
  id: string;
  created: Date | null;
  closed: Date | null;
  branch: string; // normalized key
  owner: string;
  stage: string; // "won" | "lost" | "open"
  source: string;
  annualValue: number;
  totalValue: number;
  name: string;
  type: string;
};

const norm = (s: string) => (s ?? "").trim();
const mdY = (s: string): Date | null => {
  const m = norm(s).match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (!m) return null;
  const y = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
  return new Date(Date.UTC(y, Number(m[1]) - 1, Number(m[2])));
};
const money = (s: string) => { const n = Number(norm(s).replace(/[$,]/g, "")); return Number.isFinite(n) ? n : 0; };

export function normalizeBranch(raw: string): string {
  const t = (raw ?? "").toLowerCase();
  if (t.includes("vero")) return "vero";
  if (t.includes("stuart")) return "stuart";
  if (t.includes("orlando")) return "orlando";
  if (t.includes("naples")) return "naples";
  return "other";
}
function normalizeStage(stage: string): string {
  const t = (stage ?? "").toLowerCase();
  if (t.includes("won")) return "won";
  if (t.includes("lost")) return "lost";
  return "open";
}

export function extractOpportunities(rows: string[][]): Opportunity[] {
  if (rows.length < 2) return [];
  const header = rows[0].map((h) => h.trim().toLowerCase());
  const col = (name: string) => header.indexOf(name.toLowerCase());
  const ci = {
    id: col("Opportunity ID"), created: col("Opportunity Created Date"), closed: col("Closed Date"),
    branch: col("Branch"), owner: col("Owner"), stage: col("Stage"), source: col("Lead Source"),
    annual: col("Annual Value"), total: col("Total Value"), name: col("Opportunity Name"), type: col("Type"),
  };
  const out: Opportunity[] = [];
  for (let r = 1; r < rows.length; r++) {
    const row = rows[r];
    if (!row || row.every((c) => !c?.trim())) continue;
    const g = (i: number) => (i >= 0 && i < row.length ? row[i] : "");
    out.push({
      id: norm(g(ci.id)) || `row-${r}`,
      created: mdY(g(ci.created)),
      closed: mdY(g(ci.closed)),
      branch: normalizeBranch(g(ci.branch)),
      owner: norm(g(ci.owner)) || "Unassigned",
      stage: normalizeStage(g(ci.stage)),
      source: norm(g(ci.source)) || "Unknown",
      annualValue: money(g(ci.annual)),
      totalValue: money(g(ci.total)),
      name: norm(g(ci.name)),
      type: norm(g(ci.type)),
    });
  }
  return out;
}

// ---- Metrics ---------------------------------------------------------------

type PeriodStats = { leads: number; won: number; lost: number; closeRate: number | null; soldAnnual: number; soldTotal: number };

function emptyStats(): PeriodStats { return { leads: 0, won: 0, lost: 0, closeRate: null, soldAnnual: 0, soldTotal: 0 }; }
function finalizeCloseRate(s: PeriodStats) { const decided = s.won + s.lost; s.closeRate = decided > 0 ? (s.won / decided) * 100 : null; return s; }

/** Roll opportunities into the dashboard snapshot as of `now`. */
export function computeSalesMetrics(opps: Opportunity[], now: Date) {
  const y = now.getUTCFullYear(), mo = now.getUTCMonth();
  const monthStart = Date.UTC(y, mo, 1);
  const quarterStart = Date.UTC(y, Math.floor(mo / 3) * 3, 1);
  const yearStart = Date.UTC(y, 0, 1);
  const twelveStart = Date.UTC(y, mo - 11, 1);

  const inPeriod = (d: Date | null, start: number) => d != null && d.getTime() >= start && d.getTime() <= now.getTime();

  const tally = (start: number): PeriodStats => {
    const s = emptyStats();
    for (const o of opps) {
      if (inPeriod(o.created, start)) s.leads++;
      const cd = o.closed ?? o.created;
      if (inPeriod(cd, start)) {
        if (o.stage === "won") { s.won++; s.soldAnnual += o.annualValue; s.soldTotal += o.totalValue; }
        else if (o.stage === "lost") s.lost++;
      }
    }
    return finalizeCloseRate(s);
  };

  const mtd = tally(monthStart), qtd = tally(quarterStart), ytd = tally(yearStart);

  // Per branch (YTD).
  const BRANCHES = ["vero", "stuart", "orlando", "naples", "other"];
  const byBranch = BRANCHES.map((b) => {
    const s = emptyStats();
    for (const o of opps) {
      if (o.branch !== b) continue;
      if (inPeriod(o.created, yearStart)) s.leads++;
      const cd = o.closed ?? o.created;
      if (inPeriod(cd, yearStart)) {
        if (o.stage === "won") { s.won++; s.soldAnnual += o.annualValue; s.soldTotal += o.totalValue; }
        else if (o.stage === "lost") s.lost++;
      }
    }
    return { branch: b, ...finalizeCloseRate(s) };
  }).filter((b) => b.leads > 0 || b.won > 0 || b.lost > 0);

  // Per rep (YTD won).
  const repMap = new Map<string, { won: number; soldAnnual: number }>();
  for (const o of opps) {
    const cd = o.closed ?? o.created;
    if (o.stage === "won" && inPeriod(cd, yearStart)) {
      const e = repMap.get(o.owner) ?? { won: 0, soldAnnual: 0 };
      e.won++; e.soldAnnual += o.annualValue; repMap.set(o.owner, e);
    }
  }
  const byRep = [...repMap.entries()].map(([owner, e]) => ({ owner, ...e })).sort((a, b) => b.soldAnnual - a.soldAnnual).slice(0, 12);

  // Per lead source (YTD won).
  const srcMap = new Map<string, { won: number; soldAnnual: number }>();
  for (const o of opps) {
    const cd = o.closed ?? o.created;
    if (o.stage === "won" && inPeriod(cd, yearStart)) {
      const e = srcMap.get(o.source) ?? { won: 0, soldAnnual: 0 };
      e.won++; e.soldAnnual += o.annualValue; srcMap.set(o.source, e);
    }
  }
  const bySource = [...srcMap.entries()].map(([source, e]) => ({ source, ...e })).sort((a, b) => b.soldAnnual - a.soldAnnual).slice(0, 10);

  // Monthly trend (last 12 months) by closed-won.
  const months: { month: string; leads: number; won: number; soldAnnual: number }[] = [];
  for (let i = 0; i < 12; i++) {
    const d = new Date(Date.UTC(y, mo - 11 + i, 1));
    months.push({ month: `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`, leads: 0, won: 0, soldAnnual: 0 });
  }
  const idx = new Map(months.map((m, i) => [m.month, i]));
  const key = (d: Date) => `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
  for (const o of opps) {
    if (o.created && o.created.getTime() >= twelveStart) { const i = idx.get(key(o.created)); if (i != null) months[i].leads++; }
    const cd = o.closed ?? o.created;
    if (o.stage === "won" && cd && cd.getTime() >= twelveStart) { const i = idx.get(key(cd)); if (i != null) { months[i].won++; months[i].soldAnnual += o.annualValue; } }
  }

  // Recent won.
  const recentWon = opps.filter((o) => o.stage === "won" && (o.closed ?? o.created))
    .sort((a, b) => (b.closed ?? b.created)!.getTime() - (a.closed ?? a.created)!.getTime())
    .slice(0, 15)
    .map((o) => ({ date: (o.closed ?? o.created)!.toISOString(), name: o.name, branch: o.branch, owner: o.owner, annualValue: o.annualValue }));

  const openPipeline = opps.filter((o) => o.stage === "open").reduce((s, o) => s + o.annualValue, 0);

  return { mtd, qtd, ytd, byBranch, byRep, bySource, months, recentWon, openPipeline, totalRows: opps.length };
}

export type SalesMetrics = ReturnType<typeof computeSalesMetrics>;

// ---- Sync ------------------------------------------------------------------

export async function fetchSalesCsv(url: string): Promise<string> {
  const res = await fetch(toCsvUrl(url), { redirect: "follow", headers: { "user-agent": "ClementsCC/1.0" } });
  if (!res.ok) throw new Error(`Sheet fetch failed (${res.status}). Ensure the sheet is shared "Anyone with the link".`);
  const text = await res.text();
  if (/<html|<!doctype/i.test(text.slice(0, 200))) throw new Error('Got a login page instead of CSV — set the sheet to "Anyone with the link – Viewer".');
  return text;
}

export async function syncSalesFromSheet(prisma: import("@prisma/client").PrismaClient) {
  const url = await salesSheetUrl();
  try {
    const csv = await fetchSalesCsv(url);
    const opps = extractOpportunities(parseCsv(csv));
    const metrics = computeSalesMetrics(opps, new Date());
    await prisma.salesSnapshot.create({ data: { rowCount: opps.length, status: "ok", data: JSON.stringify(metrics) } });
    // Keep only the latest few snapshots.
    const old = await prisma.salesSnapshot.findMany({ orderBy: { syncedAt: "desc" }, skip: 5, select: { id: true } });
    if (old.length) await prisma.salesSnapshot.deleteMany({ where: { id: { in: old.map((o) => o.id) } } });
    return { ok: true, rows: opps.length };
  } catch (e) {
    await prisma.salesSnapshot.create({ data: { rowCount: 0, status: "error", error: (e as Error).message, data: "{}" } }).catch(() => {});
    return { ok: false, error: (e as Error).message };
  }
}

export async function latestSalesSnapshot() {
  const snap = await prisma.salesSnapshot.findFirst({ where: { status: "ok" }, orderBy: { syncedAt: "desc" } });
  const lastAttempt = await prisma.salesSnapshot.findFirst({ orderBy: { syncedAt: "desc" } });
  if (!snap) return { metrics: null as SalesMetrics | null, syncedAt: null as Date | null, lastError: lastAttempt?.status === "error" ? lastAttempt.error : null };
  return { metrics: JSON.parse(snap.data) as SalesMetrics, syncedAt: snap.syncedAt, lastError: lastAttempt?.status === "error" ? lastAttempt.error : null };
}
