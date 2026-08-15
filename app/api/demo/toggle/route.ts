import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { DEMO_SETTING_KEY, isDemoModeEnv } from "@/lib/demo";
import { seedDemo, clearDemoRows } from "@/prisma/seed-demo";

export const runtime = "nodejs";
export const maxDuration = 30;

// Admin switch to flip Demo Mode on/off from inside the app.
//   POST { on: true }  -> set the demo_mode Setting on, then seed demo data
//   POST { on: false } -> clear demo data, then set demo_mode off
// Only touches demo-marked rows (clearDemoRows is scoped to demo_ ids +
// SAMPLE:demo_ GPS rows); real data is never affected. Never throws.
export async function POST(req: Request) {
  const user = await getSessionUser();
  if (!user || user.role !== "admin") {
    return NextResponse.json({ error: "Only an admin can change demo mode." }, { status: 403 });
  }
  // A deploy-level DEMO_MODE=1 env forces demo on and can't be overridden here.
  if (isDemoModeEnv()) {
    return NextResponse.json(
      { error: "Demo mode is forced on by the DEMO_MODE environment variable; change it in the deployment settings." },
      { status: 409 },
    );
  }

  const body = await req.json().catch(() => ({}));
  const on = body?.on === true;

  try {
    if (on) {
      await prisma.setting.upsert({ where: { key: DEMO_SETTING_KEY }, create: { key: DEMO_SETTING_KEY, value: "on" }, update: { value: "on" } });
      const summary = await seedDemo();
      return NextResponse.json({ ok: true, on: true, seeded: summary });
    } else {
      await clearDemoRows();
      await prisma.setting.upsert({ where: { key: DEMO_SETTING_KEY }, create: { key: DEMO_SETTING_KEY, value: "off" }, update: { value: "off" } });
      return NextResponse.json({ ok: true, on: false });
    }
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Could not change demo mode." }, { status: 500 });
  }
}
