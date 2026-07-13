import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth";
import { scoreInspection, criticalFailures, type Ratings, type Checks } from "@/lib/inspection";
import { branchLabel } from "@/lib/management";

export const runtime = "nodejs";

const str = (v: unknown) => { const s = typeof v === "string" ? v.trim() : ""; return s === "" ? null : s; };
const int = (v: unknown) => { const n = parseInt(String(v ?? "").replace(/[^0-9-]/g, ""), 10); return Number.isFinite(n) ? n : null; };
const date = (v: unknown) => { if (!v) return null; const d = new Date(String(v)); return isNaN(d.getTime()) ? null : d; };

export async function POST(req: Request) {
  const user = await getSessionUser();
  if (!user || user.role !== "admin")
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = await req.json().catch(() => null);
  const action = body?.action ?? "save";

  try {
    if (action === "delete") {
      const id = str(body?.id);
      if (!id) return NextResponse.json({ error: "Missing id." }, { status: 400 });
      await prisma.vehicleInspection.delete({ where: { id } });
      return NextResponse.json({ ok: true });
    }

    const vehicleId = str(body?.vehicleId);
    if (!vehicleId) return NextResponse.json({ error: "Missing vehicle." }, { status: 400 });
    const vehicle = await prisma.vehicle.findUnique({ where: { id: vehicleId } });
    if (!vehicle) return NextResponse.json({ error: "Vehicle not found." }, { status: 404 });

    const when = date(body?.date) ?? new Date();
    const year = int(body?.year) ?? when.getFullYear();
    const month = int(body?.month) ?? when.getMonth() + 1;
    const ratings: Ratings = (body?.ratings ?? {}) as Ratings;
    const checks: Checks = (body?.checks ?? {}) as Checks;
    const { score, maxScore, scorePct, grade } = scoreInspection(ratings, checks);
    const mileage = int(body?.mileage);

    const data = {
      vehicleId,
      branch: vehicle.branch,
      year,
      month,
      date: when,
      technicianName: str(body?.technicianName) ?? vehicle.assignedTo,
      inspectorName: str(body?.inspectorName) ?? user.name ?? user.email,
      ratings: JSON.stringify(ratings),
      ratingIssues: JSON.stringify(body?.ratingIssues ?? {}),
      checks: JSON.stringify(checks),
      oilChangeLast: date(body?.oilChangeLast),
      oilChangeNext: date(body?.oilChangeNext),
      tireRotationLast: date(body?.tireRotationLast),
      tireRotationNext: date(body?.tireRotationNext),
      otherMaintLast: date(body?.otherMaintLast),
      otherMaintNext: date(body?.otherMaintNext),
      mileage,
      notes: str(body?.notes),
      score,
      maxScore,
      scorePct,
      grade,
    };

    const saved = await prisma.vehicleInspection.upsert({
      where: { vehicleId_year_month: { vehicleId, year, month } },
      create: data,
      update: data,
    });

    // Keep the vehicle odometer in sync if this inspection reports a higher reading.
    if (mileage != null && (vehicle.currentMileage == null || mileage > vehicle.currentMileage)) {
      await prisma.vehicle.update({ where: { id: vehicleId }, data: { currentMileage: mileage, mileageAsOf: when } });
    }

    // Critical safety failures -> alert (dedupe per vehicle+month). Clear it if resolved.
    const fails = criticalFailures(checks);
    const dedupeKey = `inspection_critical:${vehicleId}:${year}-${String(month).padStart(2, "0")}`;
    const vlabel = `${vehicle.unitNumber ? `#${vehicle.unitNumber} ` : ""}${vehicle.name}${vehicle.branch ? ` (${branchLabel(vehicle.branch)})` : ""}`;
    if (fails.length > 0) {
      await prisma.alert.upsert({
        where: { dedupeKey },
        create: {
          dedupeKey,
          type: "inspection_critical",
          message: `${vlabel}: ${fails.length} critical inspection failure${fails.length === 1 ? "" : "s"} — ${fails.map((f) => f.label).join("; ")}.`,
          severity: "critical",
          status: "open",
        },
        update: {
          message: `${vlabel}: ${fails.length} critical inspection failure${fails.length === 1 ? "" : "s"} — ${fails.map((f) => f.label).join("; ")}.`,
          severity: "critical",
        },
      });
    } else {
      await prisma.alert.deleteMany({ where: { dedupeKey } });
    }

    return NextResponse.json({ ok: true, id: saved.id, score, maxScore, scorePct, grade, criticalFailures: fails.length });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
