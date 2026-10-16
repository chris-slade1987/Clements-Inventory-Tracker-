import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUser, canManageSales } from "@/lib/auth";
import { fail } from "@/lib/http";
import { BRANCHES } from "@/lib/management";
import { upsertOtherSale, voidOtherSale, OTHER_SELLER_ROLES, type OtherSellerRole } from "@/lib/sales";

export const runtime = "nodejs";
export const maxDuration = 20;

const num = (v: unknown) => { const n = typeof v === "number" ? v : parseFloat(String(v ?? "").replace(/[^0-9.-]/g, "")); return Number.isFinite(n) ? n : 0; };
const BRANCH_KEYS = new Set(BRANCHES.map((b) => b.key));

// Manual entry of "other" (non-advisor) branch sales — technicians, branch
// managers, leadership. Service advisors are tracked via /api/sales/funnel; this
// captures everyone else's closed $ against a branch so the dashboard shows the
// true total book = Sales Team + Other. Sales Director / admins only.
export async function POST(req: Request) {
  try {
    const user = await getSessionUser();
    if (!user || !canManageSales(user)) return NextResponse.json({ error: "Only the Sales Director or an admin can log branch sales." }, { status: 403 });

    const body = await req.json().catch(() => null);

    // Reversible remove (soft-delete) / restore.
    if (body?.action === "void" || body?.action === "restore") {
      const id = typeof body?.id === "string" ? body.id : "";
      if (!id) return NextResponse.json({ error: "Missing entry id." }, { status: 400 });
      await voidOtherSale(id, body.action === "void");
      return NextResponse.json({ ok: true });
    }

    const periodKey = typeof body?.periodKey === "string" && /^\d{4}-\d{2}$/.test(body.periodKey) ? body.periodKey : "";
    let branch = typeof body?.branch === "string" ? body.branch : "";
    if (!periodKey) return NextResponse.json({ error: "Missing period." }, { status: 400 });

    // Attribution to a specific non-advisor seller is optional; branch is required.
    // When an employee is linked, snapshot their name/branch so it survives edits.
    let sellerEmployeeId: string | null = typeof body?.sellerEmployeeId === "string" && body.sellerEmployeeId ? body.sellerEmployeeId : null;
    let sellerName: string | null = typeof body?.sellerName === "string" ? body.sellerName : null;
    if (sellerEmployeeId) {
      const emp = await prisma.employee.findUnique({ where: { id: sellerEmployeeId }, select: { id: true, name: true, branch: true } });
      if (!emp) { sellerEmployeeId = null; } else {
        if (!sellerName) sellerName = emp.name;
        if (!branch && emp.branch) branch = emp.branch;
      }
    }
    if (!branch || !BRANCH_KEYS.has(branch)) return NextResponse.json({ error: "Pick a branch for this sale." }, { status: 400 });

    const roleRaw = typeof body?.sellerRole === "string" ? body.sellerRole : "";
    const sellerRole: OtherSellerRole | null = (OTHER_SELLER_ROLES as readonly string[]).includes(roleRaw) ? (roleRaw as OtherSellerRole) : null;
    const closedAmount = num(body?.closedAmount);
    if (closedAmount <= 0 && !body?.id) return NextResponse.json({ error: "Enter the closed $ amount." }, { status: 400 });

    const saved = await upsertOtherSale(
      {
        id: typeof body?.id === "string" ? body.id : null,
        branch, periodKey, sellerEmployeeId, sellerName, sellerRole,
        closedAmount, dealsClosed: num(body?.dealsClosed), note: typeof body?.note === "string" ? body.note : null,
      },
      { userId: user.id, source: "manual" },
    );
    return NextResponse.json({ ok: true, id: saved.id });
  } catch (e) {
    return fail(e);
  }
}
