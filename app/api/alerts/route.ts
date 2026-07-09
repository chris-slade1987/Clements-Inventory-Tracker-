import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth";

const ALLOWED = new Set(["open", "acknowledged", "dismissed"]);

// Update an alert's status (acknowledge / dismiss / reopen).
export async function POST(req: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => null);
  const id: string = body?.id ?? "";
  const status: string = body?.status ?? "";
  if (!id || !ALLOWED.has(status)) {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }
  await prisma.alert.update({ where: { id }, data: { status } });
  return NextResponse.json({ ok: true });
}
