import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUser, branchLocked } from "@/lib/auth";
import {
  ensureBranchWeek,
  getBranchCommand,
  attestationText,
  COMMAND_ITEMS,
  classifyMetric,
  classifyTech,
  type MetricStatus,
} from "@/lib/branch-command";

export const runtime = "nodejs";

const str = (v: unknown) => {
  const s = typeof v === "string" ? v.trim() : "";
  return s === "" ? null : s;
};
const num = (v: unknown) => {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : parseFloat(String(v).replace(/[^0-9.\-]/g, ""));
  return Number.isFinite(n) ? n : null;
};

// Branch Command weekly actions. Managers + admins only; a branch-locked manager
// may only act on their own branch. The sign-off is gated server-side on the
// forced-feedback rule (all findings answered, all techs reviewed, all items
// checked) so the client can never bypass it.
export async function POST(req: Request) {
  const user = await getSessionUser();
  if (!user || (user.role !== "admin" && user.role !== "manager"))
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = await req.json().catch(() => null);
  const action = str(body?.action);
  const branch = str(body?.branch) ?? user.branch ?? null;
  if (!branch) return NextResponse.json({ error: "No branch." }, { status: 400 });
  if (branchLocked(user) && branch !== user.branch)
    return NextResponse.json({ error: "That is not your branch." }, { status: 403 });

  try {
    const bw = await ensureBranchWeek(branch);
    if (bw.status === "signed" && action !== "reopen")
      return NextResponse.json({ error: "This week is already signed." }, { status: 409 });

    switch (action) {
      case "check": {
        const itemId = str(body?.itemId);
        if (!itemId || !COMMAND_ITEMS.some((i) => i.id === itemId))
          return NextResponse.json({ error: "Unknown item." }, { status: 400 });
        const results: { itemId: string; checked: boolean; note?: string }[] = bw.itemResults
          ? JSON.parse(bw.itemResults)
          : [];
        const idx = results.findIndex((r) => r.itemId === itemId);
        const entry = { itemId, checked: !!body?.checked, note: str(body?.note) ?? undefined };
        if (idx >= 0) results[idx] = entry;
        else results.push(entry);
        await prisma.branchWeek.update({
          where: { id: bw.id },
          data: { itemResults: JSON.stringify(results), status: bw.status === "open" ? "in_review" : bw.status },
        });
        break;
      }

      case "reviewTech": {
        const id = str(body?.techWeekId);
        if (!id) return NextResponse.json({ error: "Missing tech." }, { status: 400 });
        const tw = await prisma.techWeek.findUnique({ where: { id } });
        if (!tw || tw.branchWeekId !== bw.id) return NextResponse.json({ error: "Tech not found." }, { status: 404 });
        await prisma.techWeek.update({
          where: { id },
          data: { reviewed: body?.reviewed !== false, managerNote: str(body?.note) },
        });
        break;
      }

      case "respondFinding": {
        const id = str(body?.findingId);
        const response = str(body?.response);
        if (!id) return NextResponse.json({ error: "Missing finding." }, { status: 400 });
        const f = await prisma.commandFinding.findUnique({ where: { id } });
        if (!f || f.branchWeekId !== bw.id) return NextResponse.json({ error: "Finding not found." }, { status: 404 });
        if (!response) return NextResponse.json({ error: "A written response is required." }, { status: 400 });
        await prisma.commandFinding.update({
          where: { id },
          data: {
            managerResponse: response,
            status: "answered",
            respondedById: user.id,
            respondedByName: user.name ?? user.email,
            respondedAt: new Date(),
          },
        });
        break;
      }

      case "setMetric": {
        // Manual entry (plumbing / stopgap before parsers). Upserts one metric.
        const key = str(body?.key);
        if (!key) return NextResponse.json({ error: "Missing metric key." }, { status: 400 });
        const value = num(body?.value);
        const existing = await prisma.weeklyMetric.findUnique({ where: { branchWeekId_key: { branchWeekId: bw.id, key } } });
        const target = existing?.target ?? num(body?.target);
        const status: MetricStatus = classifyMetric(key, value, target);
        await prisma.weeklyMetric.upsert({
          where: { branchWeekId_key: { branchWeekId: bw.id, key } },
          create: {
            branchWeekId: bw.id,
            domain: str(body?.domain) ?? existing?.domain ?? "production",
            key,
            label: str(body?.label) ?? existing?.label ?? key,
            value,
            displayValue: str(body?.displayValue),
            unit: str(body?.unit) ?? existing?.unit ?? null,
            target,
            status,
            source: "manual",
          },
          update: { value, displayValue: str(body?.displayValue), status, source: "manual" },
        });
        break;
      }

      case "addTech": {
        const name = str(body?.techName);
        if (!name) return NextResponse.json({ error: "Technician name required." }, { status: 400 });
        const production = num(body?.production);
        const productionTarget = num(body?.productionTarget);
        const callbackRate = num(body?.callbackRate);
        const stopsPerDay = num(body?.stopsPerDay);
        const status = classifyTech({ production, productionTarget, callbackRate, stopsPerDay });
        await prisma.techWeek.create({
          data: {
            branchWeekId: bw.id,
            techName: name,
            employeeId: str(body?.employeeId),
            routeNo: str(body?.routeNo),
            production,
            productionTarget,
            stops: num(body?.stops) != null ? Math.round(num(body?.stops)!) : null,
            stopsPerDay,
            unserviced: num(body?.unserviced) != null ? Math.round(num(body?.unserviced)!) : null,
            cancellations: num(body?.cancellations) != null ? Math.round(num(body?.cancellations)!) : null,
            callbacks: num(body?.callbacks) != null ? Math.round(num(body?.callbacks)!) : null,
            callbackRate,
            status,
            source: "manual",
          },
        });
        break;
      }

      case "sign": {
        const view = await getBranchCommand(branch);
        if (!view.gate.canSign) {
          return NextResponse.json(
            {
              error: "Not ready to sign.",
              gate: view.gate,
            },
            { status: 409 },
          );
        }
        const signedName = str(body?.signedName);
        if (!signedName) return NextResponse.json({ error: "Type your name to sign." }, { status: 400 });
        await prisma.branchWeek.update({
          where: { id: bw.id },
          data: {
            status: "signed",
            signedById: user.id,
            signedName,
            signedAt: new Date(),
            attestation: attestationText(signedName, branch),
          },
        });
        // File a copy to the branch manager's personnel record for the oversight
        // trail (mirrors the weekly-checklist archive). Non-fatal.
        try {
          const mgr = await prisma.employee.findFirst({
            where: { status: "active", branch, role: { contains: "Manager" } },
            select: { id: true },
          });
          if (mgr) {
            await prisma.personnelRecord.create({
              data: {
                employeeId: mgr.id,
                branch,
                type: "note",
                category: "branch-command",
                title: `Branch Command signed — ${bw.periodKey}`,
                body: attestationText(signedName, branch),
                details: JSON.stringify({ kind: "branch_command", periodKey: bw.periodKey, branch, branchWeekId: bw.id }),
                authorName: signedName,
              },
            });
          }
        } catch {
          /* non-fatal: the BranchWeek is the system of record */
        }
        break;
      }

      default:
        return NextResponse.json({ error: "Unknown action." }, { status: 400 });
    }

    const view = await getBranchCommand(branch);
    return NextResponse.json({ ok: true, gate: view.gate, status: view.branchWeek.status });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
