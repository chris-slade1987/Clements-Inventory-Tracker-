import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUser, isBoardObserver } from "@/lib/auth";
import { userCanAccess } from "@/lib/access";
import { checkInChat, type ChatTurn, type CheckInDraftState, type DraftLine } from "@/lib/check-in-ai";

export const runtime = "nodejs";
export const maxDuration = 45;

// Conversational editor for the Check-In draft. Takes the current draft + the
// manager's instruction, asks Claude for a revised draft, and returns it for the
// client to apply. NEVER posts stock — on-hand changes only through
// POST /api/check-in/confirm when the manager clicks Confirm.
export async function POST(req: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (isBoardObserver(user)) return NextResponse.json({ error: "Board observers have read-only access." }, { status: 403 });
  if (user.role !== "admin" && user.role !== "manager" && !(await userCanAccess(user, "check-in")))
    return NextResponse.json({ error: "You don't have access to Check-In." }, { status: 403 });

  const body = await req.json().catch(() => null);
  const message = typeof body?.message === "string" ? body.message.trim() : "";
  if (!message) return NextResponse.json({ error: "Type a message." }, { status: 400 });

  const draftIn = (body?.draft && typeof body.draft === "object" ? body.draft : {}) as Record<string, unknown>;
  const rawLines = Array.isArray(draftIn.lines) ? draftIn.lines : [];
  const lines: DraftLine[] = rawLines.map((l) => {
    const r = (l && typeof l === "object" ? l : {}) as Record<string, unknown>;
    const q = typeof r.quantity === "string" ? parseFloat(r.quantity) : (r.quantity as number);
    const up = r.unitPrice == null ? null : typeof r.unitPrice === "string" ? parseFloat(r.unitPrice) : (r.unitPrice as number);
    const lt = r.lineTotal == null ? null : typeof r.lineTotal === "string" ? parseFloat(r.lineTotal) : (r.lineTotal as number);
    return {
      descriptionRaw: String(r.descriptionRaw ?? r.description ?? "").trim(),
      quantity: Number.isFinite(q) ? (q as number) : 0,
      unit: r.unit == null ? null : String(r.unit),
      unitPrice: typeof up === "number" && Number.isFinite(up) ? up : null,
      lineTotal: typeof lt === "number" && Number.isFinite(lt) ? lt : null,
      productId: r.productId == null ? null : String(r.productId),
    };
  });
  const draft: CheckInDraftState = {
    warehouseId: draftIn.warehouseId == null ? null : String(draftIn.warehouseId),
    distributor: draftIn.distributor == null ? null : String(draftIn.distributor),
    invoiceNumber: draftIn.invoiceNumber == null ? null : String(draftIn.invoiceNumber),
    invoiceDate: draftIn.invoiceDate == null ? null : String(draftIn.invoiceDate),
    lines,
  };

  const history: ChatTurn[] = Array.isArray(body?.history)
    ? (body.history as unknown[])
        .map((m) => (m && typeof m === "object" ? (m as { role?: string; content?: string }) : null))
        .filter((m): m is { role: string; content: string } => !!m && (m.role === "user" || m.role === "assistant") && typeof m.content === "string")
        .map((m) => ({ role: m.role as "user" | "assistant", content: m.content }))
    : [];

  // Resolve the warehouse list server-side so the assistant can map a branch/city
  // name the manager mentions ("put this in Stuart") to a real warehouse id.
  const warehouses = await prisma.warehouse.findMany({ where: { active: true }, orderBy: { name: "asc" }, select: { id: true, name: true } });

  const result = await checkInChat(draft, warehouses, history, message);
  return NextResponse.json({ ok: true, reply: result.reply, draft: result.draft, ai: result.ai });
}
