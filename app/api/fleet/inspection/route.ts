import { fail } from "@/lib/http";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUser, branchLocked } from "@/lib/auth";
import { scoreInspection, criticalFailures, INSPECTION_PHOTO_KINDS, inspectionPhotoLabel, type Ratings, type Checks } from "@/lib/inspection";
import { branchLabel } from "@/lib/management";
import { listEmployees, matchEmployeeByName } from "@/lib/people";
import { sendEmail } from "@/lib/email";
import { saveUpload, deleteUpload } from "@/lib/storage";
import { appUrl } from "@/lib/app-url";

export const runtime = "nodejs";
export const maxDuration = 20;

const str = (v: unknown) => { const s = typeof v === "string" ? v.trim() : ""; return s === "" ? null : s; };
const int = (v: unknown) => { const n = parseInt(String(v ?? "").replace(/[^0-9-]/g, ""), 10); return Number.isFinite(n) ? n : null; };
const date = (v: unknown) => { if (!v) return null; const d = new Date(String(v)); return isNaN(d.getTime()) ? null : d; };

// Decode a `data:<mime>;base64,<...>` URL into bytes + content type.
function parseDataUrl(s: string): { buffer: Buffer; contentType: string } | null {
  const m = /^data:([^;,]+)?(;base64)?,([\s\S]*)$/.exec(s);
  if (!m) return null;
  const contentType = m[1] || "application/octet-stream";
  const data = m[3];
  try {
    const buffer = m[2] ? Buffer.from(data, "base64") : Buffer.from(decodeURIComponent(data));
    return { buffer, contentType };
  } catch {
    return null;
  }
}

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

    // ── Required-field validation (mirrors the client) ──────────────────────
    const mileage = int(body?.mileage);
    if (mileage == null || mileage <= 0)
      return NextResponse.json({ error: "Mileage is required." }, { status: 400 });

    const oilChangeNextMileage = int(body?.oilChangeNextMileage);
    const oilChangeNext = date(body?.oilChangeNext);
    if ((oilChangeNextMileage == null || oilChangeNextMileage <= 0) && !oilChangeNext)
      return NextResponse.json({ error: "Next oil change is required — enter a next-due mileage and/or a next-due date." }, { status: 400 });

    // Photos: all four required. Each value is a new data URL or an existing URL.
    const photosIn = (body?.photos ?? {}) as Record<string, unknown>;
    const existingInsp = await prisma.vehicleInspection.findUnique({
      where: { vehicleId_year_month: { vehicleId, year, month } },
      include: { photos: true },
    });
    const existingByKind = new Map((existingInsp?.photos ?? []).map((p) => [p.kind, p]));
    const resolvedPhotos: { kind: string; photoUrl: string }[] = [];
    const replacedUrls: string[] = [];
    for (const { key, label } of INSPECTION_PHOTO_KINDS) {
      const raw = typeof photosIn[key] === "string" ? (photosIn[key] as string).trim() : "";
      if (raw.startsWith("data:")) {
        const parsed = parseDataUrl(raw);
        if (!parsed) return NextResponse.json({ error: `Could not read the ${label} photo.` }, { status: 400 });
        const url = await saveUpload(parsed.buffer, `inspection-${key}.jpg`, parsed.contentType, "vehicle-inspections");
        if (!url) {
          // Fall back to an existing photo for this kind if the store failed.
          const prev = existingByKind.get(key);
          if (prev) { resolvedPhotos.push({ kind: key, photoUrl: prev.photoUrl }); continue; }
          return NextResponse.json({ error: `Could not store the ${label} photo. Try again.` }, { status: 500 });
        }
        const prev = existingByKind.get(key);
        if (prev && prev.photoUrl !== url) replacedUrls.push(prev.photoUrl);
        resolvedPhotos.push({ kind: key, photoUrl: url });
      } else if (raw) {
        resolvedPhotos.push({ kind: key, photoUrl: raw });
      }
    }
    if (resolvedPhotos.length < INSPECTION_PHOTO_KINDS.length) {
      const have = new Set(resolvedPhotos.map((p) => p.kind));
      const missing = INSPECTION_PHOTO_KINDS.filter((p) => !have.has(p.key)).map((p) => p.label);
      return NextResponse.json({ error: `Missing required photo(s): ${missing.join(", ")}.` }, { status: 400 });
    }

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
      // Section B is now next-oil-change only. Legacy maintenance columns are left
      // untouched (not written here) so existing history is preserved.
      oilChangeNextMileage,
      oilChangeNext,
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

    // Persist the four photos (replace the set each save).
    await prisma.vehicleInspectionPhoto.deleteMany({ where: { inspectionId: saved.id } });
    await prisma.vehicleInspectionPhoto.createMany({
      data: resolvedPhotos.map((p) => ({ inspectionId: saved.id, kind: p.kind, photoUrl: p.photoUrl })),
    });
    // Best-effort cleanup of blobs/files that were replaced this save.
    for (const u of replacedUrls) await deleteUpload(u).catch(() => {});

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

    // Email a copy of the report to BOTH the graded employee AND the inspector who
    // completed it (previously only the graded employee got it, so the inspecting
    // admin/manager never received a copy). No-ops + logs until an email provider
    // (RESEND_API_KEY) and addresses are configured — nothing actually sends before
    // then; the in-app report (?view=report) is always available regardless.
    const monthName = new Date(year, month - 1, 1).toLocaleString("en-US", { month: "long" });
    const origin = appUrl() || (() => { try { return new URL(req.url).origin; } catch { return ""; } })();
    const abs = (u: string) => (/^https?:\/\//i.test(u) ? u : `${origin}${u.startsWith("/") ? "" : "/"}${u}`);
    const reportUrl = origin ? `${origin}/fleet/${vehicle.id}/inspect?view=report&year=${year}&month=${month}` : "";
    const photosHtml = resolvedPhotos.length
      ? `<p style="margin-top:16px;font-weight:600">Inspection photos</p><table role="presentation" cellpadding="0" cellspacing="8"><tr>${resolvedPhotos
          .map((p) => `<td style="text-align:center;font-size:11px;color:#475569"><a href="${abs(p.photoUrl)}"><img src="${abs(p.photoUrl)}" alt="${inspectionPhotoLabel(p.kind)}" width="120" style="width:120px;height:90px;object-fit:cover;border:1px solid #e2e8f0;border-radius:6px;display:block" /></a><div style="margin-top:4px;max-width:120px">${inspectionPhotoLabel(p.kind)}</div></td>`)
          .join("")}</tr></table>`
      : "";
    const photosText = resolvedPhotos.length
      ? `\nPhotos:\n${resolvedPhotos.map((p) => `- ${inspectionPhotoLabel(p.kind)}: ${abs(p.photoUrl)}`).join("\n")}\n`
      : "";
    const failsHtml = fails.length ? `<p style="color:#b91c1c">Items to correct: ${fails.map((f) => f.label).join("; ")}.</p>` : "";
    const failsText = fails.length ? `\nItems to correct: ${fails.map((f) => f.label).join("; ")}.\n` : "";
    const reportHtml = reportUrl ? `<p><a href="${reportUrl}">View the full report</a></p>` : "";
    const reportText = reportUrl ? `\nFull report: ${reportUrl}\n` : "";
    const scoreLine = `Score: ${score}/${maxScore} (${scorePct}%) — Grade ${grade}`;

    const emailStatuses: Record<string, string> = {};
    const emp = employeeId ? await prisma.employee.findUnique({ where: { id: employeeId } }) : null;

    // 1) Graded driver.
    if (emp?.email) {
      const r = await sendEmail({
        to: emp.email,
        subject: `Your ${monthName} ${year} vehicle inspection — grade ${grade} (${scorePct}%)`,
        kind: "inspection_score",
        relatedType: "vehicle_inspection",
        relatedId: saved.id,
        text: `Hi ${emp.name.split(" ")[0]},\n\nYour ${monthName} ${year} vehicle inspection for ${vlabel} was completed by ${data.inspectorName}.\n\n${scoreLine}.${failsText}${photosText}${reportText}\nThis is recorded on your personnel profile and will factor into your annual review.\n\n— CanopyOS`,
        html: `<p>Hi ${emp.name.split(" ")[0]},</p><p>Your <strong>${monthName} ${year}</strong> vehicle inspection for <strong>${vlabel}</strong> was completed by ${data.inspectorName}.</p><p style="font-size:18px"><strong>${scoreLine}</strong></p>${failsHtml}${photosHtml}${reportHtml}<p>This is recorded on your personnel profile and will factor into your annual review.</p><p>— CanopyOS</p>`,
      });
      emailStatuses.driver = r.status;
    }

    // 2) Inspector who completed it (a copy for their records) — skip if they ARE the
    //    graded employee to avoid a duplicate.
    const inspectorEmail = (user.email ?? "").trim();
    if (inspectorEmail && inspectorEmail.toLowerCase() !== (emp?.email ?? "").toLowerCase()) {
      const r = await sendEmail({
        to: inspectorEmail,
        subject: `Inspection filed — ${vlabel} — ${monthName} ${year} (grade ${grade}, ${scorePct}%)`,
        kind: "inspection_score",
        relatedType: "vehicle_inspection",
        relatedId: saved.id,
        text: `You completed the ${monthName} ${year} vehicle inspection for ${vlabel}${technicianName ? ` (driver: ${technicianName})` : ""}.\n\n${scoreLine}.${failsText}${photosText}${reportText}\n— CanopyOS`,
        html: `<p>You completed the <strong>${monthName} ${year}</strong> vehicle inspection for <strong>${vlabel}</strong>${technicianName ? ` (driver: ${technicianName})` : ""}.</p><p style="font-size:18px"><strong>${scoreLine}</strong></p>${failsHtml}${photosHtml}${reportHtml}<p>— CanopyOS</p>`,
      });
      emailStatuses.inspector = r.status;
    }

    return NextResponse.json({ ok: true, id: saved.id, score, maxScore, scorePct, grade, criticalFailures: fails.length, emailStatuses });
  } catch (e) {
    return fail(e);
  }
}
