import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUser, branchLocked } from "@/lib/auth";
import { scoreInspection, criticalFailures, type Ratings, type Checks } from "@/lib/inspection";
import { branchLabel } from "@/lib/management";
import { listEmployees, matchEmployeeByName } from "@/lib/people";
import { sendEmail } from "@/lib/email";

export const runtime = "nodejs";

const str = (v: unknown) => { const s = typeof v === "string" ? v.trim() : ""; return s === "" ? null : s; };
const int = (v: unknown) => { const n = parseInt(String(v ?? "").replace(/[^0-9-]/g, ""), 10); return Number.isFinite(n) ? n : null; };
const date = (v: unknown) => { if (!v) return null; const d = new Date(String(v)); return isNaN(d.getTime()) ? null : d; };

export async function POST(req: Request) {
  // Inspections are completed by branch managers as well as admins.
  const user = await getSessionUser();
  if (!user || (user.role !== "admin" && user.role !== "manager"))
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
    if (branchLocked(user) && vehicle.branch !== user.branch)
      return NextResponse.json({ error: "That vehicle is not at your branch." }, { status: 403 });

    const when = date(body?.date) ?? new Date();
    const year = int(body?.year) ?? when.getFullYear();
    const month = int(body?.month) ?? when.getMonth() + 1;
    const ratings: Ratings = (body?.ratings ?? {}) as Ratings;
    const checks: Checks = (body?.checks ?? {}) as Checks;
    const { score, maxScore, scorePct, grade } = scoreInspection(ratings, checks);
    const mileage = int(body?.mileage);

    // Resolve the graded employee: explicit pick wins; else match by name.
    const technicianName = str(body?.technicianName) ?? vehicle.assignedTo;
    let employeeId = str(body?.employeeId);
    if (!employeeId && technicianName) {
      const emps = await listEmployees(vehicle.branch ?? undefined);
      employeeId = matchEmployeeByName(technicianName, emps.map((e) => ({ id: e.id, name: e.name, role: e.role, division: e.division, branch: e.branch })));
    }

    const data = {
      vehicleId,
      branch: vehicle.branch,
      year,
      month,
      date: when,
      employeeId,
      technicianName,
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

    // Email the graded employee a copy of their score (no-ops + logs until
    // addresses / an email provider are configured).
    let emailStatus: string | null = null;
    if (employeeId) {
      const emp = await prisma.employee.findUnique({ where: { id: employeeId } });
      if (emp) {
        const monthName = new Date(year, month - 1, 1).toLocaleString("en-US", { month: "long" });
        const res = await sendEmail({
          to: emp.email,
          subject: `Your ${monthName} ${year} vehicle inspection — grade ${grade} (${scorePct}%)`,
          kind: "inspection_score",
          relatedType: "vehicle_inspection",
          relatedId: saved.id,
          text: `Hi ${emp.name.split(" ")[0]},\n\nYour ${monthName} ${year} vehicle inspection for ${vlabel} was completed by ${data.inspectorName}.\n\nScore: ${score}/${maxScore} (${scorePct}%) — Grade ${grade}.\n${fails.length ? `\nItems to correct: ${fails.map((f) => f.label).join("; ")}.\n` : ""}\nThis is recorded on your personnel profile and will factor into your annual review.\n\n— Clements Command & Control`,
          html: `<p>Hi ${emp.name.split(" ")[0]},</p><p>Your <strong>${monthName} ${year}</strong> vehicle inspection for <strong>${vlabel}</strong> was completed by ${data.inspectorName}.</p><p style="font-size:18px"><strong>Score: ${score}/${maxScore} (${scorePct}%) — Grade ${grade}</strong></p>${fails.length ? `<p style="color:#b91c1c">Items to correct: ${fails.map((f) => f.label).join("; ")}.</p>` : ""}<p>This is recorded on your personnel profile and will factor into your annual review.</p><p>— Clements Command &amp; Control</p>`,
        });
        emailStatus = res.status;
      }
    }

    return NextResponse.json({ ok: true, id: saved.id, score, maxScore, scorePct, grade, criticalFailures: fails.length, emailStatus });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
