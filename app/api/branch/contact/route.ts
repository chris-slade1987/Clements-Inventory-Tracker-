import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUser, branchLocked } from "@/lib/auth";
import { CONTACT_CATEGORIES } from "@/lib/branch-hub";

export const runtime = "nodejs";

const s = (v: unknown) => { const t = typeof v === "string" ? v.trim() : ""; return t === "" ? null : t; };
const CATS = new Set<string>(CONTACT_CATEGORIES.map((c) => c.key));

export async function POST(req: Request) {
  const user = await getSessionUser();
  if (!user || (user.role !== "admin" && user.role !== "manager")) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const body = await req.json().catch(() => null);
  const action = s(body?.action) ?? "create";

  const scopeOk = (branch: string | null) => !branchLocked(user) || branch === user.branch;

  try {
    if (action === "create" || action === "update") {
      const branch = branchLocked(user) ? user.branch : s(body?.branch);
      if (!branch) return NextResponse.json({ error: "Choose a branch." }, { status: 400 });
      if (!scopeOk(branch)) return NextResponse.json({ error: "Not your branch." }, { status: 403 });
      const name = s(body?.name);
      if (!name) return NextResponse.json({ error: "Give the contact a name." }, { status: 400 });
      const data = {
        branch, category: CATS.has(String(body?.category)) ? String(body?.category) : "other", name,
        company: s(body?.company), role: s(body?.role), phone: s(body?.phone), email: s(body?.email), website: s(body?.website), notes: s(body?.notes),
      };
      if (action === "update") {
        const id = s(body?.id);
        if (!id) return NextResponse.json({ error: "Missing contact." }, { status: 400 });
        await prisma.branchContact.update({ where: { id }, data });
        return NextResponse.json({ ok: true, id });
      }
      const c = await prisma.branchContact.create({ data });
      return NextResponse.json({ ok: true, id: c.id });
    }
    if (action === "delete") {
      const id = s(body?.id);
      if (!id) return NextResponse.json({ error: "Missing contact." }, { status: 400 });
      const existing = await prisma.branchContact.findUnique({ where: { id } });
      if (existing && !scopeOk(existing.branch)) return NextResponse.json({ error: "Not your branch." }, { status: 403 });
      await prisma.branchContact.delete({ where: { id } });
      return NextResponse.json({ ok: true });
    }
    return NextResponse.json({ error: "Unknown action." }, { status: 400 });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
