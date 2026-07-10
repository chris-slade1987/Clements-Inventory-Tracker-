import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { runAnomalyChecks } from "@/lib/anomaly";
import { runSavingsChecks } from "@/lib/savings";

export const runtime = "nodejs";
// Savings can call the Anthropic API for market leads; give it room.
export const maxDuration = 60;

export async function POST() {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const anomaly = await runAnomalyChecks();
  const savings = await runSavingsChecks();
  const summary = { ...anomaly, ...savings };
  const total = Object.values(summary).reduce((s, n) => s + n, 0);
  const savingsTotal = Object.values(savings).reduce((s, n) => s + n, 0);
  return NextResponse.json({ ok: true, summary, total, savingsTotal });
}
