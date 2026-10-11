import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { fail } from "@/lib/http";
import { upsertFunnelStat } from "@/lib/sales-funnel";

export const runtime = "nodejs";
export const maxDuration = 60;

// SmarterLaunch (and any future lead/sales system) pushes monthly funnel actuals
// here. Secured by a shared secret in the `x-ingest-key` header (env
// SALES_INGEST_KEY) — NOT a user session, since it's a server-to-server call.
//
// Body: { periodKey: "YYYY-MM", source?: "smarterlaunch",
//         rows: [{ advisorEmail?|advisorName?, leadsCreated, proposalsMade, closedAmount }] }
// Each row is matched to a service advisor by email (preferred) then name; the
// matched funnel row is upserted. Unmatched rows are reported back, never dropped
// silently. Idempotent — re-posting a period overwrites that period's numbers.
const num = (v: unknown) => { const n = typeof v === "number" ? v : parseFloat(String(v ?? "").replace(/[^0-9.-]/g, "")); return Number.isFinite(n) ? n : 0; };
const norm = (s: string) => s.trim().toLowerCase();

export async function POST(req: Request) {
  try {
    const key = process.env.SALES_INGEST_KEY;
    if (!key) return NextResponse.json({ error: "Ingestion is not configured (SALES_INGEST_KEY unset)." }, { status: 503 });
    if (req.headers.get("x-ingest-key") !== key) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });

    const body = await req.json().catch(() => null);
    const periodKey = typeof body?.periodKey === "string" && /^\d{4}-\d{2}$/.test(body.periodKey) ? body.periodKey : "";
    if (!periodKey) return NextResponse.json({ error: "Missing or invalid periodKey (expected YYYY-MM)." }, { status: 400 });
    const source = typeof body?.source === "string" ? body.source : "smarterlaunch";
    const rows: unknown[] = Array.isArray(body?.rows) ? body.rows : [];
    if (rows.length === 0) return NextResponse.json({ error: "No rows." }, { status: 400 });

    // Build advisor lookup by email + name (active service advisors).
    const advisors = await prisma.employee.findMany({
      where: { status: "active", OR: [{ role: { contains: "Advisor" } }, { user: { is: { accessLevel: "sales" } } }] },
      select: { id: true, name: true, email: true, branch: true },
    });
    const byEmail = new Map(advisors.filter((a) => a.email).map((a) => [norm(a.email!), a]));
    const byName = new Map(advisors.map((a) => [norm(a.name), a]));

    let applied = 0;
    const unmatched: string[] = [];
    for (const r of rows as Record<string, unknown>[]) {
      const email = typeof r?.advisorEmail === "string" ? norm(r.advisorEmail) : "";
      const name = typeof r?.advisorName === "string" ? norm(r.advisorName) : "";
      const advisor = (email && byEmail.get(email)) || (name && byName.get(name)) || null;
      if (!advisor) { unmatched.push(r?.advisorEmail as string || r?.advisorName as string || "(no identifier)"); continue; }
      await upsertFunnelStat(
        advisor.id,
        periodKey,
        { leadsCreated: num(r?.leadsCreated), proposalsMade: num(r?.proposalsMade), closedAmount: num(r?.closedAmount) },
        { branch: advisor.branch, source },
      );
      applied++;
    }
    return NextResponse.json({ ok: true, applied, unmatched });
  } catch (e) {
    return fail(e);
  }
}
