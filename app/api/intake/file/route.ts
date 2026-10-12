import { fail } from "@/lib/http";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUser, branchLocked } from "@/lib/auth";
import {
  INTAKE_DESTINATIONS, execVehicleDocument, execBranchDocument, execMbrHandoff, execGeneralFile,
  type DestinationKey, type RouteParams, type ExecResult,
} from "@/lib/intake";

export const runtime = "nodejs";
export const maxDuration = 30;

const s = (v: unknown) => { const t = typeof v === "string" ? v.trim() : ""; return t === "" ? null : t; };

// Execute an APPROVED routing proposal. The human pressed "Approve"; we file the
// document to the chosen destination and record where it went. Each destination
// re-checks its own permission (defense-in-depth behind the page gate).
export async function POST(req: Request) {
  const user = await getSessionUser();
  if (!user || (user.role !== "admin" && user.role !== "manager"))
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = await req.json().catch(() => null);
  const docId = s(body?.docId);
  const destination = s(body?.destination) as DestinationKey | null;
  const params: RouteParams = (body?.params && typeof body.params === "object" ? body.params : {}) as RouteParams;
  if (!docId) return NextResponse.json({ error: "Missing document." }, { status: 400 });
  const dest = INTAKE_DESTINATIONS.find((d) => d.key === destination);
  if (!dest) return NextResponse.json({ error: "Unknown destination." }, { status: 400 });
  if (dest.adminOnly && user.role !== "admin")
    return NextResponse.json({ error: "Only an admin can route this." }, { status: 403 });

  const doc = await prisma.intakeDocument.findUnique({ where: { id: docId } });
  if (!doc) return NextResponse.json({ error: "Document not found." }, { status: 404 });
  if (doc.status === "filed") return NextResponse.json({ error: "This document has already been filed." }, { status: 409 });

  // Branch-locked managers can only file to their own branch.
  if (branchLocked(user) && (destination === "branch_document" || destination === "general_file")) {
    params.branch = user.branch ?? null;
  }

  try {
    let result: ExecResult;
    if (destination === "vehicle_document") {
      result = await execVehicleDocument(doc, params, user);
    } else if (destination === "branch_document") {
      result = await execBranchDocument(doc, params, user);
    } else if (destination === "mbr_handoff") {
      result = execMbrHandoff();
    } else {
      result = execGeneralFile(params);
    }

    await prisma.intakeDocument.update({
      where: { id: docId },
      data: {
        status: dest.handoff ? "pending" : "filed", // a hand-off isn't filed here; the manager finishes it on the target screen
        routedTo: destination,
        routedRef: result.ref,
        routedLabel: result.label,
        branch: s(params.branch),
        tags: s(params.tags),
        notes: s(params.notes),
        filedAt: dest.handoff ? null : new Date(),
      },
    });

    return NextResponse.json({ ok: true, label: result.label, redirect: result.redirect ?? null, handoff: !!dest.handoff });
  } catch (e) {
    return fail(e);
  }
}
