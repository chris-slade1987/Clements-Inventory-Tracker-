import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { canManageAts } from "@/lib/ats";
import {
  createTemplate,
  updateTemplate,
  duplicateTemplate,
  setTemplateActive,
  assignJobTemplates,
  listQuestionBank,
  type TemplateKind,
} from "@/lib/hiring-templates";

export const runtime = "nodejs";
export const maxDuration = 20;

const str = (v: unknown) => {
  const s = typeof v === "string" ? v.trim() : "";
  return s === "" ? null : s;
};

// Hiring Template Library CRUD — HR/admin only (canManageAts). The interviewing
// supervisor never edits templates; they only FILL the assigned one.
//   template.create / template.update / template.duplicate / template.setActive
//   job.assignTemplates
//   bank.list  (browse the off-the-shelf question bank)
export async function POST(req: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  if (!canManageAts(user)) return NextResponse.json({ error: "Only HR/admin can manage hiring templates." }, { status: 403 });

  const body = await req.json().catch(() => null);
  const action = str(body?.action);
  if (!action) return NextResponse.json({ error: "Missing action." }, { status: 400 });

  try {
    if (action === "bank.list") {
      const kind = (body?.kind === "screening" ? "screening" : body?.kind === "interview" ? "interview" : undefined) as TemplateKind | undefined;
      const items = await listQuestionBank(kind);
      return NextResponse.json({ ok: true, items });
    }

    if (action === "template.create") {
      const t = await createTemplate(
        { kind: str(body?.kind) ?? "interview", name: str(body?.name) ?? "", description: body?.description, roleKeys: body?.roleKeys, isDefault: !!body?.isDefault, questions: body?.questions },
        user.name,
      );
      return NextResponse.json({ ok: true, id: t.id });
    }

    if (action === "template.update") {
      const id = str(body?.id);
      if (!id) return NextResponse.json({ error: "Missing template id." }, { status: 400 });
      await updateTemplate(id, { name: body?.name, description: body?.description, roleKeys: body?.roleKeys, isDefault: body?.isDefault, active: body?.active, questions: body?.questions });
      return NextResponse.json({ ok: true });
    }

    if (action === "template.duplicate") {
      const id = str(body?.id);
      if (!id) return NextResponse.json({ error: "Missing template id." }, { status: 400 });
      const t = await duplicateTemplate(id, user.name);
      return NextResponse.json({ ok: true, id: t.id });
    }

    if (action === "template.setActive") {
      const id = str(body?.id);
      if (!id) return NextResponse.json({ error: "Missing template id." }, { status: 400 });
      await setTemplateActive(id, !!body?.active);
      return NextResponse.json({ ok: true });
    }

    if (action === "job.assignTemplates") {
      const jobId = str(body?.jobId);
      if (!jobId) return NextResponse.json({ error: "Missing job id." }, { status: 400 });
      await assignJobTemplates(jobId, str(body?.interviewTemplateId), str(body?.screeningTemplateId));
      return NextResponse.json({ ok: true });
    }

    return NextResponse.json({ error: "Unknown action." }, { status: 400 });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
