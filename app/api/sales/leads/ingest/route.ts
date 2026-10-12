import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { fail } from "@/lib/http";
import { LEAD_CHANNELS } from "@/lib/sales-leads";

export const runtime = "nodejs";
export const maxDuration = 60;

// SmarterLaunch (and any future lead system) pushes individual lead records here
// for the geographic heat map + lead-source board. Secured by the same shared
// secret as the funnel ingest (`x-ingest-key` header, env SALES_INGEST_KEY) —
// server-to-server, NOT a user session.
//
// Body: { source?: "smarterlaunch", leads: [{
//   externalId?, advisorEmail?|advisorName?, branch?, address?, city?, zip?,
//   neighborhood?, lat?, lng?, stage?, channel?, provided?, value?, createdAt? }] }
// Each lead is matched to a service advisor by email (preferred) then name.
// Idempotent: a lead with an externalId upserts in place; without one it inserts.
// Unmatched-advisor rows still store (unassigned) and are reported back.

const num = (v: unknown) => { const n = typeof v === "number" ? v : parseFloat(String(v ?? "").replace(/[^0-9.-]/g, "")); return Number.isFinite(n) ? n : 0; };
const norm = (s: string) => s.trim().toLowerCase();
const CHANNEL_KEYS = new Set<string>(LEAD_CHANNELS.map((c) => c.key));
const STAGE_KEYS = new Set<string>(["lead", "proposal", "closed", "lost"]);

export async function POST(req: Request) {
  try {
    const key = process.env.SALES_INGEST_KEY;
    if (!key) return NextResponse.json({ error: "Ingestion is not configured (SALES_INGEST_KEY unset)." }, { status: 503 });
    if (req.headers.get("x-ingest-key") !== key) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });

    const body = await req.json().catch(() => null);
    const source = typeof body?.source === "string" ? body.source : "smarterlaunch";
    const leads: unknown[] = Array.isArray(body?.leads) ? body.leads : [];
    if (leads.length === 0) return NextResponse.json({ error: "No leads." }, { status: 400 });

    const advisors = await prisma.employee.findMany({
      where: { status: "active", OR: [{ role: { contains: "Advisor" } }, { user: { is: { accessLevel: "sales" } } }] },
      select: { id: true, name: true, email: true, branch: true },
    });
    const byEmail = new Map(advisors.filter((a) => a.email).map((a) => [norm(a.email!), a]));
    const byName = new Map(advisors.map((a) => [norm(a.name), a]));

    let applied = 0;
    const unmatched: string[] = [];
    for (const r of leads as Record<string, unknown>[]) {
      const email = typeof r?.advisorEmail === "string" ? norm(r.advisorEmail) : "";
      const name = typeof r?.advisorName === "string" ? norm(r.advisorName) : "";
      const advisor = (email && byEmail.get(email)) || (name && byName.get(name)) || null;
      if (!advisor) unmatched.push((r?.advisorEmail as string) || (r?.advisorName as string) || "(no identifier)");

      const channel = typeof r?.channel === "string" && CHANNEL_KEYS.has(r.channel) ? r.channel : "other";
      const stage = typeof r?.stage === "string" && STAGE_KEYS.has(r.stage) ? r.stage : "lead";
      const provided = typeof r?.provided === "boolean" ? r.provided : (LEAD_CHANNELS.find((c) => c.key === channel)?.provided ?? false);
      const created = typeof r?.createdAt === "string" ? new Date(r.createdAt) : null;
      const data = {
        advisorEmployeeId: advisor?.id ?? null,
        advisorName: advisor?.name ?? (typeof r?.advisorName === "string" ? r.advisorName : null),
        branch: (typeof r?.branch === "string" && r.branch) || advisor?.branch || null,
        address: typeof r?.address === "string" ? r.address : null,
        city: typeof r?.city === "string" ? r.city : null,
        zip: typeof r?.zip === "string" ? r.zip : null,
        neighborhood: typeof r?.neighborhood === "string" ? r.neighborhood : null,
        lat: r?.lat != null ? num(r.lat) : null,
        lng: r?.lng != null ? num(r.lng) : null,
        stage, channel, provided,
        value: num(r?.value),
        origin: source,
        ...(created && !Number.isNaN(created.getTime()) ? { createdAt: created } : {}),
      };

      const externalId = typeof r?.externalId === "string" && r.externalId ? r.externalId : null;
      if (externalId) {
        await prisma.salesLead.upsert({ where: { externalId }, create: { externalId, ...data }, update: data });
      } else {
        await prisma.salesLead.create({ data });
      }
      applied++;
    }
    return NextResponse.json({ ok: true, applied, unmatched });
  } catch (e) {
    return fail(e);
  }
}
