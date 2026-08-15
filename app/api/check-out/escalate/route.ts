import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUser, isBoardObserver } from "@/lib/auth";
import {
  resolveRecipients,
  notifyThread,
  inventoryEscalationRecipientKeys,
  branchLabel,
} from "@/lib/threads";

export const runtime = "nodejs";
export const maxDuration = 20;

type OffendingIn = {
  name?: unknown;
  onHand?: unknown;
  requested?: unknown;
  after?: unknown;
};

const s = (v: unknown) => {
  const t = typeof v === "string" ? v.trim() : "";
  return t === "" ? null : t;
};

// Escalate an insufficient-stock hard stop on Check-Out to senior management.
// Opens an internal discussion (same create path as /api/threads) that
// auto-notifies Julie Glanville, Graham Foster, and Chris Slade by email.
export async function POST(req: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  if (isBoardObserver(user))
    return NextResponse.json({ error: "Board observers have read-only access." }, { status: 403 });

  const body = await req.json().catch(() => null);
  const warehouseId = s(body?.warehouseId);
  const note = s(body?.note);
  const rawOffending: OffendingIn[] = Array.isArray(body?.offending) ? body.offending : [];

  const offending = rawOffending
    .map((o) => ({
      name: typeof o.name === "string" && o.name.trim() ? o.name.trim() : "Unknown product",
      onHand: Number(o.onHand),
      requested: Number(o.requested),
      after: Number(o.after),
    }))
    .filter((o) => Number.isFinite(o.onHand) && Number.isFinite(o.requested));

  if (!warehouseId) return NextResponse.json({ error: "Missing warehouse." }, { status: 400 });
  if (offending.length === 0)
    return NextResponse.json({ error: "Nothing to escalate." }, { status: 400 });

  const warehouse = await prisma.warehouse.findUnique({ where: { id: warehouseId } });
  if (!warehouse) return NextResponse.json({ error: "Warehouse not found." }, { status: 404 });

  try {
    // Resolve the stakeholders (by the email constant) to recipient keys, then
    // reuse resolveRecipients so participants carry the right name/email/ids.
    const keys = await inventoryEscalationRecipientKeys(user.id);
    const recipients = await resolveRecipients(user, keys);

    const reporterBranch = user.branch ? branchLabel(user.branch) : null;
    const reporter = reporterBranch ? `${user.name} (${reporterBranch})` : user.name;

    const subject = `Inventory discrepancy — ${warehouse.name} — needs reconciliation`;
    const contextLabel = `Inventory — ${warehouse.name}`;

    const lines = offending.map((o) => {
      const shortfall = Math.max(0, o.requested - o.onHand);
      return `• ${o.name}: ${o.onHand} on hand, tried to check out ${o.requested} (short ${shortfall})`;
    });

    const message = [
      `${reporter} hit an insufficient-stock block checking out from ${warehouse.name}.`,
      "",
      "Shortfalls:",
      ...lines,
      "",
      "We need help reconciling on-hand before these products can be dispensed. Please verify the warehouse's physical count and re-log the correct received amount, or reconcile on-hand.",
      ...(note ? ["", `Note from ${user.name}: ${note}`] : []),
    ].join("\n");

    const now = new Date();
    const thread = await prisma.thread.create({
      data: {
        subject,
        branch: user.branch ?? null,
        contextType: "general",
        contextId: warehouseId,
        contextLabel,
        contextHref: "/check-out",
        createdByUserId: user.id,
        createdByName: user.name,
        updatedAt: now,
        messages: {
          create: { authorUserId: user.id, authorName: user.name, body: message },
        },
        participants: {
          create: [
            { userId: user.id, name: user.name, email: user.email, role: "owner", lastReadAt: now },
            ...recipients
              .filter((r) => r.userId !== user.id)
              .map((r) => ({ userId: r.userId, employeeId: r.employeeId, name: r.name, email: r.email })),
          ],
        },
      },
    });

    await notifyThread({
      threadId: thread.id,
      subject,
      contextLabel,
      authorName: user.name,
      authorUserId: user.id,
      body: message,
      isNew: true,
    }).catch(() => {});

    return NextResponse.json({ ok: true, threadId: thread.id });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
