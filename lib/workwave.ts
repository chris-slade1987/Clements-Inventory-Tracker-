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
 * Config (Vercel → Environment Variables → Production):
 *   WORKWAVE_API_KEY        required — key WorkWave issued (format AAAA-AAAA-AAAA-AAAA)
 *   WORKWAVE_TENANT_ID      required for multi-tenant accounts — your Sales Center tenant/account id
 *   WORKWAVE_API_BASE       optional — defaults to https://api.marketing.workwave.com
 *   WORKWAVE_OPPORTUNITIES_PATH  optional — endpoint path (default below); override once confirmed from swagger
 *   WORKWAVE_AUTH_HEADER    optional — header the key rides in (default "Authorization")
 *   WORKWAVE_AUTH_SCHEME    optional — prefix before the key (default "Bearer "; set "" for a bare key / X-API-Key style)
 *   WORKWAVE_TENANT_HEADER  optional — header the tenant id rides in (default "X-Tenant-Id")
 */

const API_KEY = process.env.WORKWAVE_API_KEY ?? "";
const TENANT_ID = process.env.WORKWAVE_TENANT_ID ?? "";
const API_BASE = (process.env.WORKWAVE_API_BASE || "https://api.marketing.workwave.com").replace(/\/+$/, "");
// Best-guess default; overridable via env once the exact path is confirmed from
// the swagger (api.marketing.workwave.com/swagger).
const OPPORTUNITIES_PATH = process.env.WORKWAVE_OPPORTUNITIES_PATH || "/api/v1/opportunities";
const AUTH_HEADER = process.env.WORKWAVE_AUTH_HEADER || "Authorization";
const AUTH_SCHEME = process.env.WORKWAVE_AUTH_SCHEME ?? "Bearer ";
const TENANT_HEADER = process.env.WORKWAVE_TENANT_HEADER || "X-Tenant-Id";

const FETCH_TIMEOUT_MS = 20 * 1000;
const MAX_PAGES = 200; // hard backstop so a bad pagination cursor can't loop forever
const PAGE_SIZE = 200;

/** Live only when the API key is present. Tenant id is required by most accounts
 *  but some single-tenant keys don't need it — so we gate on the key alone and
 *  send the tenant header only when configured. */
export function isConfigured(): boolean {
  return Boolean(API_KEY);
}

export class WorkwaveError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "WorkwaveError";
    this.status = status;
  }
}

function authHeaders(): Record<string, string> {
  const h: Record<string, string> = {
    Accept: "application/json",
    [AUTH_HEADER]: `${AUTH_SCHEME}${API_KEY}`,
  };
  if (TENANT_ID) h[TENANT_HEADER] = TENANT_ID;
  return h;
}

async function fetchWithTimeout(url: string, timeoutMs = FETCH_TIMEOUT_MS): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { method: "GET", headers: authHeaders(), cache: "no-store", signal: controller.signal });
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

/** Map one WorkWave opportunity record into our canonical Opportunity shape. */
export function mapOpportunity(raw: unknown, i: number): Opportunity | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const id = pickStr(o, ["id", "opportunityId", "opportunityID", "OpportunityId", "guid"]) ?? `ww-${i}`;
  const branchRaw = pickStr(o, ["branch", "branchName", "location", "locationName", "office", "territory"]) ?? "";
  const stageRaw = pickStr(o, ["stage", "status", "opportunityStatus", "pipelineStage", "state"]);
  return {
    id,
    created: pickDate(o, ["createdDate", "created", "createdAt", "dateCreated", "opportunityCreatedDate", "createdOn"]),
    closed: pickDate(o, ["closedDate", "closed", "closedAt", "dateClosed", "wonDate", "closedOn"]),
    branch: normalizeBranch(branchRaw),
    owner: pickStr(o, ["owner", "ownerName", "assignedTo", "salesRep", "rep", "assignedUser"]) ?? "Unassigned",
    stage: normalizeStage(stageRaw),
    source: pickStr(o, ["leadSource", "source", "sourceName", "marketingSource", "channel"]) ?? "Unknown",
    annualValue: pickNum(o, ["annualValue", "annualRevenue", "annualRecurringValue", "arr", "annual"]),
    totalValue: pickNum(o, ["totalValue", "value", "amount", "contractValue", "total", "totalRevenue"]),
    name: pickStr(o, ["name", "opportunityName", "title", "customerName", "accountName"]) ?? "",
    type: pickStr(o, ["type", "opportunityType", "serviceType", "category"]) ?? "",
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

/** Detect a "there are more pages" signal + optional next cursor, defensively. */
function nextPageInfo(json: unknown, pageRecords: number): { hasMore: boolean; cursor?: string } {
  if (!json || typeof json !== "object") return { hasMore: pageRecords >= PAGE_SIZE };
  const o = json as Record<string, unknown>;
  const cursor = pickStr(o, ["nextCursor", "next", "continuationToken", "nextPageToken"]);
  if (cursor) return { hasMore: true, cursor };
  const hasMoreFlag = o.hasMore ?? o.hasNextPage ?? o.hasNext;
  if (typeof hasMoreFlag === "boolean") return { hasMore: hasMoreFlag };
  const page = pickNum(o, ["page", "pageNumber", "currentPage"]);
  const totalPages = pickNum(o, ["totalPages", "pageCount"]);
  if (totalPages > 0) return { hasMore: page > 0 && page < totalPages };
  // Fall back to "a full page means probably more".
  return { hasMore: pageRecords >= PAGE_SIZE };
}

/** Fetch every opportunity, following pagination (page-number or cursor based). */
export async function fetchOpportunities(): Promise<Opportunity[]> {
  if (!isConfigured()) throw new WorkwaveError("WorkWave is not configured", 0);
  const out: Opportunity[] = [];
  let page = 1;
  let cursor: string | undefined;

  for (let i = 0; i < MAX_PAGES; i++) {
    const qs = new URLSearchParams();
    qs.set("pageSize", String(PAGE_SIZE));
    if (cursor) qs.set("cursor", cursor);
    else qs.set("page", String(page));
    if (TENANT_ID) qs.set("tenantId", TENANT_ID); // harmless when the API ignores it; some accounts want it as a query param

    const res = await fetchWithTimeout(`${API_BASE}${OPPORTUNITIES_PATH}?${qs.toString()}`);
    if (!res.ok) {
      throw new WorkwaveError(`WorkWave GET ${OPPORTUNITIES_PATH} failed (${res.status})`, res.status);
    }
    const text = await res.text();
    let json: unknown = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      throw new WorkwaveError(`WorkWave GET ${OPPORTUNITIES_PATH} returned non-JSON`, 502);
    }

    const records = extractRecords(json);
    for (const r of records) {
      const opp = mapOpportunity(r, out.length);
      if (opp) out.push(opp);
    }

    const info = nextPageInfo(json, records.length);
    if (!info.hasMore || records.length === 0) break;
    if (info.cursor) cursor = info.cursor;
    else page += 1;
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
  tenantConfigured: boolean;
  base: string;
  opportunitiesPath: string;
};

export function workwaveStatus(): WorkwaveStatus {
  return {
    configured: isConfigured(),
    tenantConfigured: Boolean(TENANT_ID),
    base: API_BASE,
    opportunitiesPath: OPPORTUNITIES_PATH,
  };
}

export type { SalesMetrics };
