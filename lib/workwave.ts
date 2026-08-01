import "server-only";
import { prisma } from "@/lib/prisma";
import {
  normalizeBranch,
  computeSalesMetrics,
  type Opportunity,
  type SalesMetrics,
} from "@/lib/sales-sync";

/**
 * WorkWave Sales Center (Marketing) API — server-side connector.
 *
 * Pulls opportunity-level sales data straight from WorkWave instead of the
 * hourly Google-Sheet export, then maps each record into the SAME `Opportunity`
 * shape lib/sales-sync already rolls up. That means the whole Sales dashboard
 * (branch/rep/source/month rollups, close rates, pipeline) works unchanged — we
 * only swap the data source.
 *
 * SECURITY: the API key + tenant id come from env ONLY (never hardcoded, never
 * sent to the browser). This module imports "server-only" so it can't be bundled
 * client-side.
 *
 * Confirmed against the OpenAPI 3.0.1 spec at api.marketing.workwave.com/swagger:
 *   - Endpoint: GET /public/searchOpportunity (OData — $top/$skip/$orderby/$filter;
 *     NO page/pageSize/cursor params). Returns OpportunityCardDTO rows.
 *   - Auth: a single "Bearer" scheme (apiKey in header `Authorization`, value
 *     "Bearer <JWT>") applied to every operation.
 *   - Tenant: NOT a request input — it is embedded in the per-tenant JWT. There is
 *     no tenantId/accountId param or header, so we send none.
 *
 * Config (Vercel → Environment Variables → Production):
 *   WORKWAVE_API_KEY        required — the per-tenant Bearer token (JWT) WorkWave issued
 *   WORKWAVE_API_BASE       optional — defaults to https://api.marketing.workwave.com
 *   WORKWAVE_OPPORTUNITIES_PATH  optional — defaults to /public/searchOpportunity
 *   WORKWAVE_AUTH_HEADER    optional — header the token rides in (default "Authorization")
 *   WORKWAVE_AUTH_SCHEME    optional — prefix before the token (default "Bearer ")
 *   WORKWAVE_SEARCH_METHOD  optional — "GET" (default) or "POST" for searchOpportunity
 *   WORKWAVE_SEARCH_BODY    optional — JSON filter body when method is POST (default "{}")
 *   WORKWAVE_PAGE_SIZE      optional — OData $top per request (default 50)
 */

const API_KEY = process.env.WORKWAVE_API_KEY ?? "";
const API_BASE = (process.env.WORKWAVE_API_BASE || "https://api.marketing.workwave.com").replace(/\/+$/, "");
const OPPORTUNITIES_PATH = process.env.WORKWAVE_OPPORTUNITIES_PATH || "/public/searchOpportunity";
const AUTH_HEADER = process.env.WORKWAVE_AUTH_HEADER || "Authorization";
const AUTH_SCHEME = process.env.WORKWAVE_AUTH_SCHEME ?? "Bearer ";
// searchOpportunity is exposed as BOTH GET (OData) and POST (JSON filter body).
// The bare GET throws a .NET NullReferenceException (500) — it dereferences a
// filter object that only exists on the POST path. So POST with a filter body is
// the working path and is the DEFAULT. The default body sets the known filter
// fields (sales funnel + opportunity status) to empty arrays — "no restriction /
// all" — so nothing is null server-side. A superset of likely field names is
// sent; unknown JSON properties are ignored by .NET model binding, so extra keys
// are harmless while whichever real field exists gets a non-null value.
const SEARCH_METHOD = (process.env.WORKWAVE_SEARCH_METHOD || "POST").toUpperCase();
const DEFAULT_SEARCH_BODY = JSON.stringify({
  salesFunnelIds: [],
  salesFunnels: [],
  opportunityStatusIds: [],
  opportunityStatuses: [],
  statuses: [],
});
const SEARCH_BODY = process.env.WORKWAVE_SEARCH_BODY || DEFAULT_SEARCH_BODY;

const FETCH_TIMEOUT_MS = 20 * 1000;
const MAX_PAGES = 200; // hard backstop so a bad response can't loop forever
const PAGE_SIZE = Number(process.env.WORKWAVE_PAGE_SIZE || 50); // OData $top per request

/** Live only when the Bearer token is present. The tenant is carried inside the
 *  token itself, so no separate tenant config is required. */
export function isConfigured(): boolean {
  return Boolean(API_KEY);
}

export class WorkwaveError extends Error {
  status: number;
  /** Raw response body from WorkWave (truncated) — surfaced so a 500 shows WHY. */
  body?: string;
  constructor(message: string, status: number, body?: string) {
    super(message);
    this.name = "WorkwaveError";
    this.status = status;
    this.body = body;
  }
}

function authHeaders(): Record<string, string> {
  return {
    Accept: "application/json",
    [AUTH_HEADER]: `${AUTH_SCHEME}${API_KEY}`,
  };
}

async function fetchWithTimeout(url: string, init: RequestInit = {}, timeoutMs = FETCH_TIMEOUT_MS): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const headers = { ...authHeaders(), ...(init.headers as Record<string, string> | undefined) };
  try {
    return await fetch(url, { cache: "no-store", ...init, headers, signal: controller.signal });
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      throw new WorkwaveError(`WorkWave request timed out after ${timeoutMs}ms`, 504);
    }
    throw new WorkwaveError(`WorkWave request failed: ${err instanceof Error ? err.message : "network error"}`, 502);
  } finally {
    clearTimeout(timer);
  }
}

// ---- lenient field pickers (response field names vary; parse defensively) ----

function pickStr(o: Record<string, unknown>, keys: string[]): string | undefined {
  for (const k of keys) {
    const v = o[k];
    if (typeof v === "string" && v.trim() !== "") return v;
    if (typeof v === "number") return String(v);
  }
  return undefined;
}
function pickNum(o: Record<string, unknown>, keys: string[]): number {
  for (const k of keys) {
    const v = o[k];
    if (typeof v === "number" && Number.isFinite(v)) return v;
    if (typeof v === "string") {
      const n = Number(v.replace(/[$,]/g, ""));
      if (Number.isFinite(n) && v.trim() !== "") return n;
    }
  }
  return 0;
}
function pickDate(o: Record<string, unknown>, keys: string[]): Date | null {
  for (const k of keys) {
    const v = o[k];
    if (typeof v === "string" && v.trim() !== "") {
      const d = new Date(v);
      if (!Number.isNaN(d.getTime())) return d;
    }
  }
  return null;
}

function normalizeStage(raw: string | undefined): string {
  const t = (raw ?? "").toLowerCase();
  if (t.includes("won") || t.includes("sold") || t.includes("closed win") || t === "closedwon") return "won";
  if (t.includes("lost") || t.includes("dead") || t.includes("closed lose") || t === "closedlost") return "lost";
  return "open";
}

/**
 * Map one WorkWave OpportunityCardDTO / Opportunity record into our canonical
 * Opportunity shape. Field names follow the swagger's Opportunity entity, with
 * lenient fallbacks. NOTE: deal value is NOT a top-level field in WorkWave — it
 * derives from the related OpportunityProduct list; the search card may expose a
 * rolled-up value under one of the value keys below, otherwise value reads 0 and
 * we confirm/adjust from the diagnostics live-pull.
 */
export function mapOpportunity(raw: unknown, i: number): Opportunity | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const id = pickStr(o, ["id", "opportunityId", "opportunityID", "OpportunityId", "guid"]) ?? `ww-${i}`;
  // WorkWave "division" is the branch/office; may arrive as a name or just an id.
  const branchRaw = pickStr(o, ["division", "divisionName", "branch", "branchName", "location", "locationName", "office", "territory"]) ?? "";
  // Stage lives on the sales-funnel stage (custom-named) or an opportunity status.
  const stageRaw = pickStr(o, ["salesFunnelStage", "salesFunnelStageName", "stage", "stageName", "status", "opportunityStatus", "state"]);
  return {
    id,
    created: pickDate(o, ["createdTime", "createdDate", "created", "createdAt", "dateCreated", "createdOn"]),
    closed: pickDate(o, ["closedDate", "closed", "closedAt", "dateClosed", "wonDate", "closedOn"]),
    branch: normalizeBranch(branchRaw),
    owner: pickStr(o, ["assignee", "assigneeName", "owner", "ownerName", "assignedTo", "salesRep", "rep"]) ?? "Unassigned",
    stage: normalizeStage(stageRaw),
    source: pickStr(o, ["leadSource", "leadSourceName", "source", "sourceName", "marketingSource", "channel"]) ?? "Unknown",
    annualValue: pickNum(o, ["annualValue", "annualRecurringValue", "annualRevenue", "arr", "recurringValue", "annual"]),
    totalValue: pickNum(o, ["totalValue", "value", "amount", "opportunityValue", "estimatedValue", "contractValue", "total", "totalRevenue"]),
    name: pickStr(o, ["name", "opportunityName", "title", "customerName", "accountName"]) ?? "",
    type: pickStr(o, ["type", "opportunityType", "serviceType", "category", "salesFunnel", "salesFunnelName"]) ?? "",
  };
}

/** A page may be a bare array or an object wrapping one under a common key. */
function extractRecords(json: unknown): unknown[] {
  if (Array.isArray(json)) return json;
  if (json && typeof json === "object") {
    const o = json as Record<string, unknown>;
    for (const k of ["items", "data", "results", "opportunities", "records", "content", "value"]) {
      if (Array.isArray(o[k])) return o[k] as unknown[];
    }
  }
  return [];
}

/**
 * Fetch every opportunity via OData paging ($top + $skip). The endpoint exposes
 * no page/cursor params, so we walk offsets until a short (or empty) page tells
 * us we've reached the end. MAX_PAGES is a hard backstop.
 */
export async function fetchOpportunities(): Promise<Opportunity[]> {
  if (!isConfigured()) throw new WorkwaveError("WorkWave is not configured", 0);
  const out: Opportunity[] = [];
  const seen = new Set<string>();

  for (let i = 0; i < MAX_PAGES; i++) {
    const qs = new URLSearchParams();
    qs.set("$top", String(PAGE_SIZE));
    qs.set("$skip", String(i * PAGE_SIZE));

    const init: RequestInit =
      SEARCH_METHOD === "POST"
        ? { method: "POST", headers: { "content-type": "application/json" }, body: SEARCH_BODY }
        : { method: "GET" };
    const res = await fetchWithTimeout(`${API_BASE}${OPPORTUNITIES_PATH}?${qs.toString()}`, init);
    if (!res.ok) {
      // Capture WorkWave's raw error body so a 500 shows the actual reason.
      const body = (await res.text().catch(() => "")).slice(0, 600);
      throw new WorkwaveError(`WorkWave ${SEARCH_METHOD} ${OPPORTUNITIES_PATH} failed (${res.status})`, res.status, body);
    }
    const text = await res.text();
    let json: unknown = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      throw new WorkwaveError(`WorkWave GET ${OPPORTUNITIES_PATH} returned non-JSON`, 502);
    }

    const records = extractRecords(json);
    let added = 0;
    for (const r of records) {
      const opp = mapOpportunity(r, out.length);
      if (!opp) continue;
      // Dedupe by id — guards against a POST search that ignores $skip and keeps
      // returning the same page (which would otherwise loop to MAX_PAGES and
      // inflate the rollup with duplicates).
      if (seen.has(opp.id)) continue;
      seen.add(opp.id);
      out.push(opp);
      added++;
    }

    // Stop when a page is short OR contributed no new records (paging exhausted,
    // or the endpoint isn't honoring $skip).
    if (records.length < PAGE_SIZE || added === 0) break;
  }
  return out;
}

// ---- Sync ------------------------------------------------------------------

/**
 * Pull from WorkWave, roll up with the shared metrics engine, and store a
 * SalesSnapshot the dashboard reads. Records the source so we can tell a live
 * WorkWave sync from the legacy sheet import. Never throws — errors are captured
 * into an error snapshot and returned.
 */
export async function syncWorkwaveSales(): Promise<{ ok: boolean; rows?: number; error?: string }> {
  try {
    const opps = await fetchOpportunities();
    const metrics = computeSalesMetrics(opps, new Date());
    await prisma.salesSnapshot.create({
      data: { rowCount: opps.length, status: "ok", data: JSON.stringify({ ...metrics, source: "workwave" }) },
    });
    const old = await prisma.salesSnapshot.findMany({ orderBy: { syncedAt: "desc" }, skip: 5, select: { id: true } });
    if (old.length) await prisma.salesSnapshot.deleteMany({ where: { id: { in: old.map((o) => o.id) } } });
    return { ok: true, rows: opps.length };
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    await prisma.salesSnapshot
      .create({ data: { rowCount: 0, status: "error", error: `WorkWave: ${error}`.slice(0, 500), data: "{}" } })
      .catch(() => {});
    return { ok: false, error };
  }
}

export type WorkwaveStatus = {
  configured: boolean;
  base: string;
  opportunitiesPath: string;
  authScheme: string;
};

export function workwaveStatus(): WorkwaveStatus {
  return {
    configured: isConfigured(),
    base: API_BASE,
    opportunitiesPath: OPPORTUNITIES_PATH,
    authScheme: `${AUTH_HEADER}: ${AUTH_SCHEME}<token>`,
  };
}

export type { SalesMetrics };
