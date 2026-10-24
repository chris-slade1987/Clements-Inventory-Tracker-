import "server-only";
import { prisma } from "@/lib/prisma";
import { smarterLaunchConfigured, getStoredQuota } from "@/lib/smarterlaunch";
import { isConfigured as coastConfigured } from "@/lib/coast";
import { isConfigured as workwaveConfigured } from "@/lib/workwave";
import { latestSalesSnapshot } from "@/lib/sales-sync";
import { isCalendarConfigured, calendarConfigState } from "@/lib/google-calendar";

// ---------------------------------------------------------------------------
// Data Connections health aggregator (Theme 8 — the integration spine).
//
// READ-ONLY. For each integration Canopy connects (SmarterLaunch, Coast fuel,
// WorkWave/Sales Center, PestPac inventory, Paychex census) this derives a health
// snapshot ENTIRELY from state already stored in the database plus env presence.
// It NEVER calls an external API — the live view is built from the timestamps,
// counts, webhook rows, and quota headers the sync/webhook paths already persist.
//
// Guardrail (CANOPY-VISION §4): "be the spine, not the replacement." This surface
// only observes; it exposes no controls that mutate an external system, and no
// secret values (only the NAMES of the env vars that gate each connector).
// ---------------------------------------------------------------------------

export type ConnStatus = "healthy" | "stale" | "error" | "not-configured";

export type ConnectorBudget = {
  label: string;
  used: number | null;
  limit: number;
  remaining: number | null;
  /** Fraction 0..1 of the budget consumed, when known. */
  fraction: number | null;
  /** Raw reset header value (epoch seconds or ISO), as the API sent it. */
  resetAt: string | null;
};

export type ConnectorFact = { label: string; value: string };

export type ConnectorHealth = {
  key: string;
  name: string;
  /** Grouping shown on the board ("Sales & CRM", "Fleet & Fuel", …). */
  category: string;
  status: ConnStatus;
  /** Human status word for the chip ("Healthy", "Stale", …). */
  statusLabel: string;
  /** The operating mode / transport ("Webhook-first", "API", "Sheet fallback", "Manual import"). */
  mode: string;
  /** True when a LIVE API credential is present in env (vs. a manual/file feed). */
  live: boolean;
  /** When the connector last moved data, ISO; null when never / not applicable. */
  lastSync: string | null;
  /** What `lastSync` represents ("Last webhook event", "Last sync", "Last import"). */
  lastSyncLabel: string;
  /** Short context line — last error (safe text) or a plain description. */
  detail: string | null;
  /** Budget/quota meter where the connector is rate-limited. */
  budget?: ConnectorBudget;
  /** A few extra read-only facts (row counts, provenance). */
  facts: ConnectorFact[];
  /** NAMES only of the env vars that gate this connector — never any value. */
  envKeys: string[];
};

const DAY = 864e5;

const STATUS_LABEL: Record<ConnStatus, string> = {
  healthy: "Healthy",
  stale: "Stale",
  error: "Error",
  "not-configured": "Not configured",
};

/**
 * Derive a status from the facts we already hold. Errors win; an unconfigured
 * live connector (and a manual feed that has never run) read "not configured";
 * otherwise freshness against the connector's own cadence decides healthy/stale.
 */
function deriveStatus(opts: {
  live: boolean;
  manual?: boolean;
  lastSync: Date | null;
  error?: boolean;
  staleAfterMs: number;
}): ConnStatus {
  if (opts.error) return "error";
  if (!opts.live && !opts.manual) return "not-configured";
  if (!opts.lastSync) return opts.manual ? "not-configured" : "stale";
  const age = Date.now() - opts.lastSync.getTime();
  return age > opts.staleAfterMs ? "stale" : "healthy";
}

const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null);
const maxDate = (a: Date | null, b: Date | null): Date | null =>
  a && b ? (a.getTime() >= b.getTime() ? a : b) : a ?? b;

// --- Per-connector builders -------------------------------------------------

async function smarterLaunchHealth(): Promise<ConnectorHealth> {
  const live = smarterLaunchConfigured();
  const [quota, lastEvent, lastError, eventCount] = await Promise.all([
    getStoredQuota().catch(() => null),
    prisma.smarterLaunchEvent.findFirst({ orderBy: { receivedAt: "desc" }, select: { receivedAt: true } }).catch(() => null),
    prisma.smarterLaunchEvent
      .findFirst({ where: { parsedOk: false, error: { not: null } }, orderBy: { receivedAt: "desc" }, select: { receivedAt: true, error: true } })
      .catch(() => null),
    prisma.smarterLaunchEvent.count().catch(() => 0),
  ]);

  const quotaAt = quota?.at ? new Date(quota.at) : null;
  const lastWebhook = lastEvent?.receivedAt ?? null;
  const lastSync = maxDate(lastWebhook, quotaAt);

  // A parse error counts as an error only when it's the most recent event — a long
  // ago one-off shouldn't keep the board red once healthy traffic resumed.
  const errored = Boolean(lastError && lastEvent && lastError.receivedAt.getTime() === lastEvent.receivedAt.getTime());

  let budget: ConnectorBudget | undefined;
  if (quota) {
    const limit = quota.limit ?? 250; // documented hard company budget
    const remaining = quota.remaining;
    const used = remaining != null ? Math.max(0, limit - remaining) : null;
    budget = {
      label: "Daily API budget",
      used,
      limit,
      remaining,
      fraction: used != null && limit > 0 ? Math.min(1, used / limit) : null,
      resetAt: quota.reset,
    };
  }

  const status = deriveStatus({ live, lastSync, error: errored, staleAfterMs: 3 * DAY });

  return {
    key: "smarterlaunch",
    name: "SmarterLaunch",
    category: "Sales & CRM",
    status,
    statusLabel: STATUS_LABEL[status],
    mode: "Webhook-first + daily backfill",
    live,
    lastSync: iso(lastSync),
    lastSyncLabel: "Last event / backfill",
    detail: errored
      ? `Last webhook parse error: ${(lastError!.error ?? "").slice(0, 160)}`
      : live
        ? "Proposals arrive as outbound webhooks; a small quota-aware backfill is the safety net."
        : "Set the API key, webhook secret and company UUID to go live.",
    budget,
    facts: [
      { label: "Webhook events stored", value: String(eventCount) },
      { label: "Last webhook", value: lastWebhook ? lastWebhook.toISOString() : "—" },
      { label: "Last API call", value: quotaAt ? quotaAt.toISOString() : "—" },
    ],
    envKeys: ["SMARTERLAUNCH_API_KEY", "SMARTERLAUNCH_WEBHOOK_SECRET", "SMARTERLAUNCH_COMPANY_UUID"],
  };
}

async function coastHealth(): Promise<ConnectorHealth> {
  const live = coastConfigured();
  const [cursorRow, lastTxn, apiRowCount] = await Promise.all([
    prisma.setting.findUnique({ where: { key: "coast_fuel_last_sync" }, select: { value: true, updatedAt: true } }).catch(() => null),
    prisma.fuelTransaction.findFirst({ where: { source: "coast" }, orderBy: { date: "desc" }, select: { date: true } }).catch(() => null),
    prisma.fuelTransaction.count({ where: { source: "coast" } }).catch(() => 0),
  ]);

  // The cursor row's updatedAt is when the last sync actually ran; its value is
  // the data watermark (newest purchase updateTime ingested).
  const lastSync = cursorRow?.updatedAt ?? null;
  const watermark = cursorRow?.value ? new Date(cursorRow.value) : null;
  const status = deriveStatus({ live, lastSync, staleAfterMs: 3 * DAY });

  return {
    key: "coast",
    name: "Coast (fuel cards)",
    category: "Fleet & Fuel",
    status,
    statusLabel: STATUS_LABEL[status],
    mode: "Scheduled polling (no webhooks)",
    live,
    lastSync: iso(lastSync),
    lastSyncLabel: "Last sync run",
    detail: live
      ? "Incremental purchase pull on an updatedStartingAt cursor; purchases settle 24–72h after swipe."
      : "Set the Coast API key to pull card purchases automatically.",
    facts: [
      { label: "Coast-sourced transactions", value: String(apiRowCount) },
      { label: "Ingest watermark", value: watermark ? watermark.toISOString() : "—" },
      { label: "Last fuel purchase", value: lastTxn?.date ? lastTxn.date.toISOString() : "—" },
    ],
    envKeys: ["COAST_API_KEY"],
  };
}

async function workwaveHealth(): Promise<ConnectorHealth> {
  const live = workwaveConfigured();
  const snap = await latestSalesSnapshot().catch(() => ({ metrics: null, syncedAt: null, lastError: null }));
  const source = (snap.metrics as { source?: string } | null)?.source ?? null;
  const rowCount = (snap.metrics as { totalRows?: number } | null)?.totalRows ?? null;
  const errored = Boolean(snap.lastError);

  // Mode reflects which data source the latest good snapshot came from, falling
  // back to what env would use next: the WorkWave API when the token is present,
  // else the hourly Google-Sheet export.
  const mode = source === "workwave" || live ? "WorkWave API" : "Google Sheet fallback";

  const status = deriveStatus({
    live: live || Boolean(snap.syncedAt), // the sheet path works without the API token
    manual: !live,
    lastSync: snap.syncedAt,
    error: errored,
    staleAfterMs: 2 * DAY,
  });

  return {
    key: "workwave",
    name: "WorkWave / Sales Center",
    category: "Sales & CRM",
    status,
    statusLabel: STATUS_LABEL[status],
    mode,
    live,
    lastSync: iso(snap.syncedAt),
    lastSyncLabel: "Last rollup snapshot",
    detail: errored
      ? `Last sync error: ${String(snap.lastError).slice(0, 160)}`
      : live
        ? "Opportunity data pulled from the WorkWave Marketing API and rolled up for the Sales dashboard."
        : "No WorkWave token set — the dashboard reads the hourly Google-Sheet export instead.",
    facts: [
      { label: "Source of last snapshot", value: source === "workwave" ? "WorkWave API" : snap.syncedAt ? "Google Sheet" : "—" },
      { label: "Opportunities in rollup", value: rowCount != null ? String(rowCount) : "—" },
    ],
    envKeys: ["WORKWAVE_API_KEY", "SALES_SHEET_URL"],
  };
}

async function pestpacHealth(): Promise<ConnectorHealth> {
  // PestPac has no live API in Canopy — on-hand lands via the manual "Inventory
  // On-Hand Report" import, which posts adjustment movements. Derive the last
  // import from the newest such movement.
  const lastImport = await prisma.stockMovement
    .findFirst({
      where: { type: "adjustment", reason: { startsWith: "Stock count import" } },
      orderBy: { createdAt: "desc" },
      select: { createdAt: true },
    })
    .catch(() => null);

  const lastSync = lastImport?.createdAt ?? null;
  const status = deriveStatus({ live: false, manual: true, lastSync, staleAfterMs: 45 * DAY });

  return {
    key: "pestpac",
    name: "PestPac (inventory)",
    category: "Inventory",
    status,
    statusLabel: STATUS_LABEL[status],
    mode: "Manual file import",
    live: false,
    lastSync: iso(lastSync),
    lastSyncLabel: "Last on-hand import",
    detail:
      "On-hand reconciled from the uploaded PestPac Inventory On-Hand Report (Catalog Admin → Stock Import). No live API — product/alias mapping is applied at import.",
    facts: [{ label: "Last import posted", value: lastSync ? lastSync.toISOString() : "—" }],
    envKeys: [],
  };
}

async function paychexHealth(): Promise<ConnectorHealth> {
  // Paychex is the people system of record (payroll, 401k, census). Canopy imports
  // the hire/start-date census at onboarding; there is NO live connector, so this
  // reports as a manual, offline source rather than an API feed.
  return {
    key: "paychex",
    name: "Paychex (people census)",
    category: "People",
    status: "not-configured",
    statusLabel: STATUS_LABEL["not-configured"],
    mode: "Manual census (no live API)",
    live: false,
    lastSync: null,
    lastSyncLabel: "Last census import",
    detail:
      "Hire/start dates come from the authoritative Paychex census, imported manually. Paychex remains the system of record for payroll, 401(k), and time/attendance — Canopy does not sync it live.",
    facts: [{ label: "Live connector", value: "No — manual census" }],
    envKeys: [],
  };
}

function googleCalendarHealth(): ConnectorHealth {
  // Google Workspace calendar sync is an ON-DEMAND API (free/busy for Suggested
  // Times + event create/update/cancel for huddles & interviews via a service
  // account with domain-wide delegation). There is no polling/webhook and no
  // stored sync log, so status is derived purely from credential presence: a live
  // service-account key means "healthy", its absence means "not configured" (and
  // callers fall back to .ics / add-to-calendar links). We only read whether the
  // key and optional domain env vars are PRESENT — never their values.
  const live = isCalendarConfigured();
  const cfg = calendarConfigState(); // "ok" | "absent" | "invalid"
  const domainSet = Boolean(process.env.GOOGLE_WORKSPACE_CUSTOMER_DOMAIN?.trim());

  // "invalid" (key set but unparseable) is an ERROR, not merely unconfigured —
  // that distinction is the whole point: it tells the admin the secret IS present
  // but malformed, so they stop re-checking Vercel's "is it set" and fix the value.
  const status: ConnStatus = cfg === "ok" ? "healthy" : cfg === "invalid" ? "error" : "not-configured";

  const detail =
    cfg === "ok"
      ? "Service account connected. Powers Suggested Times (free/busy) and live Google Calendar invites for huddles & interviews."
      : cfg === "invalid"
        ? "A key IS set but Canopy could not parse it into a usable service account — almost always the private key's newlines were mangled when pasted. Fix: base64-encode the whole JSON key and set it as GOOGLE_WORKSPACE_SA_JSON_BASE64 (leave GOOGLE_WORKSPACE_SA_JSON empty), then redeploy."
        : "Not connected — Suggested Times and live invites fall back to .ics add-to-calendar links. Add the service-account key (domain-wide delegation) on the Production environment and redeploy.";

  const keyFact =
    cfg === "ok"
      ? "Yes — service account present"
      : cfg === "invalid"
        ? "Set, but unparseable (see detail)"
        : "Not set on this environment";

  return {
    key: "google-calendar",
    name: "Google Workspace Calendar",
    category: "Scheduling & Calendar",
    status,
    statusLabel: STATUS_LABEL[status],
    mode: "On-demand API (free/busy + events)",
    live,
    lastSync: null,
    lastSyncLabel: "On-demand (no sync log)",
    detail,
    facts: [
      { label: "Service-account key", value: keyFact },
      { label: "Impersonation domain restricted", value: domainSet ? "Yes" : "No" },
      { label: "Scopes", value: "calendar.events, calendar.freebusy" },
    ],
    envKeys: ["GOOGLE_WORKSPACE_SA_JSON", "GOOGLE_WORKSPACE_SA_JSON_BASE64", "GOOGLE_WORKSPACE_CUSTOMER_DOMAIN"],
  };
}

/**
 * The full read-only health board. Each builder is independent and swallows its
 * own query errors, so one connector's bad read never blanks the whole page.
 */
async function emailHealth(): Promise<ConnectorHealth> {
  // Outbound email provider. Resend wins if its key is set; otherwise Google
  // Workspace Gmail-send (the Calendar service account impersonating
  // GOOGLE_WORKSPACE_EMAIL_FROM) when a SA key + sender mailbox are present.
  const resend = !!process.env.RESEND_API_KEY;
  const gmail = !!(process.env.GOOGLE_WORKSPACE_SA_JSON || process.env.GOOGLE_WORKSPACE_SA_JSON_BASE64) && !!(process.env.GOOGLE_WORKSPACE_EMAIL_FROM || "").trim();
  const live = resend || gmail;
  const mode = resend ? "Resend (API)" : gmail ? "Google Workspace (Gmail send)" : "Not configured";

  const [lastSent, lastError, sent7, err7] = await Promise.all([
    prisma.emailLog.findFirst({ where: { status: "sent" }, orderBy: { createdAt: "desc" }, select: { createdAt: true } }).catch(() => null),
    prisma.emailLog.findFirst({ where: { status: "error" }, orderBy: { createdAt: "desc" }, select: { createdAt: true, error: true } }).catch(() => null),
    prisma.emailLog.count({ where: { status: "sent", createdAt: { gte: new Date(Date.now() - 7 * DAY) } } }).catch(() => 0),
    prisma.emailLog.count({ where: { status: "error", createdAt: { gte: new Date(Date.now() - 7 * DAY) } } }).catch(() => 0),
  ]);
  const recentErr = Boolean(lastError && (!lastSent || lastError.createdAt.getTime() >= lastSent.createdAt.getTime()) && err7 > 0);

  const status: ConnStatus = !live ? "not-configured" : recentErr ? "error" : "healthy";
  return {
    key: "email",
    name: "Email (outbound)",
    category: "Notifications",
    status,
    statusLabel: STATUS_LABEL[status],
    mode,
    live,
    lastSync: iso(lastSent?.createdAt ?? null),
    lastSyncLabel: "Last email sent",
    detail: !live
      ? "No email provider configured — notifications (inspection reports, huddle invites, training, approvals) are logged but NOT sent. Set RESEND_API_KEY, or add the gmail.send scope to the Workspace service account's domain-wide delegation and set GOOGLE_WORKSPACE_EMAIL_FROM to a real mailbox."
      : recentErr
        ? `Provider set (${mode}) but recent sends FAILED: ${(lastError?.error ?? "").slice(0, 200)}`
        : `Sending via ${mode}. Every attempt is recorded in the Email Log.`,
    facts: [
      { label: "Provider", value: mode },
      { label: "Sent (7d)", value: String(sent7) },
      { label: "Errors (7d)", value: String(err7) },
    ],
    envKeys: ["RESEND_API_KEY", "GOOGLE_WORKSPACE_SA_JSON", "GOOGLE_WORKSPACE_EMAIL_FROM"],
  };
}

export async function getConnectionsHealth(): Promise<ConnectorHealth[]> {
  return Promise.all([
    smarterLaunchHealth(),
    workwaveHealth(),
    coastHealth(),
    pestpacHealth(),
    paychexHealth(),
    Promise.resolve(googleCalendarHealth()),
    emailHealth(),
  ]);
}

/** Small rollup for the page header (how many connectors are in each state). */
export function summarizeHealth(items: ConnectorHealth[]): Record<ConnStatus, number> {
  const out: Record<ConnStatus, number> = { healthy: 0, stale: 0, error: 0, "not-configured": 0 };
  for (const i of items) out[i.status] += 1;
  return out;
}
