import Link from "next/link";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/ui";
import { requireUser, homePath } from "@/lib/auth";
import { canManageAts } from "@/lib/ats";
import { ROLE_KEYS, listQuestionBank } from "@/lib/hiring-templates";
import TemplateEditor from "../TemplateEditor";

export const dynamic = "force-dynamic";

export default async function NewTemplatePage({ searchParams }: { searchParams: Promise<{ kind?: string }> }) {
  const user = await requireUser();
  if (!canManageAts(user)) redirect(homePath(user));
  const { kind: kindParam } = await searchParams;
  const kind: "interview" | "screening" = kindParam === "screening" ? "screening" : "interview";

  const bank = await listQuestionBank(kind);

  return (
    <>
      <div className="mb-2">
        <Link href="/management/people/hiring-templates" className="text-xs font-medium text-brand-300 hover:underline">← Hiring Template Library</Link>
      </div>
      <PageHeader title={`New ${kind} template`} subtitle="Build from the off-the-shelf bank, custom questions, or AI drafting" />
      <TemplateEditor
        mode="create"
        kind={kind}
        initial={{ name: "", description: "", roleKeys: [], isDefault: false, questions: [] }}
        roleOptions={ROLE_KEYS.map((r) => ({ key: r.key, label: r.label }))}
        bank={bank.map((b) => ({ id: b.id, category: b.category, roleHint: b.roleHint, text: b.text, responseType: b.responseType }))}
      />
    </>
  );
}
