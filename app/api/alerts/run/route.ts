import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { runAnomalyChecks } from "@/lib/anomaly";

export async function POST() {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const summary = await runAnomalyChecks();
  const total = Object.values(summary).reduce((s, n) => s + n, 0);
  return NextResponse.json({ ok: true, summary, total });
}
