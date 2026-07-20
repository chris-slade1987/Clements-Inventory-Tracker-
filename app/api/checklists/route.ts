import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser, branchLocked } from "@/lib/auth";
import { BRANCHES } from "@/lib/management";
import { attestationText, parseItems, periodLabelFor, type ItemResult } from "@/lib/checklists";

export const runtime = "nodejs";

// Submit a signed checklist completion. This is an APPEND-ONLY audit record:
// there is no edit or delete, and exactly one signed completion is allowed per
// (template, branch, period). A duplicate submit is refused with a 409.
export async function POST(req: Request) {
  const user = await requireUser();
  if (user.role !== "manager" && user.role !== "admin") {
    return NextResponse.json({ error: "Only branch managers may sign a checklist." }, { status: 403 });
  }

  const body = await req.json().catch(() => null);
  if (body?.action !== "submit") {
    return NextResponse.json({ error: "Unsupported action." }, { status: 400 });
  }

  const templateId = typeof body?.templateId === "string" ? body.templateId : "";
  const periodKey = typeof body?.periodKey === "string" ? body.periodKey : "";
  const signedName = typeof body?.signedName === "string" ? body.signedName.trim() : "";
  const rawResults = Array.isArray(body?.itemResults) ? body.itemResults : [];

  if (!templateId || !periodKey) {
    return NextResponse.json({ error: "Missing checklist or period." }, { status: 400 });
  }
  if (!signedName) {
    return NextResponse.json({ error: "Type your full name to sign the attestation." }, { status: 400 });
  }

  // Resolve the branch. Branch-locked managers can ONLY sign for their own
  // branch (any requested branch is ignored). Admins/exec must name a valid
  // branch — they can't sign for "all".
  let branch: string | null;
  if (branchLocked(user)) {
    branch = user.branch;
  } else {
    const requested = typeof body?.branch === "string" ? body.branch : null;
    branch = BRANCHES.find((b) => b.key === requested)?.key ?? null;
    if (!branch) {
      return NextResponse.json({ error: "Choose a branch to sign for." }, { status: 400 });
    }
  }
  if (!branch) {
    return NextResponse.json({ error: "No branch associated with your account." }, { status: 400 });
  }

  const template = await prisma.checklistTemplate.findUnique({ where: { id: templateId } });
  if (!template) {
    return NextResponse.json({ error: "Checklist not found." }, { status: 404 });
  }

  // Normalize item results against the template's actual items.
  const items = parseItems(template.items);
  const byId = new Map(rawResults.map((r: ItemResult) => [r?.itemId, r]));
  const itemResults: ItemResult[] = items.map((it) => {
    const r = byId.get(it.id) as ItemResult | undefined;
    return {
      itemId: it.id,
      checked: r?.checked === true,
      note: typeof r?.note === "string" ? r.note.slice(0, 2000) : "",
    };
  });

  const periodLabel = periodLabelFor(template.cadence, new Date());
  const attestation = attestationText(signedName, periodLabel, branch);

  // Append-only guard: refuse a duplicate rather than overwriting a signed record.
  const existing = await prisma.checklistCompletion.findUnique({
    where: { templateId_branch_periodKey: { templateId, branch, periodKey } },
  });
  if (existing) {
    return NextResponse.json(
      { error: `This checklist was already signed for ${periodLabel} by ${existing.signedName}. Signed records cannot be changed.` },
      { status: 409 }
    );
  }

  try {
    const completion = await prisma.checklistCompletion.create({
      data: {
        templateId,
        cadence: template.cadence,
        branch,
        periodKey,
        userId: user.id,
        signedName,
        attestation,
        itemResults: JSON.stringify(itemResults),
      },
    });
    return NextResponse.json({ ok: true, id: completion.id });
  } catch (e) {
    // Unique-constraint race → treat as a duplicate.
    if ((e as { code?: string }).code === "P2002") {
      return NextResponse.json(
        { error: "This checklist was just signed for this period. Signed records cannot be changed." },
        { status: 409 }
      );
    }
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
