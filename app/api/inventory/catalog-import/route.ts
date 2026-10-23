import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUser, isSuperAdmin } from "@/lib/auth";
import { importCatalog } from "@/lib/catalog-import";

export const runtime = "nodejs";
export const maxDuration = 60;

// POST /api/inventory/catalog-import  { apply?: boolean }
// Super-admin-only. Previews (default) or applies the SiteOne catalog CSV import —
// ADD/UPDATE one product per distinct item number. Idempotent: re-running after
// an apply reports every row as "unchanged".
export async function POST(req: Request) {
  const user = await getSessionUser();
  if (!user || !isSuperAdmin(user)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = await req.json().catch(() => ({}));
  const apply = body?.apply === true;

  const report = await importCatalog(prisma, { apply });
  return NextResponse.json({ ok: true, report });
}
