import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { parseCancellationReport, totalsMatch, CancellationParseError } from "@/lib/cancellations-parse";
import { importCancellations } from "@/lib/cancellations";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const maxDuration = 60;

// Cancellation Center upload. The client reads the PestPac Gain & Loss export as
// text and posts it. `preview` parses and returns a summary without saving;
// `apply` saves it, replacing any earlier upload for the same month. Admin-level
// users only (role admin — like the layout, admins are never grant-gated); the
// `cancellations` access item's "edit" mirrors this on the Access Rights screen.
export async function POST(req: Request) {
  const user = await getSessionUser();
  if (!user || user.role !== "admin")
    return NextResponse.json({ error: "Only admins can upload cancellation reports." }, { status: 403 });

  const body = await req.json().catch(() => null);
  const action = body?.action === "apply" ? "apply" : body?.action === "preview" ? "preview" : null;
  const text = typeof body?.text === "string" ? body.text : "";
  const fileName = typeof body?.fileName === "string" && body.fileName.trim() ? body.fileName.trim().slice(0, 200) : "gain-loss.xls";
  if (!action) return NextResponse.json({ error: "Unknown action." }, { status: 400 });
  if (!text) return NextResponse.json({ error: "The file was empty." }, { status: 400 });
  if (text.length > 5_000_000) return NextResponse.json({ error: "That file is too large for one month's report." }, { status: 400 });

  let parsed;
  try {
    parsed = parseCancellationReport(text);
  } catch (e) {
    if (e instanceof CancellationParseError) return NextResponse.json({ error: e.message }, { status: 400 });
    console.error("cancellations parse:", e);
    return NextResponse.json({ error: "Couldn't read that file." }, { status: 400 });
  }
  const check = totalsMatch(parsed);
  if (check === false)
    return NextResponse.json({ error: "The rows didn't add up to the report's own totals, so nothing was saved. Re-export the report and try again." }, { status: 400 });

  const byBranch: Record<string, { count: number; value: number }> = {};
  for (const r of parsed.rows) {
    byBranch[r.branch] ??= { count: 0, value: 0 };
    byBranch[r.branch].count += r.lossCount;
    byBranch[r.branch].value += r.lossValue;
  }
  const existing = await prisma.cancellationUpload.findFirst({ where: { periodKey: parsed.periodKey, active: true }, select: { endDate: true, fileName: true } });
  const summary = {
    periodKey: parsed.periodKey,
    startDate: parsed.startDate,
    endDate: parsed.endDate,
    rows: parsed.rows.length,
    lossCount: parsed.rows.reduce((s, r) => s + r.lossCount, 0),
    lossValue: Math.round(parsed.rows.reduce((s, r) => s + r.lossValue, 0) * 100) / 100,
    totalsChecked: check === true,
    byBranch,
    replaces: existing ? { endDate: existing.endDate, fileName: existing.fileName } : null,
  };
  if (action === "preview") return NextResponse.json({ ok: true, summary });

  try {
    const r = await importCancellations({ parsed, fileName, source: "upload", uploadedBy: user.name ?? user.email });
    return NextResponse.json({ ok: true, summary, saved: r });
  } catch (e) {
    console.error("cancellations import:", e);
    return NextResponse.json({ error: "Couldn't save the report." }, { status: 500 });
  }
}
