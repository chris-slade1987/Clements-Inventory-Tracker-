import "server-only";
import { prisma } from "@/lib/prisma";
import { BRANCHES } from "@/lib/management";
import { LEAD_CHANNELS } from "@/lib/sales-leads";

/**
 * SmarterLaunch API connector (v1) — server-side.
 *
 * SmarterLaunch is the sales CRM. In SmarterLaunch there are no "leads": a lead =
 * a customer + a proposal. We map each PROPOSAL into one `SalesLead` row
 * (`origin="smarterlaunch"`, `externalId` = the proposal uuid) so the existing
 * Sales-Team heat map / lead-source board read it unchanged.
 *
 * DESIGN: webhook-first + one modest daily backfill. There is a HARD BUDGET of
 * 250 API calls/day per company, so we NEVER call the API from a page render; the
 * live feed is the outbound webhook, and the backfill is a small, quota-aware
 * safety net. Quota is read from the per-response headers and persisted so
 * diagnostics can show it.
 *
 * Docs facts baked in here:
 *   - Base `https://api.smarterlaunch.com/api/v1`.
 *   - Auth header is `X-API-Key` (key prefix `sl_live_`). `Authorization: Bearer`
 *     is REJECTED — we never send it.
 *   - Every response is an envelope `{status, code, msg, version, data}`; list
 *     endpoints paginate with `page`/`page_size` and return `current_page`,
 *     `per_page`, `total`.
 *   - Quota headers on every response: `X-Company-Api-Limit` /
 *     `X-Company-Api-Remaining` / `X-Company-Api-Reset`.
 *   - `429` with body `rate_limit.scope` = `company` | `api_key` → STOP until
 *     reset. A route-throttle `429` carries `Retry-After` — honor it (one retry).
 *
 * SECURITY: the API key + webhook secret come from env ONLY (never hardcoded,
 * never sent to the browser, never logged — only booleans/prefixes are logged).
 * This module imports "server-only" so it can never be client-bundled.
 */

const API_KEY = process.env.SMARTERLAUNCH_API_KEY ?? "";
const WEBHOOK_SECRET = process.env.SMARTERLAUNCH_WEBHOOK_SECRET ?? "";
const COMPANY_UUID = process.env.SMARTERLAUNCH_COMPANY_UUID ?? "";
const BASE = (process.env.SMARTERLAUNCH_API_BASE || "https://api.smarterlaunch.com/api/v1").replace(/\/+$/, "");

// include_fields string for the proposal list/detail so one call carries the
// customer, pricing, referral source, assigned user and location inline (keeps us
// far under the daily budget). Unknown fields are ignored server-side, so a
// superset is harmless; override via env if SmarterLaunch names them differently.
const INCLUDE_FIELDS =
  process.env.SMARTERLAUNCH_INCLUDE_FIELDS ||
  "customer,customer_contacts,customer_addresses,line_items,service_plans,referral_source,assigned_user,referral_user,company_location,status";

const FETCH_TIMEOUT_MS = 20 * 1000;
const QUOTA_SETTING_KEY = "smarterlaunch:quota";
// Stop a backfill well short of the 250/day ceiling: never dip remaining below this.
const BUDGET_FLOOR = 40;

/** Live only when all three secrets are present (mirrors WorkWave/Coast gates). */
export function smarterLaunchConfigured(): boolean {
  return Boolean(API_KEY && WEBHOOK_SECRET && COMPANY_UUID);
}

/** The raw webhook secret (server-only; callers compare it constant-time). */
export function webhookSecretConfigured(): boolean {
  return Boolean(WEBHOOK_SECRET);
}
export function getWebhookSecret(): string {
  return WEBHOOK_SECRET;
}

export class SmarterLaunchError extends Error {
  status: number;
  body?: string;
  constructor(message: string, status: number, body?: string) {
    super(message);
    this.name = "SmarterLaunchError";
    this.status = status;
    this.body = body;
  }
}

/** Thrown when the API says to STOP until reset (company/api_key scoped 429). */
export class SmarterLaunchRateLimitError extends SmarterLaunchError {
  scope: string;
  resetAt: string | null;
  constructor(scope: string, resetAt: string | null, body?: string) {
    super(`SmarterLaunch rate limit hit (scope=${scope})`, 429, body);
    this.name = "SmarterLaunchRateLimitError";
    this.scope = scope;
    this.resetAt = resetAt;
  }
}

// ---- Quota tracking --------------------------------------------------------

export type SmarterLaunchQuota = {
  limit: number | null;
  remaining: number | null;
  reset: string | null; // raw header value (epoch or ISO, as sent)
  at: string; // when we recorded it
};

function parseHeaderNum(v: string | null): number | null {
  if (v == null || v.trim() === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/** Persist the last-seen quota headers so diagnostics can show the budget. */
async function recordQuota(headers: Headers): Promise<void> {
  const limit = parseHeaderNum(headers.get("x-company-api-limit"));
  const remaining = parseHeaderNum(headers.get("x-company-api-remaining"));
  const reset = headers.get("x-company-api-reset");
  if (limit == null && remaining == null && !reset) return; // nothing useful
  const quota: SmarterLaunchQuota = { limit, remaining, reset: reset || null, at: new Date().toISOString() };
  await prisma.setting
    .upsert({ where: { key: QUOTA_SETTING_KEY }, create: { key: QUOTA_SETTING_KEY, value: JSON.stringify(quota) }, update: { value: JSON.stringify(quota) } })
    .catch(() => {});
}

/** The last-seen quota (null if we've never made a call). */
export async function getStoredQuota(): Promise<SmarterLaunchQuota | null> {
  const row = await prisma.setting.findUnique({ where: { key: QUOTA_SETTING_KEY } }).catch(() => null);
  if (!row?.value) return null;
  try {
    return JSON.parse(row.value) as SmarterLaunchQuota;
  } catch {
    return null;
  }
}

/**
 * Best-effort pre-call budget check: refuse a call only when the stored quota
 * clearly shows we're at/below the safety floor AND the reset is still in the
 * future. Optimistic otherwise (a bad/absent reading never blocks the webhook).
 */
export async function hasBudget(floor = BUDGET_FLOOR): Promise<boolean> {
  const q = await getStoredQuota();
  if (!q || q.remaining == null) return true;
  if (q.remaining > floor) return true;
  // remaining is low — only block if the window hasn't reset yet.
  if (q.reset) {
    const resetMs = /^\d+$/.test(q.reset) ? Number(q.reset) * 1000 : Date.parse(q.reset);
    if (Number.isFinite(resetMs) && resetMs < Date.now()) return true; // window already reset
  }
  return false;
}

// ---- Core request ----------------------------------------------------------

function authHeaders(): Record<string, string> {
  // X-API-Key ONLY. Authorization: Bearer is rejected by SmarterLaunch.
  return { Accept: "application/json", "X-API-Key": API_KEY };
}

async function fetchWithTimeout(url: string, init: RequestInit = {}, timeoutMs = FETCH_TIMEOUT_MS): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const headers = { ...authHeaders(), ...(init.headers as Record<string, string> | undefined) };
  try {
    return await fetch(url, { cache: "no-store", ...init, headers, signal: controller.signal });
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      throw new SmarterLaunchError(`SmarterLaunch request timed out after ${timeoutMs}ms`, 504);
    }
    throw new SmarterLaunchError(`SmarterLaunch request failed: ${err instanceof Error ? err.message : "network error"}`, 502);
  } finally {
    clearTimeout(timer);
  }
}

type Envelope<T> = { status?: unknown; code?: unknown; msg?: unknown; version?: unknown; data?: T };

/**
 * GET a path and return the unwrapped `data`. Records quota from every response.
 * Handles 429: a company/api_key-scoped limit throws SmarterLaunchRateLimitError
 * (caller STOPS until reset); a route throttle honors `Retry-After` and retries
 * once. Never sends `Authorization: Bearer`.
 */
async function apiGet<T = unknown>(path: string, query?: Record<string, string | number | undefined>): Promise<T> {
  if (!API_KEY) throw new SmarterLaunchError("SmarterLaunch API key is not configured", 0, path);
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(query ?? {})) if (v !== undefined && v !== "") qs.set(k, String(v));
  const url = `${BASE}${path}${qs.toString() ? `?${qs.toString()}` : ""}`;

  let res = await fetchWithTimeout(url);
  await recordQuota(res.headers);

  if (res.status === 429) {
    const bodyText = (await res.text().catch(() => "")).slice(0, 500);
    const scope = parseRateLimitScope(bodyText);
    if (scope === "company" || scope === "api_key") {
      throw new SmarterLaunchRateLimitError(scope, res.headers.get("x-company-api-reset"), bodyText);
    }
    // Route throttle: honor Retry-After, one retry.
    const ra = Number(res.headers.get("retry-after"));
    await new Promise((r) => setTimeout(r, Number.isFinite(ra) && ra > 0 ? Math.min(ra, 10) * 1000 : 2000));
    res = await fetchWithTimeout(url);
    await recordQuota(res.headers);
  }

  if (!res.ok) {
    const body = (await res.text().catch(() => "")).slice(0, 400);
    throw new SmarterLaunchError(`SmarterLaunch GET ${path} failed (${res.status})`, res.status, body);
  }
  const text = await res.text();
  const json = (text ? JSON.parse(text) : {}) as Envelope<T>;
  // Unwrap the standard envelope; tolerate a bare body just in case.
  return (json && typeof json === "object" && "data" in json ? (json.data as T) : (json as unknown as T));
}

function parseRateLimitScope(body: string): string | null {
  try {
    const j = JSON.parse(body) as Record<string, unknown>;
    const rl = (j.rate_limit ?? (j.data as Record<string, unknown> | undefined)?.rate_limit) as Record<string, unknown> | undefined;
    const scope = rl?.scope;
    return typeof scope === "string" ? scope : null;
  } catch {
    return null;
  }
}

// ---- Typed-ish endpoint wrappers (shapes are tolerant) ---------------------

export type ProposalListResult = { items: Record<string, unknown>[]; page: number; perPage: number; total: number };

/** One page of proposals. `data` may be a bare array or `{items|data|proposals|results, current_page, per_page, total}`. */
export async function fetchProposalsPage(opts: {
  page?: number;
  pageSize?: number;
  dateRangeStart?: string;
  dateRangeEnd?: string;
  dateRangeType?: string;
  sortBy?: string;
  includeFields?: string;
}): Promise<ProposalListResult> {
  const data = await apiGet<unknown>("/proposals", {
    page: opts.page ?? 1,
    page_size: opts.pageSize ?? 50,
    date_range_start: opts.dateRangeStart,
    date_range_end: opts.dateRangeEnd,
    date_range_type: opts.dateRangeType,
    sort_by: opts.sortBy ?? "created_at",
    include_fields: opts.includeFields ?? INCLUDE_FIELDS,
  });
  return normalizeList(data, opts.page ?? 1, opts.pageSize ?? 50);
}

function normalizeList(data: unknown, page: number, pageSize: number): ProposalListResult {
  if (Array.isArray(data)) return { items: data as Record<string, unknown>[], page, perPage: pageSize, total: data.length };
  if (data && typeof data === "object") {
    const o = data as Record<string, unknown>;
    let items: Record<string, unknown>[] = [];
    for (const k of ["items", "data", "proposals", "results", "records", "content"]) {
      if (Array.isArray(o[k])) {
        items = o[k] as Record<string, unknown>[];
        break;
      }
    }
    return {
      items,
      page: pickNum(o, ["current_page", "page"]) || page,
      perPage: pickNum(o, ["per_page", "page_size"]) || pageSize,
      total: pickNum(o, ["total", "total_count", "count"]) || items.length,
    };
  }
  return { items: [], page, perPage: pageSize, total: 0 };
}

export async function fetchProposal(uuid: string): Promise<Record<string, unknown> | null> {
  const data = await apiGet<unknown>(`/proposals/${encodeURIComponent(uuid)}`, { include_fields: INCLUDE_FIELDS });
  return data && typeof data === "object" ? (data as Record<string, unknown>) : null;
}

export async function fetchCustomer(uuid: string): Promise<Record<string, unknown> | null> {
  const data = await apiGet<unknown>(`/customers/${encodeURIComponent(uuid)}`);
  return data && typeof data === "object" ? (data as Record<string, unknown>) : null;
}

export async function fetchCustomerAddresses(uuid: string): Promise<Record<string, unknown>[]> {
  const data = await apiGet<unknown>(`/customers/${encodeURIComponent(uuid)}/customer-addresses`);
  if (Array.isArray(data)) return data as Record<string, unknown>[];
  if (data && typeof data === "object") {
    const o = data as Record<string, unknown>;
    for (const k of ["items", "data", "addresses", "results"]) if (Array.isArray(o[k])) return o[k] as Record<string, unknown>[];
  }
  return [];
}

// ---- Lenient field pickers (response shapes vary; parse defensively) --------

function asObj(v: unknown): Record<string, unknown> | null {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}
function pickStr(o: Record<string, unknown> | null, keys: string[]): string | undefined {
  if (!o) return undefined;
  for (const k of keys) {
    const v = o[k];
    if (typeof v === "string" && v.trim() !== "") return v;
    if (typeof v === "number" && Number.isFinite(v)) return String(v);
  }
  return undefined;
}
function pickNum(o: Record<string, unknown> | null, keys: string[]): number {
  if (!o) return 0;
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
function pickBool(o: Record<string, unknown> | null, keys: string[]): boolean | undefined {
  if (!o) return undefined;
  for (const k of keys) {
    const v = o[k];
    if (typeof v === "boolean") return v;
    if (v === 1 || v === "1" || v === "true") return true;
    if (v === 0 || v === "0" || v === "false") return false;
  }
  return undefined;
}
function pickArr(o: Record<string, unknown> | null, keys: string[]): Record<string, unknown>[] {
  if (!o) return [];
  for (const k of keys) if (Array.isArray(o[k])) return (o[k] as unknown[]).filter((x) => x && typeof x === "object") as Record<string, unknown>[];
  return [];
}

// ---- Mapping SmarterLaunch -> our SalesLead --------------------------------

/**
 * Proposal status -> our funnel stage.
 *   Draft / Pending Review -> "lead"
 *   Sent                   -> "proposal"
 *   Accepted (= won)       -> "closed"
 *   Declined / Archived    -> "lost"
 * Lenient keyword match so renamed/custom statuses still land somewhere sane.
 */
export function mapStage(statusName: string | undefined): string {
  const t = (statusName ?? "").toLowerCase();
  if (/accept|won|sold|signed|closed.?won/.test(t)) return "closed";
  if (/declin|archiv|lost|reject|cancel|dead/.test(t)) return "lost";
  if (/sent|propos/.test(t)) return "proposal";
  return "lead"; // draft, pending review, unknown
}

const CHANNEL_KEYS = new Set<string>(LEAD_CHANNELS.map((c) => c.key));

/**
 * Referral-source name -> our marketing channel (bni|referral|google|web|other).
 * A small, easily-tweaked keyword mapper; unknown sources fall through to "other".
 */
export function mapChannel(sourceName: string | undefined): string {
  const t = (sourceName ?? "").toLowerCase();
  if (/\bbni\b|networking/.test(t)) return "bni";
  if (/google|adwords|ppc|\bsem\b|paid.?search|bing|yelp.?ad/.test(t)) return "google";
  if (/web|site|online|internet|form|chat|landing/.test(t)) return "web";
  if (/referr|word.?of.?mouth|friend|neighbor|customer|repeat|existing/.test(t)) return "referral";
  return "other";
}

/**
 * company-provided vs advisor self-generated.
 * Heuristic (best-effort, easily tweaked): inbound / Google / web / company /
 * marketing / call-center sources are company-PROVIDED; a personal referral, BNI,
 * or self-sourced lead is NOT. Defaults to the channel's own `provided` flag, then
 * false.
 */
export function inferProvided(channel: string, sourceName: string | undefined): boolean {
  const t = (sourceName ?? "").toLowerCase();
  if (/company|house|inbound|marketing|call.?center|\bcsr\b|office|front.?desk/.test(t)) return true;
  if (channel === "google" || channel === "web") return true;
  if (channel === "bni" || channel === "referral") return false;
  return LEAD_CHANNELS.find((c) => c.key === channel)?.provided ?? false;
}

// Optional company_location_uuid -> branch key map, supplied via env as JSON
// (e.g. {"<uuid>":"vero"}). Parsed once. Also falls back to a name keyword match.
let LOCATION_MAP: Record<string, string> | null = null;
function locationMap(): Record<string, string> {
  if (LOCATION_MAP) return LOCATION_MAP;
  try {
    const parsed = JSON.parse(process.env.SMARTERLAUNCH_LOCATION_MAP || "{}");
    LOCATION_MAP = parsed && typeof parsed === "object" ? (parsed as Record<string, string>) : {};
  } catch {
    LOCATION_MAP = {};
  }
  return LOCATION_MAP;
}

/** Resolve a SmarterLaunch location (uuid and/or name) to one of our branch keys, else null. */
export function mapBranch(locationUuid: string | undefined, locationName: string | undefined): string | null {
  if (locationUuid) {
    const mapped = locationMap()[locationUuid];
    if (mapped && BRANCHES.some((b) => b.key === mapped)) return mapped;
  }
  const t = (locationName ?? "").toLowerCase();
  for (const b of BRANCHES) {
    if (t.includes(b.key) || t.includes(b.label.toLowerCase())) return b.key;
  }
  // Common FL city aliases that identify a branch.
  if (/sebastian|indian river/.test(t)) return "vero";
  if (/jensen|palm city|port salerno|martin county/.test(t)) return "stuart";
  if (/winter park|lake nona|orange county/.test(t)) return "orlando";
  if (/collier|bonita|marco/.test(t)) return "naples";
  return null;
}

/** Sum initial_price + recurring_price across line items / service plans; 0 if none. */
export function sumProposalValue(proposal: Record<string, unknown> | null): number {
  if (!proposal) return 0;
  // Prefer an explicit rolled-up total if the API provides one.
  const explicit = pickNum(proposal, ["total", "total_price", "total_value", "initial_revenue", "amount", "grand_total"]);
  let sum = explicit;
  for (const key of ["line_items", "service_plans", "items", "plans", "services"]) {
    for (const li of pickArr(proposal, [key])) {
      sum += pickNum(li, ["initial_price", "initialPrice"]) + pickNum(li, ["recurring_price", "recurringPrice"]);
    }
  }
  return Math.max(0, Math.round(sum * 100) / 100);
}

export type AdvisorMaps = { byEmail: Map<string, { id: string; name: string; branch: string | null }>; byName: Map<string, { id: string; name: string; branch: string | null }> };

/** Load the service-advisor roster for email/name matching (mirrors the ingest route). */
export async function loadAdvisorMaps(): Promise<AdvisorMaps> {
  const advisors = await prisma.employee.findMany({
    where: { status: "active", OR: [{ role: { contains: "Advisor" } }, { user: { is: { accessLevel: "sales" } } }] },
    select: { id: true, name: true, email: true, branch: true },
  });
  const norm = (s: string) => s.trim().toLowerCase();
  const byEmail = new Map(advisors.filter((a) => a.email).map((a) => [norm(a.email!), { id: a.id, name: a.name, branch: a.branch }]));
  const byName = new Map(advisors.map((a) => [norm(a.name), { id: a.id, name: a.name, branch: a.branch }]));
  return { byEmail, byName };
}

export function matchAdvisor(maps: AdvisorMaps, email?: string, name?: string) {
  const norm = (s: string) => s.trim().toLowerCase();
  return (email ? maps.byEmail.get(norm(email)) : undefined) || (name ? maps.byName.get(norm(name)) : undefined) || null;
}

/** The normalized lead fields we derive from a proposal (+ its resolved context). */
export type NormalizedLead = {
  externalId: string;
  customerUuid: string | null;
  proposalStatus: string | null;
  referralSource: string | null;
  advisorEmail: string | null;
  advisorName: string | null;
  locationUuid: string | null;
  locationName: string | null;
  address: string | null;
  city: string | null;
  zip: string | null;
  lat: number | null;
  lng: number | null;
  stage: string;
  channel: string;
  provided: boolean;
  value: number;
  createdAt: Date | null;
};

/**
 * Build normalized lead fields from a proposal object plus optional resolved
 * customer / addresses. Everything is defensive: a missing piece just leaves the
 * field null. `extra` lets the webhook pass pieces it already resolved.
 */
export function normalizeProposal(
  proposal: Record<string, unknown>,
  extra: { customer?: Record<string, unknown> | null; addresses?: Record<string, unknown>[] } = {},
): NormalizedLead | null {
  const externalId = pickStr(proposal, ["uuid", "id", "proposal_uuid", "proposalId", "proposal_id"]);
  if (!externalId) return null;

  const customer = extra.customer ?? asObj(proposal["customer"]) ?? asObj(proposal["customer_detail"]);
  const customerUuid =
    pickStr(proposal, ["customer_uuid", "customerUuid", "customer_id"]) ?? pickStr(customer, ["uuid", "id"]) ?? null;

  // Status: an object {name} or a plain string.
  const statusObj = asObj(proposal["status"]);
  const proposalStatus = pickStr(statusObj, ["name", "label"]) ?? pickStr(proposal, ["status", "status_name"]) ?? null;

  // Referral source -> channel.
  const refObj = asObj(proposal["referral_source"]) ?? asObj(customer?.["referral_source"] ?? null);
  const referralSource =
    pickStr(refObj, ["name", "label", "description"]) ?? pickStr(proposal, ["referral_source_name", "referralSource"]) ?? null;

  // Assigned user (advisor) -> email/name.
  const user = asObj(proposal["assigned_user"]) ?? asObj(proposal["referral_user"]) ?? asObj(proposal["user"]);
  const advisorEmail = pickStr(user, ["email"]) ?? pickStr(proposal, ["assigned_user_email"]) ?? null;
  const first = pickStr(user, ["first_name", "firstName"]);
  const last = pickStr(user, ["last_name", "lastName"]);
  const advisorName = [first, last].filter(Boolean).join(" ") || pickStr(user, ["name", "full_name"]) || pickStr(proposal, ["assigned_user_name"]) || null;

  // Location -> branch.
  const loc = asObj(proposal["company_location"]) ?? asObj(customer?.["company_location"] ?? null);
  const locationUuid = pickStr(proposal, ["company_location_uuid", "companyLocationUuid"]) ?? pickStr(loc, ["uuid", "id"]) ?? null;
  const locationName = pickStr(loc, ["name", "label"]) ?? null;

  // Address: the customer's primary customer-address (is_primary), else the first.
  const addrs = extra.addresses ?? pickArr(customer, ["customer_addresses", "addresses"]) ?? [];
  const primary = addrs.find((a) => pickBool(a, ["is_primary", "isPrimary", "primary"])) ?? addrs[0] ?? null;
  const line1 = pickStr(primary, ["address1", "address_1", "line1", "street"]);
  const line2 = pickStr(primary, ["address2", "address_2", "line2"]);
  const address = [line1, line2].filter(Boolean).join(", ") || null;
  const city = pickStr(primary, ["city"]) ?? null;
  const zip = pickStr(primary, ["postal_code", "postalCode", "zip", "zip_code"]) ?? null;
  const lat = primary ? pickNumOrNull(primary, ["latitude", "lat"]) : null;
  const lng = primary ? pickNumOrNull(primary, ["longitude", "lng", "lon", "long"]) : null;

  const channel = mapChannel(referralSource ?? undefined);
  const createdRaw = pickStr(proposal, ["created_at", "createdAt", "created", "date_created"]);
  const created = createdRaw ? new Date(createdRaw) : null;

  return {
    externalId,
    customerUuid,
    proposalStatus,
    referralSource,
    advisorEmail,
    advisorName,
    locationUuid,
    locationName,
    address,
    city,
    zip,
    lat,
    lng,
    stage: mapStage(proposalStatus ?? undefined),
    channel: CHANNEL_KEYS.has(channel) ? channel : "other",
    provided: inferProvided(channel, referralSource ?? undefined),
    value: sumProposalValue(proposal),
    createdAt: created && !Number.isNaN(created.getTime()) ? created : null,
  };
}

function pickNumOrNull(o: Record<string, unknown>, keys: string[]): number | null {
  for (const k of keys) {
    const v = o[k];
    if (typeof v === "number" && Number.isFinite(v) && v !== 0) return v;
    if (typeof v === "string" && v.trim() !== "") {
      const n = Number(v);
      if (Number.isFinite(n) && n !== 0) return n;
    }
  }
  return null;
}

/**
 * Idempotent upsert of one normalized lead into `SalesLead` (origin
 * "smarterlaunch", keyed on externalId = proposal uuid). Matches the advisor by
 * email then name, snapshots the name, resolves the branch. Returns the row id.
 */
export async function upsertLead(norm: NormalizedLead, maps: AdvisorMaps): Promise<string> {
  const advisor = matchAdvisor(maps, norm.advisorEmail ?? undefined, norm.advisorName ?? undefined);
  const branch = mapBranch(norm.locationUuid ?? undefined, norm.locationName ?? undefined) ?? advisor?.branch ?? null;
  const neighborhood = norm.city || (norm.zip ? `ZIP ${norm.zip}` : null);

  const data = {
    advisorEmployeeId: advisor?.id ?? null,
    advisorName: advisor?.name ?? norm.advisorName ?? null,
    branch,
    address: norm.address,
    city: norm.city,
    zip: norm.zip,
    neighborhood,
    lat: norm.lat,
    lng: norm.lng,
    stage: norm.stage,
    channel: norm.channel,
    provided: norm.provided,
    value: norm.value,
    customerUuid: norm.customerUuid,
    proposalStatus: norm.proposalStatus,
    referralSource: norm.referralSource,
    origin: "smarterlaunch",
  };

  const row = await prisma.salesLead.upsert({
    where: { externalId: norm.externalId },
    create: { externalId: norm.externalId, ...data, ...(norm.createdAt ? { createdAt: norm.createdAt } : {}) },
    update: data,
  });
  return row.id;
}

// ---- Daily backfill --------------------------------------------------------

export type SmarterLaunchSyncResult = {
  ok: boolean;
  configured: boolean;
  ranAt: string;
  pages: number;
  fetched: number;
  upserted: number;
  enriched: number;
  stoppedReason: string | null;
  error?: string;
};

/**
 * One small, quota-aware daily backfill: a bounded number of pages of recently
 * updated proposals, upserted the same way the webhook does. Address enrichment
 * (per unique customer) is attempted only while we stay above the budget floor,
 * and the whole run bails the moment a company/api_key rate limit is hit. No-op
 * when not configured; never throws.
 */
export async function syncSmarterLaunchBackfill(opts: { maxPages?: number; lookbackDays?: number; pageSize?: number } = {}): Promise<SmarterLaunchSyncResult> {
  const ranAt = new Date().toISOString();
  const base: SmarterLaunchSyncResult = { ok: false, configured: smarterLaunchConfigured(), ranAt, pages: 0, fetched: 0, upserted: 0, enriched: 0, stoppedReason: null };
  if (!smarterLaunchConfigured()) return { ...base, ok: true, stoppedReason: "not_configured" };

  const maxPages = Math.max(1, Math.min(opts.maxPages ?? 3, 10));
  const pageSize = Math.max(1, Math.min(opts.pageSize ?? 50, 100));
  const lookbackDays = opts.lookbackDays ?? 30;
  const start = new Date(Date.now() - lookbackDays * 864e5).toISOString().slice(0, 10);
  const end = new Date().toISOString().slice(0, 10);

  try {
    if (!(await hasBudget())) return { ...base, ok: true, stoppedReason: "budget_floor" };

    const maps = await loadAdvisorMaps();
    const enrichedCustomers = new Set<string>();
    let pages = 0;
    let fetched = 0;
    let upserted = 0;
    let enriched = 0;

    for (let page = 1; page <= maxPages; page++) {
      const result = await fetchProposalsPage({
        page,
        pageSize,
        dateRangeStart: start,
        dateRangeEnd: end,
        dateRangeType: "updated_at",
        sortBy: "created_at",
      });
      pages = page;
      if (result.items.length === 0) break;

      for (const p of result.items) {
        fetched++;
        const norm = normalizeProposal(p);
        if (!norm) continue;

        // Enrich geography (addresses) only when it's missing AND we have budget.
        if ((norm.lat == null || norm.lng == null) && norm.customerUuid && !enrichedCustomers.has(norm.customerUuid)) {
          if (await hasBudget()) {
            enrichedCustomers.add(norm.customerUuid);
            try {
              const addresses = await fetchCustomerAddresses(norm.customerUuid);
              const re = normalizeProposal(p, { addresses });
              if (re) {
                Object.assign(norm, { address: re.address, city: re.city, zip: re.zip, lat: re.lat, lng: re.lng });
                enriched++;
              }
            } catch (e) {
              if (e instanceof SmarterLaunchRateLimitError) throw e; // bail the whole run
              // other enrichment errors are non-fatal
            }
          }
        }

        await upsertLead(norm, maps);
        upserted++;
      }

      // Stop early if there's no next page.
      if (result.total && page * pageSize >= result.total) break;
      if (!(await hasBudget())) return { ...base, ok: true, pages, fetched, upserted, enriched, stoppedReason: "budget_floor" };
    }

    return { ...base, ok: true, pages, fetched, upserted, enriched };
  } catch (e) {
    if (e instanceof SmarterLaunchRateLimitError) {
      return { ...base, ok: true, stoppedReason: `rate_limit:${e.scope}`, error: e.message };
    }
    return { ...base, ok: false, error: e instanceof Error ? e.message : "SmarterLaunch sync failed" };
  }
}

// ---- Status (for diagnostics; no secrets) ----------------------------------

export type SmarterLaunchStatus = {
  configured: boolean;
  base: string;
  authScheme: string;
  companyUuid: string | null;
  env: { apiKey: boolean; webhookSecret: boolean; companyUuid: boolean; apiKeyPrefix: string | null };
};

export function smarterLaunchStatus(): SmarterLaunchStatus {
  return {
    configured: smarterLaunchConfigured(),
    base: BASE,
    authScheme: "X-API-Key: <key>",
    companyUuid: COMPANY_UUID || null,
    env: {
      apiKey: Boolean(API_KEY),
      webhookSecret: Boolean(WEBHOOK_SECRET),
      companyUuid: Boolean(COMPANY_UUID),
      // Log/show only the non-secret prefix, never the key itself.
      apiKeyPrefix: API_KEY ? API_KEY.slice(0, 7) : null,
    },
  };
}
