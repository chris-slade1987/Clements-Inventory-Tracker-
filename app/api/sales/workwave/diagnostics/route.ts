import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { isConfigured, workwaveStatus, fetchOpportunities, mapOpportunity, WorkwaveError } from "@/lib/workwave";

export const runtime = "nodejs";
export const maxDuration = 60;

// Admin-only WorkWave Sales Center diagnostics: shows the connector config and,
// when configured, does a LIVE pull so we can see the real response shape and
// confirm the field mapping. Safe/no-op (config only) when the key isn't set.
const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));

export async function GET() {
  const user = await getSessionUser();
  if (!user || user.role !== "admin") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const out: Record<string, unknown> = { status: workwaveStatus(), build: { tag: "workwave-3" } };

  if (isConfigured()) {
    try {
      const opps = await fetchOpportunities();
      const first = opps[0] ?? null;
      out.pull = {
        ok: true,
        count: opps.length,
        firstMapped: first,
        // Re-map index 0 to expose whether required fields (dates, branch, stage,
        // value) survived the mapping — a quick "is the field mapping right?" check.
        sample: first ? mapOpportunity(first as unknown, 0) : null,
      };
    } catch (e) {
      // Surface WorkWave's raw status + response body so a 500 shows the actual
      // reason (missing required param, bad OData, etc.) instead of just "500".
      const we = e instanceof WorkwaveError ? e : null;
      out.pull = {
        ok: false,
        error: errMsg(e),
        rawStatus: we?.status ?? null,
        rawBody: we?.body ?? null,
      };
    }
  }

  return NextResponse.json(out);
}
