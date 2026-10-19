import { NextResponse } from "next/server";
import { fail } from "@/lib/http";
import { getSessionUser } from "@/lib/auth";
import { updateTileFields, type TileFieldPatch } from "@/lib/org-chart";

export const runtime = "nodejs";
export const maxDuration = 20;

// Org Chart (Round 1) — scoped edit of an employee's operational TILE FIELDS
// (routeNumber, approvedServices, serviceNotes, serviceSchedulingNote,
// personalSchedulingNote).
//   POST /api/org/tile { employeeId, ...fields } → { ok, tile }
//
// Scope (HR/leadership/super-admins anyone; a branch manager only their own
// branch) is enforced in `updateTileFields` against the TARGET employee's branch.
export async function POST(req: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  try {
    const body = await req.json().catch(() => null);
    const employeeId = typeof body?.employeeId === "string" ? body.employeeId : "";
    if (!employeeId) return NextResponse.json({ error: "Missing employee." }, { status: 400 });

    // Only forward the known tile fields that were actually provided, so absent
    // keys are left untouched and nothing else on the record can be written.
    const patch: TileFieldPatch = {};
    if ("routeNumber" in body) patch.routeNumber = body.routeNumber;
    if ("approvedServices" in body) patch.approvedServices = body.approvedServices;
    if ("serviceNotes" in body) patch.serviceNotes = body.serviceNotes;
    if ("serviceSchedulingNote" in body) patch.serviceSchedulingNote = body.serviceSchedulingNote;
    if ("personalSchedulingNote" in body) patch.personalSchedulingNote = body.personalSchedulingNote;

    const tile = await updateTileFields(user, employeeId, patch);
    return NextResponse.json({ ok: true, tile });
  } catch (e) {
    return fail(e);
  }
}
