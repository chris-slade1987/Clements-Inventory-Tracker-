import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth";
import { hasWeatherAiKey } from "@/lib/weather/briefing";
import { diagnosticsSnapshot, todayET } from "@/lib/weather/service";
import { NWS_BUILD } from "@/lib/weather/nws";

export const runtime = "nodejs";
export const maxDuration = 30;

// Admin-only diagnostics — last fetch per location, grid-resolution status, provider
// config, last briefing, and a build tag (cache-buster), mirroring the other
// integration diagnostics endpoints.
export async function GET() {
  const user = await getSessionUser();
  if (!user || user.role !== "admin") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const out: Record<string, unknown> = {
    build: { tag: NWS_BUILD, feature: "weather-ops-1" },
    today: todayET(),
    status: {
      aiBriefingConfigured: hasWeatherAiKey(),
      cronSecretConfigured: !!process.env.CRON_SECRET,
      model: process.env.ANTHROPIC_MODEL || "claude-opus-4-8",
      providers: { nws: "api.weather.gov", nhc: "nhc.noaa.gov/CurrentStorms.json", userAgentSet: true },
    },
  };

  out.locations = await diagnosticsSnapshot();

  const lastBriefings = await prisma.weatherBriefing
    .findMany({ orderBy: { generatedAt: "desc" }, take: 4, select: { branch: true, forDate: true, riskLevel: true, model: true, generatedAt: true } })
    .catch(() => []);
  out.lastBriefings = lastBriefings.map((b) => ({ ...b, generatedAt: b.generatedAt.toISOString() }));

  const snapCount = await prisma.weatherSnapshot.count().catch(() => 0);
  out.snapshotCount = snapCount;

  return NextResponse.json(out);
}
