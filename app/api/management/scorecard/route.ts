import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth";

export const runtime = "nodejs";

// Upsert one metric's target / Met-Not-Met / note for a (quarter, branch).
export async function POST(req: Request) {
  const user = await getSessionUser();
  if (!user || user.role !== "admin")
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = await req.json().catch(() => null);
  const year = Number(body?.year);
  const quarter = Number(body?.quarter);
  const branch = String(body?.branch ?? "");
  const metricKey = String(body?.metricKey ?? "");
  if (!year || !quarter || !branch || !metricKey)
    return NextResponse.json({ error: "Missing key fields." }, { status: 400 });

  const data: { target?: string | null; met?: boolean | null; note?: string | null } = {};
  if ("target" in body) data.target = body.target === "" ? null : String(body.target);
  if ("met" in body) data.met = body.met === null ? null : Boolean(body.met);
  if ("note" in body) data.note = body.note === "" ? null : String(body.note);

  await prisma.scorecardResult.upsert({
    where: { year_quarter_branch_metricKey: { year, quarter, branch, metricKey } },
    create: { year, quarter, branch, metricKey, ...data },
    update: data,
  });
  return NextResponse.json({ ok: true });
}
