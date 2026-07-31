import "server-only";

/**
 * Coast fuel-card API connector (v2).
 *
 * Docs: base `https://public.coastpay.com` (prod), `https://public.demo.coastpay.com`
 * (sandbox). Auth is a single API key sent as `Authorization: Bearer <key>`.
 *
 * We only READ purchases: `GET /v2/transactions/purchases` — cursor-paginated
 * (`nextPageToken`/`pageSize`), with an incremental `updatedStartingAt` filter so
 * a sync pulls only what changed (new purchases AND status transitions, e.g.
 * pending → completed) since the last run. There are NO webhooks, so the live
 * feed is scheduled polling (fine — Coast purchases settle 24–72h after swipe).
 *
 * SECURITY: the key comes from env ONLY (never hardcoded, never sent to the
 * browser). This module imports "server-only" so it can never be client-bundled.
 */

const API_KEY = process.env.COAST_API_KEY ?? "";
const BASE = (process.env.COAST_API_BASE || "https://public.coastpay.com").replace(/\/$/, "");

/** Live mode requires the API key. Absent → callers no-op (like the GPS gate). */
export function isConfigured(): boolean {
  return Boolean(API_KEY);
}

export class CoastError extends Error {
  status: number;
  path: string;
  constructor(message: string, status: number, path: string) {
    super(message);
    this.name = "CoastError";
    this.status = status;
    this.path = path;
  }
}

// ---- Purchase shape (tolerant subset of the v2 schema) --------------------
// Money is in CENTS; fuel.volume is an integer of THREE decimal places (i.e.
// gallons × 1000); fuel.costPerUnit is in US cents. All snapshot fields are
// nullable — a purchase may have no vehicle/fuel/card.
export type CoastPurchase = {
  id: string;
  status: "declined" | "pending" | "completed" | "canceled" | string;
  amount: number; // cents
  createdTime?: string;
  completedTime?: string;
  updatedTime?: string;
  card?: { id?: string | null; last4?: string | null } | null;
  memo?: string | null;
  personSnapshot?: { firstName?: string | null; lastName?: string | null } | null;
  vehicleSnapshot?: {
    id?: string | null;
    name?: string | null; // Coast vehicle name — usually our unit number
    odometer?: number | null;
    licensePlate?: string | null;
    vin?: string | null;
    location?: { name?: string | null } | null;
  } | null;
  merchantSnapshot?: {
    name?: string | null;
    city?: string | null;
    state?: string | null;
    category?: string | null;
  } | null;
  purchaseDetails?: {
    fuel?: {
      type?: "diesel" | "unleadedRegular" | "unleadedPlus" | "unleadedSuper" | "other" | null;
      unit?: "usGallon" | "liter" | "other" | null;
      costPerUnit?: number | null; // US cents per unit
      volume?: number | null; // units × 1000
    } | null;
  } | null;
};

type PurchasesPage = { nextPageToken?: string | null; data?: CoastPurchase[] };

async function apiGet<T = unknown>(path: string): Promise<T> {
  if (!isConfigured()) throw new CoastError("Coast is not configured", 0, path);
  const res = await fetch(`${BASE}${path}`, {
    method: "GET",
    headers: { Accept: "application/json", Authorization: `Bearer ${API_KEY}` },
    cache: "no-store",
  });
  if (res.status === 429) {
    // Respect a Retry-After if present, else a short fixed backoff, then retry once.
    const ra = Number(res.headers.get("retry-after"));
    await new Promise((r) => setTimeout(r, Number.isFinite(ra) && ra > 0 ? Math.min(ra, 10) * 1000 : 2000));
    const retry = await fetch(`${BASE}${path}`, {
      method: "GET",
      headers: { Accept: "application/json", Authorization: `Bearer ${API_KEY}` },
      cache: "no-store",
    });
    if (!retry.ok) throw new CoastError(`Coast GET ${path} failed (${retry.status})`, retry.status, path);
    return (await retry.json()) as T;
  }
  if (!res.ok) throw new CoastError(`Coast GET ${path} failed (${res.status})`, res.status, path);
  const text = await res.text();
  return (text ? JSON.parse(text) : null) as T;
}

/** One page of purchases. `updatedStartingAt` is an inclusive ISO-8601 cursor. */
export async function fetchPurchasesPage(opts: {
  updatedStartingAt?: string;
  status?: string;
  pageSize?: number;
  nextPageToken?: string;
}): Promise<PurchasesPage> {
  const qs = new URLSearchParams();
  if (opts.updatedStartingAt) qs.set("updatedStartingAt", opts.updatedStartingAt);
  if (opts.status) qs.set("status", opts.status);
  qs.set("pageSize", String(opts.pageSize ?? 100));
  if (opts.nextPageToken) qs.set("nextPageToken", opts.nextPageToken);
  return apiGet<PurchasesPage>(`/v2/transactions/purchases?${qs.toString()}`);
}

/**
 * Pull every purchase updated at/after `sinceIso`, following pagination. Capped
 * at `maxPages` as a runaway guard (100/page × 50 pages = 5000 purchases per run,
 * far beyond a normal incremental window).
 */
export async function fetchPurchasesSince(sinceIso: string, maxPages = 50): Promise<CoastPurchase[]> {
  const out: CoastPurchase[] = [];
  let token: string | undefined;
  for (let page = 0; page < maxPages; page++) {
    const res = await fetchPurchasesPage({ updatedStartingAt: sinceIso, nextPageToken: token });
    for (const p of res.data ?? []) out.push(p);
    if (!res.nextPageToken) break;
    token = res.nextPageToken;
  }
  return out;
}
