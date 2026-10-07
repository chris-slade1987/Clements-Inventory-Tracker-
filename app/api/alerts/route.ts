import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUser, isBoardObserver } from "@/lib/auth";
import { INVENTORY_ALERT_TYPES } from "@/lib/anomaly";
import { fail, HttpError } from "@/lib/http";

export const maxDuration = 20;

const ALLOWED = new Set(["open", "acknowledged", "dismissed"]);

// Update an alert's status (acknowledge / dismiss / reopen), or — with
// action:"dismissAll" — dismiss every open inventory alert at once (admin only).
export async function POST(req: Request) {
  try {
    const user = await getSessionUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (isBoardObserver(user)) throw new HttpError("Board observers have read-only access.", 403);

    const body = await req.json().catch(() => null);

    if (body?.action === "dismissAll") {
      // Bulk clear the inventory-alert backlog (e.g. ahead of an inventory reset).
      if (user.role !== "admin") throw new HttpError("Only an admin can clear all alerts.", 403);
      const res = await prisma.alert.updateMany({
        where: { status: { in: ["open", "acknowledged"] }, type: { in: [...INVENTORY_ALERT_TYPES] } },
        data: { status: "dismissed" },
      });
      return NextResponse.json({ ok: true, dismissed: res.count });
    }

    const id: string = body?.id ?? "";
    const status: string = body?.status ?? "";
    if (!id || !ALLOWED.has(status)) throw new HttpError("Invalid request.");
    await prisma.alert.update({ where: { id }, data: { status } });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return fail(e);
  }
}
