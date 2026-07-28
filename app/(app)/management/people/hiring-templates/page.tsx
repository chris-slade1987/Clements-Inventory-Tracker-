import Link from "next/link";
import { redirect } from "next/navigation";
import { Card, PageHeader, EmptyState, btn } from "@/components/ui";
import { requireUser, homePath } from "@/lib/auth";
import { canManageAts } from "@/lib/ats";
import { listTemplates, parseRoleKeys, ROLE_LABELS } from "@/lib/hiring-templates";
import TemplateListActions from "./TemplateListActions";

export const dynamic = "force-dynamic";

export default async function HiringTemplatesPage() {
  const user = await requireUser();
  if (!canManageAts(user)) redirect(homePath(user));

  const templates = await listTemplates();
  const interview = templates.filter((t) => t.kind === "interview");
  const screening = templates.filter((t) => t.kind === "screening");

  return (
    <>
      <div className="mb-2">
        <Link href="/management/people/jobs" className="text-xs font-medium text-brand-300 hover:underline">← Hiring / Jobs</Link>
      </div>
      <PageHeader
        title="Hiring Template Library"
        subtitle="Editable interview + HR screening-call templates — off-the-shelf, custom, and AI-assisted"
        actions={
          <div className="flex gap-2">
            <Link href="/management/people/hiring-templates/new?kind=interview" className={btn.secondary}>New interview</Link>
            <Link href="/management/people/hiring-templates/new?kind=screening" className={btn.primary}>New screening</Link>
          </div>
        }
      />

      <Card className="p-4 mb-5 flex items-start gap-3 bg-brand-50 border-brand-100">
        <svg viewBox="0 0 24 24" className="h-5 w-5 shrink-0 text-brand-600 mt-0.5" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round"><path d="M9.5 3h5l1 3.5 3-1 2.5 4.5-2.5 2 2.5 2-2.5 4.5-3-1-1 3.5h-5l-1-3.5-3 1L2 16.5l2.5-2L2 12.5 4.5 8l3 1z" /></svg>
        <div>
          <div className="text-sm font-medium text-brand-800">Build a template three ways</div>
          <p className="text-xs text-brand-700">Insert questions from the off-the-shelf bank, type your own custom questions, or let the AI assistant draft/refine them. Assign a template to a job on the job page — the supervisor interview form and the HR screening call then render the assigned template.</p>
        </div>
      </Card>

      <TemplateSection title="Interview templates" kind="interview" templates={interview} />
      <div className="h-6" />
      <TemplateSection title="Screening-call templates" kind="screening" templates={screening} />
    </>
  );
}

type Row = Awaited<ReturnType<typeof listTemplates>>[number];

function TemplateSection({ title, kind, templates }: { title: string; kind: "interview" | "screening"; templates: Row[] }) {
  return (
    <section>
      <h2 className="text-sm font-semibold text-ink mb-2">{title}</h2>
      {templates.length === 0 ? (
        <EmptyState title={`No ${kind} templates`} hint={`Create a ${kind} template to get started.`} />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {templates.map((t) => {
            const roles = parseRoleKeys(t.roleKeys);
            return (
              <Card key={t.id} className={`p-4 ${t.active ? "" : "opacity-60"}`}>
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <Link href={`/management/people/hiring-templates/${t.id}`} className="text-sm font-semibold text-brand-700 hover:underline">{t.name}</Link>
                      {t.isDefault ? <span className="rounded-full bg-brand-100 px-2 py-0.5 text-[10px] font-medium text-brand-700">Default</span> : null}
                      {!t.active ? <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-medium text-slate-600">Inactive</span> : null}
                    </div>
                    {t.description ? <p className="mt-1 text-xs text-muted line-clamp-2">{t.description}</p> : null}
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {roles.length ? roles.map((r) => (
                        <span key={r} className="rounded-full bg-black/[0.04] px-2 py-0.5 text-[10px] text-muted">{ROLE_LABELS[r] ?? r}</span>
                      )) : <span className="text-[10px] text-muted">No roles assigned</span>}
                    </div>
                  </div>
                  <span className="shrink-0 rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-600">{t._count.questions} Q</span>
                </div>
                <div className="mt-3 flex items-center gap-3 border-t border-line pt-3">
                  <Link href={`/management/people/hiring-templates/${t.id}`} className="text-xs font-medium text-brand-700 hover:underline">Edit →</Link>
                  <TemplateListActions id={t.id} active={t.active} />
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </section>
  );
}
