import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser, branchLocked } from "@/lib/auth";
import { BRANCHES } from "@/lib/management";
import { parseItems, type ItemResult } from "@/lib/checklists";
import { canRunSop, sopAttestationText, assignmentPeriodKey, adHocRunKey } from "@/lib/sop";
import { fail, HttpError } from "@/lib/http";

export const runtime = "nodejs";
export const maxDuration = 20;

// Submit a signed SOP run. This is an APPEND-ONLY audit record (same discipline
// as a checklist completion and the stock ledger): there is no edit or delete.
// An ad-hoc run gets a unique run key so multiple runs are allowed; a run tied to
// an assignment uses "asg:<id>" so that assignment is signed exactly once, and the
// assignment is marked completed + linked to the completion.
export async function POST(req: Request) {
  try {
    const user = await requireUser();
    if (!canRunSop(user)) {
      throw new HttpError("Only branch managers may run and sign an SOP.", 403);
    }

    const body = await req.json().catch(() => null);
    if (body?.action !== "submit") throw new HttpError("Unsupported action.");

    const templateId = typeof body?.templateId === "string" ? body.templateId : "";
    const assignmentId = typeof body?.assignmentId === "string" && body.assignmentId ? body.assignmentId : null;
    const signedName = typeof body?.signedName === "string" ? body.signedName.trim() : "";
    const rawResults = Array.isArray(body?.itemResults) ? body.itemResults : [];

    if (!templateId) throw new HttpError("Missing SOP.");
    if (!signedName) throw new HttpError("Type your full name to sign the attestation.");

    const template = await prisma.checklistTemplate.findFirst({ where: { id: templateId, kind: "sop" } });
    if (!template) throw new HttpError("SOP not found.", 404);
    if (!template.active) throw new HttpError("This SOP is inactive and can no longer be run.", 409);

    // Resolve the assignment (if any) and the branch. A branch-locked manager can
    // only sign for their own branch; admins must name a valid branch.
    let assignment = assignmentId
      ? await prisma.sopAssignment.findUnique({ where: { id: assignmentId } })
      : null;
    if (assignmentId && !assignment) throw new HttpError("SOP assignment not found.", 404);
    if (assignment && assignment.templateId !== templateId) {
      throw new HttpError("This assignment is for a different SOP.", 400);
    }
    if (assignment && assignment.status !== "open") {
      throw new HttpError("This SOP assignment was already completed or cancelled.", 409);
    }

    let branch: string | null;
    if (assignment) {
      branch = assignment.branch;
      if (branchLocked(user) && user.branch !== branch) {
        throw new HttpError("You can only sign SOPs for your own branch.", 403);
      }
    } else if (branchLocked(user)) {
      branch = user.branch;
    } else {
      const requested = typeof body?.branch === "string" ? body.branch : null;
      branch = BRANCHES.find((b) => b.key === requested)?.key ?? null;
      if (!branch) throw new HttpError("Choose a branch to sign for.");
    }
    if (!branch) throw new HttpError("No branch associated with your account.");

    // Normalize step results against the template's actual steps, enforcing any
    // required steps server-side (never trust the client alone).
    const steps = parseItems(template.items);
    const byId = new Map<string, ItemResult>(
      rawResults.map((r: ItemResult) => [r?.itemId, r]),
    );
    const itemResults: ItemResult[] = [];
    for (const s of steps) {
      const r = byId.get(s.id);
      const type = s.type ?? "check";
      const checked = r?.checked === true;
      const value = typeof r?.value === "string" ? r.value.trim() : "";
      const photoRef = typeof r?.photoRef === "string" ? r.photoRef.trim() : "";
      const note = typeof r?.note === "string" ? r.note.trim() : "";
      if (s.required) {
        const answered =
          type === "check" ? checked
            : type === "number" || type === "text" ? value.length > 0
              : /* photo */ photoRef.length > 0 || note.length > 0;
        if (!answered) throw new HttpError(`Step "${s.label}" is required.`);
      }
      itemResults.push({ itemId: s.id, checked, note, value, photoRef });
    }

    const periodKey = assignment ? assignmentPeriodKey(assignment.id) : adHocRunKey();
    const attestation = sopAttestationText(signedName, template.title, branch);

    // Append-only guard for an assignment-backed run (a free run key never collides).
    if (assignment) {
      const existing = await prisma.checklistCompletion.findUnique({
        where: { templateId_branch_periodKey: { templateId, branch, periodKey } },
      });
      if (existing) throw new HttpError("This SOP was already signed. Signed records cannot be changed.", 409);
    }

    const completion = await prisma.checklistCompletion.create({
      data: {
        templateId,
        cadence: "none",
        branch,
        periodKey,
        templateVersion: template.version,
        userId: user.id,
        signedName,
        attestation,
        itemResults: JSON.stringify(itemResults),
      },
    });

    // Close the assignment (append-only: completed, never deleted).
    if (assignment) {
      await prisma.sopAssignment.update({
        where: { id: assignment.id },
        data: { status: "completed", completedAt: new Date(), completionId: completion.id },
      });
    }

    // Auto-file the signed SOP to the branch manager's personnel profile, mirroring
    // the checklist auto-file. Non-fatal — the completion is the system of record.
    try {
      const mgr = await prisma.employee.findFirst({
        where: { status: "active", branch, role: { contains: "Manager" } },
        select: { id: true },
      });
      if (mgr) {
        const done = itemResults.filter((r) => r.checked || r.value || r.photoRef).length;
        await prisma.personnelRecord.create({
          data: {
            employeeId: mgr.id,
            branch,
            type: "note",
            category: "checklist",
            title: `SOP: ${template.title} (v${template.version}) — ${done}/${itemResults.length} steps`,
            body: `Signed by ${signedName}.`,
            details: JSON.stringify({
              kind: "sop_completion", templateKey: template.key, templateVersion: template.version,
              branch, completionId: completion.id, assignmentId: assignment?.id ?? null, done, total: itemResults.length,
            }),
            authorName: signedName,
          },
        });
      }
    } catch {
      /* non-fatal */
    }

    return NextResponse.json({ ok: true, id: completion.id });
  } catch (e) {
    if ((e as { code?: string }).code === "P2002") {
      return NextResponse.json(
        { error: "This SOP was just signed. Signed records cannot be changed." },
        { status: 409 },
      );
    }
    return fail(e);
  }
}
