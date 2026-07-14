import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUser, branchLocked } from "@/lib/auth";
import { scoreWarehouse, criticalFailures, type Checks } from "@/lib/warehouse";
import { branchLabel } from "@/lib/management";

export const runtime = "nodejs";

const str = (v: unknown) => { const s = typeof v === "string" ? v.trim() : ""; return s === "" ? null : s; };
const int = (v: unknown) => { const n = parseInt(String(v ?? "").replace(/[^0-9-]/g, ""), 10); return Number.isFinite(n) ? n : null; };
const date = (v: unknown) => { if (!v) return null; const d = new Date(String(v)); return isNaN(d.getTime()) ? null : d; };

export async function POST(req: Request) {
  const user = await getSessionUser();
  if (!user || (user.role !== "admin" && user.role !== "manager"))
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = await req.json().catch(() => null);
  const branch = str(body?.branch);
  if (!branch) return NextResponse.json({ error: "Missing branch." }, { status: 400 });
  // Branch managers may only inspect their own branch.
  if (branchLocked(user) && user.branch !== branch)
    return NextResponse.json({ error: "That branch is not yours." }, { status: 403 });

  try {
    const when = date(body?.date) ?? new Date();
    const year = int(body?.year) ?? when.getFullYear();
    const month = int(body?.month) ?? when.getMonth() + 1;
    const checks: Checks = (body?.checks ?? {}) as Checks;
    const { score, maxScore, scorePct, grade } = scoreWarehouse(checks);

    const data = {
      branch, year, month, date: when,
      inspectorName: str(body?.inspectorName) ?? user.name,
      checks: JSON.stringify(checks),
      comments: JSON.stringify(body?.comments ?? {}),
      notes: str(body?.notes),
      score, maxScore, scorePct, grade,
    };
    const saved = await prisma.warehouseInspection.upsert({
      where: { branch_year_month: { branch, year, month } },
      create: data,
      update: data,
    });

    // Critical failures -> alert (dedupe per branch+month).
    const fails = criticalFailures(checks);
    const dedupeKey = `warehouse_critical:${branch}:${year}-${String(month).padStart(2, "0")}`;
    if (fails.length > 0) {
      const msg = `${branchLabel(branch)} warehouse: ${fails.length} critical safety failure${fails.length === 1 ? "" : "s"} — ${fails.map((f) => f.label).join("; ")}.`;
      await prisma.alert.upsert({
        where: { dedupeKey },
        create: { dedupeKey, type: "warehouse_critical", message: msg, severity: "critical", status: "open" },
        update: { message: msg, severity: "critical" },
      });
    } else {
      await prisma.alert.deleteMany({ where: { dedupeKey } });
    }

    return NextResponse.json({ ok: true, id: saved.id, score, maxScore, scorePct, grade, criticalFailures: fails.length });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
