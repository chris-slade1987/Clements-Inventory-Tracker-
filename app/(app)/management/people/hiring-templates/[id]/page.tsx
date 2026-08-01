import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { PageHeader } from "@/components/ui";
import { requireUser, homePath } from "@/lib/auth";
import { canManageAts } from "@/lib/ats";
import { ROLE_KEYS, templateById, listQuestionBank, parseRoleKeys } from "@/lib/hiring-templates";
import { isResponseType, type ResponseType } from "@/lib/ats-config";
import TemplateEditor, { type EditorQuestion } from "../TemplateEditor";

export const dynamic = "force-dynamic";

export default async function EditTemplatePage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  if (!canManageAts(user)) redirect(homePath(user));
  const { id } = await params;

  const template = await templateById(id);
  if (!template) notFound();
  const kind: "interview" | "screening" = template.kind === "screening" ? "screening" : "interview";
  const bank = await listQuestionBank(kind);

  const questions: EditorQuestion[] = template.questions.map((q) => ({
    id: q.id,
    section: q.section ?? "",
    text: q.text,
    responseType: (isResponseType(q.responseType) ? q.responseType : "text") as ResponseType,
    required: q.required,
  }));

  return (
    <>
      <div className="mb-2">
        <Link href="/management/people/hiring-templates" className="text-xs font-medium text-brand-700 hover:underline">← Hiring Template Library</Link>
      </div>
      <PageHeader title={template.name} subtitle={`${kind === "interview" ? "Interview" : "Screening-call"} template`} />
      <TemplateEditor
        mode="edit"
        templateId={template.id}
        kind={kind}
        initial={{
          name: template.name,
          description: template.description ?? "",
          roleKeys: parseRoleKeys(template.roleKeys),
          isDefault: template.isDefault,
          questions,
        }}
        roleOptions={ROLE_KEYS.map((r) => ({ key: r.key, label: r.label }))}
        bank={bank.map((b) => ({ id: b.id, category: b.category, roleHint: b.roleHint, text: b.text, responseType: b.responseType }))}
      />
    </>
  );
}
