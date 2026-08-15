import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { detectGpsIssues, aiGpsInsights } from "@/lib/gps-detect";

export const runtime = "nodejs";
export const maxDuration = 60;

// Run GPS detection on demand ("Run analysis" on the GPS dashboard). Admin only,
// mirroring /api/gps/sync. Runs the deterministic rules (real telemetry only)
// then the optional AI pattern layer (no-op without an Anthropic key). Neither
// throws; we always respond with the counts.
export async function POST() {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
  if (user.role !== "admin") {
    return NextResponse.json({ error: "Only an admin may run GPS detection." }, { status: 403 });
  }

  const detection = await detectGpsIssues();
  const ai = await aiGpsInsights();

  return NextResponse.json({
    ok: true,
    detection,
    ai: { aiGenerated: ai.aiGenerated, issuesFiled: ai.issuesFiled },
  });
}
