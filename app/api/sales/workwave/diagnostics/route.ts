import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { isConfigured, workwaveStatus, fetchOpportunitiesDetailed, probeEndpoints, mapOpportunity, WorkwaveError } from "@/lib/workwave";

export const runtime = "nodejs";
export const maxDuration = 60;

// Admin-only WorkWave Sales Center diagnostics: shows the connector config and,
// when configured, does a LIVE pull so we can see the real response shape and
// confirm the field mapping. Safe/no-op (config only) when the key isn't set.
const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));

export async function GET() {
  const user = await getSessionUser();
  if (!user || user.role !== "admin") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const out: Record<string, unknown> = { status: workwaveStatus(), build: { tag: "workwave-5" } };

  if (isConfigured()) {
    // Token-sanity: hit other endpoints to isolate token-scope vs. request-shape.
    out.connectivity = await probeEndpoints().catch((e) => ({ error: errMsg(e) }));
    try {
      const { opps, strategy, attempts } = await fetchOpportunitiesDetailed();
      const first = opps[0] ?? null;
      out.pull = {
        ok: true,
        strategy, // which request shape WorkWave accepted
        attempts, // every probe tried, with status + error body
        count: opps.length,
        firstMapped: first,
        sample: first ? mapOpportunity(first as unknown, 0) : null,
      };
    } catch (e) {
      // Every strategy was rejected — surface each attempt's status + raw body so
      // we see exactly what WorkWave complained about per method/param combo.
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
