import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUser, branchLocked } from "@/lib/auth";
import { ingestRoutingReport } from "@/lib/routing-ingest";
import { ensureRoutingMonth, getRoutingOverview, getTechDays, currentRoutingPeriod } from "@/lib/routing";
import { geocodeRoutingMonth } from "@/lib/geocode";
import { branchLabel } from "@/lib/management";

export const runtime = "nodejs";
export const maxDuration = 60;

const str = (v: unknown) => { const s = typeof v === "string" ? v.trim() : ""; return s === "" ? null : s; };

// Routing Approval actions. Managers + admins; a branch-locked manager is limited
// to their own branch for everything except upload (one file covers all branches,
// so upload is admin/super-admin only). Sign-off is gated server-side.
export async function POST(req: Request) {
  const user = await getSessionUser();
  if (!user || (user.role !== "admin" && user.role !== "manager"))
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = await req.json().catch(() => null);
  const action = str(body?.action);
  const periodKey = str(body?.periodKey) ?? currentRoutingPeriod();

  try {
    if (action === "upload") {
      // One export spans all four branches → admins/super-admins only.
      if (user.role !== "admin") return NextResponse.json({ error: "Only admins can load the monthly routing export." }, { status: 403 });
      const text = typeof body?.text === "string" ? body.text : "";
      if (!text.trim()) return NextResponse.json({ error: "Empty file." }, { status: 400 });
      const r = await ingestRoutingReport({ text, fileName: str(body?.fileName) ?? "routing.xls", uploadedById: user.id, uploadedByName: user.name ?? user.email });
      if (!r.ok) return NextResponse.json({ error: r.error }, { status: 400 });
      return NextResponse.json(r);
    }

    const branch = str(body?.branch) ?? user.branch ?? null;
    if (!branch) return NextResponse.json({ error: "No branch." }, { status: 400 });
    if (branchLocked(user) && branch !== user.branch)
      return NextResponse.json({ error: "That is not your branch." }, { status: 403 });

    if (action === "techDays") {
      const month = await ensureRoutingMonth(branch, periodKey);
      const techName = str(body?.techName);
      if (!techName) return NextResponse.json({ error: "Missing technician." }, { status: 400 });
      // Best-effort: top up coordinates for this month (bounded) before returning.
      await geocodeRoutingMonth(month.id, 40).catch(() => {});
      const days = await getTechDays(month.id, techName);
      return NextResponse.json({ ok: true, days });
    }

    const month = await ensureRoutingMonth(branch, periodKey);
    if (month.status === "signed" && action !== "reopen")
      return NextResponse.json({ error: "This month is already signed." }, { status: 409 });

    if (action === "approveTech") {
      const id = str(body?.techMonthId);
      if (!id) return NextResponse.json({ error: "Missing technician." }, { status: 400 });
      const tm = await prisma.routeTechMonth.findUnique({ where: { id } });
      if (!tm || tm.routingMonthId !== month.id) return NextResponse.json({ error: "Technician not found." }, { status: 404 });
      await prisma.routeTechMonth.update({
        where: { id },
        data: { approved: body?.approved !== false, approvedNote: str(body?.note), approvedById: user.id, approvedAt: new Date() },
      });
    } else if (action === "respondFinding") {
      const id = str(body?.findingId);
      const response = str(body?.response);
      if (!id) return NextResponse.json({ error: "Missing finding." }, { status: 400 });
      if (!response) return NextResponse.json({ error: "A written response is required." }, { status: 400 });
      const f = await prisma.routingFinding.findUnique({ where: { id } });
      if (!f || f.routingMonthId !== month.id) return NextResponse.json({ error: "Finding not found." }, { status: 404 });
      await prisma.routingFinding.update({
        where: { id },
        data: { managerResponse: response, status: "answered", respondedById: user.id, respondedByName: user.name ?? user.email, respondedAt: new Date() },
      });
    } else if (action === "sign") {
      const view = await getRoutingOverview(branch, periodKey);
      if (!view.gate.canSign) return NextResponse.json({ error: "Not ready to sign.", gate: view.gate }, { status: 409 });
      const signedName = str(body?.signedName);
      if (!signedName) return NextResponse.json({ error: "Type your name to sign." }, { status: 400 });
      await prisma.routingMonth.update({
        where: { id: month.id },
        data: {
          status: "signed", signedById: user.id, signedName, signedAt: new Date(),
          attestation: `I, ${signedName}, have reviewed and approved the ${periodKey} routing for the ${branchLabel(branch)} branch, including every technician's schedule and every flagged item.`,
        },
      });
      try {
        const mgr = await prisma.employee.findFirst({ where: { status: "active", branch, role: { contains: "Manager" } }, select: { id: true } });
        if (mgr) await prisma.personnelRecord.create({ data: { employeeId: mgr.id, branch, type: "note", category: "routing-approval", title: `Routing approved — ${periodKey}`, body: `Signed by ${signedName}.`, authorName: signedName } });
      } catch { /* non-fatal */ }
    } else {
      return NextResponse.json({ error: "Unknown action." }, { status: 400 });
    }

    const view = await getRoutingOverview(branch, periodKey);
    return NextResponse.json({ ok: true, gate: view.gate, status: view.month.status });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
