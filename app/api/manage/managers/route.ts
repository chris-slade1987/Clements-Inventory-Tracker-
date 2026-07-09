import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUser, hashPassword } from "@/lib/auth";

async function guard() {
  const user = await getSessionUser();
  if (!user || user.role !== "admin") return null;
  return user;
}

export async function POST(req: Request) {
  const user = await guard();
  if (!user) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = await req.json().catch(() => null);
  const action: string = body?.action ?? "";

  try {
    if (action === "create") {
      const name = String(body?.name ?? "").trim();
      const email = String(body?.email ?? "").trim().toLowerCase();
      const password = String(body?.password ?? "");
      const role = body?.role === "admin" ? "admin" : "manager";
      const warehouseId = body?.warehouseId ? String(body.warehouseId) : null;

      if (!name || !email) return NextResponse.json({ error: "Name and email are required." }, { status: 400 });
      if (password.length < 8)
        return NextResponse.json({ error: "Password must be at least 8 characters." }, { status: 400 });

      const m = await prisma.user.create({
        data: { name, email, passwordHash: hashPassword(password), role, warehouseId },
      });
      return NextResponse.json({ ok: true, id: m.id });
    }

    if (action === "setActive") {
      const id = String(body?.id ?? "");
      const active = body?.active === true;
      if (!id) return NextResponse.json({ error: "Missing id." }, { status: 400 });
      if (id === user.id && !active) {
        return NextResponse.json(
          { error: "You can't deactivate your own account." },
          { status: 400 }
        );
      }
      await prisma.user.update({ where: { id }, data: { active } });
      return NextResponse.json({ ok: true });
    }

    if (action === "resetPassword") {
      const id = String(body?.id ?? "");
      const password = String(body?.password ?? "");
      if (!id) return NextResponse.json({ error: "Missing id." }, { status: 400 });
      if (password.length < 8)
        return NextResponse.json({ error: "Password must be at least 8 characters." }, { status: 400 });
      await prisma.user.update({ where: { id }, data: { passwordHash: hashPassword(password) } });
      // Invalidate existing sessions for that user so the old password stops working.
      await prisma.session.deleteMany({ where: { userId: id } });
      return NextResponse.json({ ok: true });
    }

    return NextResponse.json({ error: "Unknown action." }, { status: 400 });
  } catch (e) {
    const msg = (e as { code?: string }).code === "P2002"
      ? "That email is already in use."
      : (e as Error).message;
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}
