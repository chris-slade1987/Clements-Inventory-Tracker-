import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth";
import {
  smarterLaunchConfigured,
  smarterLaunchStatus,
  getStoredQuota,
  hasBudget,
  fetchProposalsPage,
  normalizeProposal,
  SmarterLaunchError,
} from "@/lib/smarterlaunch";

export const runtime = "nodejs";
export const maxDuration = 20;

// Admin-only SmarterLaunch diagnostics (like the WorkWave diagnostics route).
// Shows the connector config (booleans + key prefix only — never the secrets),
// the last-seen quota/budget, the most recent RAW webhook payload + a parsed
// preview, a recent-events count, and a tiny guarded live pull. Safe/no-op when
// the connector isn't configured.
const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));

export async function GET() {
  const user = await getSessionUser();
  if (!user || user.role !== "admin") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const out: Record<string, unknown> = { status: smarterLaunchStatus(), build: { tag: "smarterlaunch-2" } };

  // Quota / budget.
  out.quota = await getStoredQuota();
  out.budgetOk = await hasBudget().catch(() => null);

  // Webhook event store: recent count + the LAST raw payload with a parsed preview.
  const [eventCount, last] = await Promise.all([
    prisma.smarterLaunchEvent.count().catch(() => 0),
    prisma.smarterLaunchEvent.findFirst({ orderBy: { receivedAt: "desc" } }).catch(() => null),
  ]);
  out.events = {
    count: eventCount,
    last: last
      ? {
          receivedAt: last.receivedAt,
          type: last.type,
          parsedOk: last.parsedOk,
          error: last.error,
          leadId: last.leadId,
          raw: last.raw.slice(0, 4000),
          parsedPreview: safeParsePreview(last.raw),
        }
      : null,
  };

  // Live pull test: one tiny GET /proposals?page_size=1 — guarded + quota-aware.
  if (smarterLaunchConfigured()) {
    if (!(await hasBudget())) {
      out.pull = { ok: false, skipped: "budget_floor" };
    } else {
      try {
        const page = await fetchProposalsPage({ page: 1, pageSize: 1 });
        const first = page.items[0] ?? null;
        out.pull = {
          ok: true,
          total: page.total,
          returned: page.items.length,
          sampleMapped: first ? normalizeProposal(first) : null,
          quotaAfter: await getStoredQuota(),
        };
      } catch (e) {
        const se = e instanceof SmarterLaunchError ? e : null;
        out.pull = { ok: false, error: errMsg(e), rawStatus: se?.status ?? null, rawBody: se?.body ?? null };
      }
    }
  }

  return NextResponse.json(out);
}

function safeParsePreview(raw: string): unknown {
  try {
    const j = JSON.parse(raw);
    // Keep the preview small.
    return JSON.parse(JSON.stringify(j).slice(0, 2000));
  } catch {
    return null;
  }
}
