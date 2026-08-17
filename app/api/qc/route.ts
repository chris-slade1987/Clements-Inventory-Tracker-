import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser, branchLocked, scopedBranch } from "@/lib/auth";
import { BRANCHES, branchLabel } from "@/lib/management";
import { sendEmail } from "@/lib/email";
import { qcItems, qcTypeLabel, qcTypeShort, monthKey, type QcResult } from "@/lib/qc";

export const runtime = "nodejs";

const s = (v: unknown) => { const t = typeof v === "string" ? v.trim() : ""; return t === "" ? null : t; };
const dateOf = (v: unknown) => { const t = typeof v === "string" ? v.trim() : ""; if (!t) return null; const d = new Date(t); return isNaN(d.getTime()) ? null : d; };
const fmt = (d: Date) => d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });

// Submit a field QC inspection. Managers/admins only. Files the completed form to
// the evaluated technician's personnel profile and emails them the result.
export async function POST(req: Request) {
  const user = await requireUser();
  if (user.role !== "manager" && user.role !== "admin")
    return NextResponse.json({ error: "Only branch managers may complete a QC inspection." }, { status: 403 });

  const body = await req.json().catch(() => null);
  const type = s(body?.type);
  if (type !== "ghp" && type !== "lo")
    return NextResponse.json({ error: "Choose an inspection type (GHP or L&O)." }, { status: 400 });

  // Resolve the branch — branch-locked managers are pinned to their own.
  let branch: string | null;
  if (branchLocked(user)) branch = user.branch;
  else branch = BRANCHES.find((b) => b.key === s(body?.branch))?.key ?? scopedBranch(user, null);
  if (!branch) return NextResponse.json({ error: "Choose a branch." }, { status: 400 });

  const acctNumber = s(body?.acctNumber);
  const customerFirst = s(body?.customerFirst);
  const customerLast = s(body?.customerLast);
  const inspectionDate = dateOf(body?.inspectionDate) ?? new Date();
  const lastTreatment = dateOf(body?.lastTreatment);
  const technicianEmployeeId = s(body?.technicianEmployeeId);
  if (!acctNumber) return NextResponse.json({ error: "Enter the account number." }, { status: 400 });
  if (!customerFirst || !customerLast) return NextResponse.json({ error: "Enter the customer's first and last name." }, { status: 400 });
  if (!technicianEmployeeId) return NextResponse.json({ error: "Select the technician being evaluated." }, { status: 400 });

  const tech = await prisma.employee.findFirst({
    where: { id: technicianEmployeeId, branch },
    select: { id: true, name: true, email: true, user: { select: { email: true } } },
  });
  if (!tech) return NextResponse.json({ error: "That technician isn't on this branch's roster." }, { status: 400 });

  // Normalize the item results against the form's real items.
  const items = qcItems(type);
  const raw = new Map<string, QcResult>(
    (Array.isArray(body?.results) ? body.results : []).map((r: { itemId?: string; result?: string }) => [r?.itemId, r?.result as QcResult])
  );
  const ok = new Set<QcResult>(["pass", "fail", "na"]);
  const results = items.map((it) => {
    const r = raw.get(it.id);
    return { itemId: it.id, result: ok.has(r as QcResult) ? (r as QcResult) : "na" };
  });
  const passCount = results.filter((r) => r.result === "pass").length;
  const failCount = results.filter((r) => r.result === "fail").length;
  const naCount = results.filter((r) => r.result === "na").length;

  const customer = `${customerFirst} ${customerLast}`;
  const b = branchLabel(branch);

  try {
    const inspection = await prisma.qcInspection.create({
      data: {
        branch,
        type,
        periodKey: monthKey(inspectionDate),
        acctNumber,
        customerFirst,
        customerLast,
        lastTreatment,
        inspectionDate,
        technicianEmployeeId: tech.id,
        technicianName: tech.name,
        results: JSON.stringify(results),
        notes: s(body?.notes),
        passCount,
        failCount,
        naCount,
        createdByUserId: user.id,
        createdByName: user.name,
      },
    });

    // File the completed inspection onto the technician's personnel profile.
    const failLabels = results.filter((r) => r.result === "fail").map((r) => items.find((i) => i.id === r.itemId)?.label).filter(Boolean);
    const bodyText = [
      `${qcTypeLabel(type)} quality-control inspection by ${user.name}.`,
      `Account ${acctNumber} — ${customer}. Inspected ${fmt(inspectionDate)}${lastTreatment ? ` (last treatment ${fmt(lastTreatment)})` : ""}.`,
      `Result: ${passCount} pass · ${failCount} fail · ${naCount} n/a.`,
      failLabels.length ? `Needs attention:\n- ${failLabels.join("\n- ")}` : "No failed items.",
      s(body?.notes) ? `Notes: ${s(body?.notes)}` : null,
    ].filter(Boolean).join("\n\n");
    const rec = await prisma.personnelRecord.create({
      data: {
        employeeId: tech.id,
        branch,
        type: "note",
        category: "qc",
        title: `QC ${qcTypeShort(type)} — ${customer} (${passCount}/${items.length} pass) · ${fmt(inspectionDate)}`,
        body: bodyText,
        details: JSON.stringify({ kind: "qc_inspection", qcInspectionId: inspection.id, type, branch, acctNumber, passCount, failCount, naCount }),
        authorName: user.name,
      },
    }).catch(() => null);
    if (rec) await prisma.qcInspection.update({ where: { id: inspection.id }, data: { personnelRecordId: rec.id } }).catch(() => {});

    // Email the evaluated technician the result.
    const techEmail = tech.email || tech.user?.email || null;
    await sendEmail({
      to: techEmail,
      subject: `QC review — ${qcTypeShort(type)} at ${customer} (${passCount}/${items.length} pass)`,
      kind: "qc_inspection",
      relatedType: "qc_inspection",
      relatedId: inspection.id,
      text: `${user.name} completed a ${qcTypeLabel(type)} quality-control review of your service.\n\nAccount ${acctNumber} — ${customer} (${b}). Inspected ${fmt(inspectionDate)}.\n\nResult: ${passCount} pass · ${failCount} fail.${failLabels.length ? `\n\nNeeds attention:\n- ${failLabels.join("\n- ")}` : ""}${s(body?.notes) ? `\n\nNotes: ${s(body?.notes)}` : ""}\n\n— CanopyOS`,
      html: `<p><strong>${user.name}</strong> completed a ${qcTypeLabel(type)} quality-control review of your service.</p><p>Account <strong>${acctNumber}</strong> — ${customer} (${b}). Inspected ${fmt(inspectionDate)}.</p><p>Result: <strong>${passCount} pass · ${failCount} fail</strong>.</p>${failLabels.length ? `<p>Needs attention:</p><ul>${failLabels.map((l) => `<li>${l}</li>`).join("")}</ul>` : ""}${s(body?.notes) ? `<p>Notes: ${s(body?.notes)}</p>` : ""}<p>— CanopyOS</p>`,
    }).catch(() => null);

    return NextResponse.json({ ok: true, id: inspection.id });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
