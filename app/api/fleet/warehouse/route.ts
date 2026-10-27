import { fail } from "@/lib/http";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUser, branchLocked, isFieldOpsDirector, isSuperAdmin } from "@/lib/auth";
import { scoreWarehouse, criticalFailures, photoPromptLabel, mondayOf, type Checks, type NeedInput } from "@/lib/warehouse";
import { branchLabel } from "@/lib/management";
import { saveUpload } from "@/lib/storage";
import { sendEmail } from "@/lib/email";

export const runtime = "nodejs";
export const maxDuration = 30;

const str = (v: unknown) => { const s = typeof v === "string" ? v.trim() : ""; return s === "" ? null : s; };
const int = (v: unknown) => { const n = parseInt(String(v ?? "").replace(/[^0-9-]/g, ""), 10); return Number.isFinite(n) ? n : null; };
const date = (v: unknown) => { if (!v) return null; const d = new Date(String(v)); return isNaN(d.getTime()) ? null : d; };

function decodeDataUrl(d: unknown): { buf: Buffer; ct: string } | null {
  const m = /^data:([^;]+);base64,([\s\S]+)$/.exec(typeof d === "string" ? d : "");
  if (!m) return null;
  try { return { buf: Buffer.from(m[2], "base64"), ct: m[1] || "image/jpeg" }; } catch { return null; }
}

export async function POST(req: Request) {
  const user = await getSessionUser();
  if (!user || (user.role !== "admin" && user.role !== "manager"))
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = await req.json().catch(() => null);
  const action = body?.action ?? "save";

  try {
    // Resolve a supply/facility need — leadership (admin / Director of Field Ops) closes the loop.
    if (action === "resolveNeed") {
      if (user.role !== "admin" && !isFieldOpsDirector(user)) return NextResponse.json({ error: "Only leadership can resolve needs." }, { status: 403 });
      const id = str(body?.id);
      if (!id) return NextResponse.json({ error: "Missing id." }, { status: 400 });
      const open = body?.open === true;
      await prisma.warehouseNeed.update({ where: { id }, data: { status: open ? "open" : "resolved", resolvedAt: open ? null : new Date(), resolvedByName: open ? null : user.name } });
      return NextResponse.json({ ok: true });
    }

    const branch = str(body?.branch);
    if (!branch) return NextResponse.json({ error: "Missing branch." }, { status: 400 });
    if (branchLocked(user) && user.branch !== branch)
      return NextResponse.json({ error: "That branch is not yours." }, { status: 403 });

    // Weekly emergency-equipment check (eyewash activation, etc.) — one per branch per week.
    if (action === "weeklyCheck") {
      const weekStart = mondayOf(new Date());
      const payload = { branch, weekStart, date: new Date(), checks: JSON.stringify(body?.checks ?? {}), note: str(body?.note), inspectorName: str(body?.inspectorName) ?? user.name };
      await prisma.weeklyEquipmentCheck.upsert({ where: { branch_weekStart: { branch, weekStart } }, create: payload, update: { checks: payload.checks, note: payload.note, date: payload.date, inspectorName: payload.inspectorName } });
      return NextResponse.json({ ok: true });
    }

    const when = date(body?.date) ?? new Date();
    const year = int(body?.year) ?? when.getFullYear();
    const month = int(body?.month) ?? when.getMonth() + 1;
    const checks: Checks = (body?.checks ?? {}) as Checks;
    const { score, maxScore, scorePct, grade } = scoreWarehouse(checks);
    const inspectorName = str(body?.inspectorName) ?? user.name;

    const signName = str(body?.inspectorSignedName);
    const data = {
      branch, year, month, date: when, inspectorName,
      checks: JSON.stringify(checks),
      comments: JSON.stringify(body?.comments ?? {}),
      notes: str(body?.notes),
      score, maxScore, scorePct, grade,
      // Only stamp the signature when one is provided, so a later edit without
      // re-signing never wipes the attestation already on file.
      ...(signName ? { inspectorSignedName: signName, inspectorSignedAt: new Date() } : {}),
    };
    const saved = await prisma.warehouseInspection.upsert({
      where: { branch_year_month: { branch, year, month } },
      create: data,
      update: data,
    });

    // --- Guided photos: upsert each provided prompt photo; remove any flagged. ---
    const photos = Array.isArray(body?.photos) ? body.photos : [];
    for (const p of photos) {
      const promptKey = str(p?.promptKey);
      const decoded = decodeDataUrl(p?.dataUrl);
      if (!promptKey || !decoded) continue;
      const url = await saveUpload(decoded.buf, `warehouse-${branch}-${year}${String(month).padStart(2, "0")}-${promptKey}.jpg`, decoded.ct, "warehouse");
      if (!url) continue;
      await prisma.warehouseInspectionPhoto.upsert({
        where: { inspectionId_promptKey: { inspectionId: saved.id, promptKey } },
        create: { inspectionId: saved.id, promptKey, label: photoPromptLabel(promptKey), photoUrl: url, caption: str(p?.caption) },
        update: { photoUrl: url, caption: str(p?.caption) },
      });
    }
    const removeKeys: string[] = Array.isArray(body?.removePhotoPromptKeys) ? body.removePhotoPromptKeys.filter((k: unknown) => typeof k === "string") : [];
    if (removeKeys.length) await prisma.warehouseInspectionPhoto.deleteMany({ where: { inspectionId: saved.id, promptKey: { in: removeKeys } } });

    // --- Needs: "out of my control — here's what I need". Replace for this inspection. ---
    const needsIn: NeedInput[] = (Array.isArray(body?.needs) ? body.needs : [])
      .map((n: { itemKey?: unknown; label?: unknown; request?: unknown }) => ({ itemKey: str(n?.itemKey), label: str(n?.label), request: str(n?.request) }))
      .filter((n: NeedInput) => !!n.request);
    await prisma.warehouseNeed.deleteMany({ where: { inspectionId: saved.id } });
    if (needsIn.length) {
      await prisma.warehouseNeed.createMany({
        data: needsIn.map((n) => ({ inspectionId: saved.id, branch, year, month, itemKey: n.itemKey, label: n.label, request: n.request, raisedByName: inspectorName })),
      });
    }

    // --- Alerts: critical failures (existing) + raised needs (new). ---
    const fails = criticalFailures(checks);
    const period = `${year}-${String(month).padStart(2, "0")}`;
    const critKey = `warehouse_critical:${branch}:${period}`;
    if (fails.length > 0) {
      const msg = `${branchLabel(branch)} warehouse: ${fails.length} critical safety failure${fails.length === 1 ? "" : "s"} — ${fails.map((f) => f.label).join("; ")}.`;
      await prisma.alert.upsert({ where: { dedupeKey: critKey }, create: { dedupeKey: critKey, type: "warehouse_critical", message: msg, severity: "critical", status: "open" }, update: { message: msg, severity: "critical" } });
    } else {
      await prisma.alert.deleteMany({ where: { dedupeKey: critKey } });
    }

    const needKey = `warehouse_need:${branch}:${period}`;
    let emailStatus: string | null = null;
    if (needsIn.length > 0) {
      const msg = `${branchLabel(branch)} warehouse: ${needsIn.length} item${needsIn.length === 1 ? "" : "s"} flagged for the supervisor — ${needsIn.map((n) => n.request).join("; ")}.`;
      await prisma.alert.upsert({ where: { dedupeKey: needKey }, create: { dedupeKey: needKey, type: "warehouse_need", message: msg, severity: "warning", status: "open" }, update: { message: msg, severity: "warning" } });

      // Escalate to the Director of Field Ops + super admins (email).
      const admins = await prisma.user.findMany({ where: { role: "admin" }, select: { email: true } });
      const to = [...admins.map((a) => a.email), process.env.FIELD_OPS_EMAIL || "gfoster@clementspestcontrol.com"].filter(Boolean) as string[];
      const label = branchLabel(branch);
      const list = needsIn.map((n) => `• ${n.label ? `${n.label}: ` : ""}${n.request}`).join("\n");
      const res = await sendEmail({
        to,
        kind: "warehouse_need",
        relatedType: "warehouse_inspection",
        relatedId: saved.id,
        subject: `${label} warehouse — ${needsIn.length} alert${needsIn.length === 1 ? "" : "s"} need the supervisor (${inspectorName})`,
        text: `During the ${new Date(year, month - 1, 1).toLocaleString("en-US", { month: "long", year: "numeric" })} warehouse safety inspection at ${label}, ${inspectorName} raised ${needsIn.length} alert${needsIn.length === 1 ? "" : "s"} for the supervisor — a failed item the branch needs help with (e.g. a missing fire extinguisher, a broken lock):\n\n${list}\n\nThese are highlighted on the inspection report and tracked as open until the supervisor resolves them.\n\n— CanopyOS`,
        html: `<p>During the <strong>${new Date(year, month - 1, 1).toLocaleString("en-US", { month: "long", year: "numeric" })}</strong> warehouse safety inspection at <strong>${label}</strong>, ${inspectorName} raised <strong>${needsIn.length}</strong> alert${needsIn.length === 1 ? "" : "s"} for the supervisor — a failed item the branch needs help with (e.g. a missing fire extinguisher, a broken lock):</p><ul>${needsIn.map((n) => `<li>${n.label ? `<strong>${n.label}:</strong> ` : ""}${n.request}</li>`).join("")}</ul><p>These are highlighted on the inspection report and tracked as open until the supervisor resolves them.</p><p>— CanopyOS</p>`,
      });
      emailStatus = res.status;
    } else {
      await prisma.alert.deleteMany({ where: { dedupeKey: needKey } });
    }

    return NextResponse.json({ ok: true, id: saved.id, score, maxScore, scorePct, grade, criticalFailures: fails.length, needs: needsIn.length, emailStatus });
  } catch (e) {
    return fail(e);
  }
}
