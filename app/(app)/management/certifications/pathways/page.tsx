import Link from "next/link";
import { redirect } from "next/navigation";
import { Card, PageHeader } from "@/components/ui";
import { requireUser, isBoardObserver, homePath } from "@/lib/auth";
import { listPrograms, listModules, canViewCertifications } from "@/lib/certifications";

export const dynamic = "force-dynamic";
export const metadata = { title: "Programs & Modules — CanopyOS" };

export default async function ProgramsModulesPage() {
  const user = await requireUser();
  if (!canViewCertifications(user)) {
    redirect(isBoardObserver(user) ? "/management/board" : homePath(user));
  }
  const [programs, modules] = await Promise.all([listPrograms(), listModules()]);

  return (
    <>
      <PageHeader
        title="Programs & Modules"
        subtitle="Programs say why training is assigned; modules are the locked, ordered packages of courses April assigns."
        actions={
          <Link
            href="/management/certifications"
            className="inline-flex items-center justify-center gap-2 rounded-xl border border-[#cfe0d6] bg-white px-4 py-2.5 text-sm font-medium text-[#0e1b15] hover:bg-[#eef5f0] transition-colors"
          >
            Certifications
          </Link>
        }
      />

      <h2 className="mb-2 text-sm font-semibold text-ink">Programs</h2>
      <div className="mb-6 space-y-3">
        {programs.map((p) => (
          <Card key={p.code} className="p-4">
            <div className="flex items-start justify-between gap-2">
              <span className="inline-flex items-center gap-2">
                <span className="rounded-md bg-brand-50 px-1.5 py-0.5 text-[11px] font-semibold text-brand-700">{p.code}</span>
                <span className="font-medium text-ink">{p.name}</span>
              </span>
            </div>
            {p.whenToAssign ? <div className="mt-1 text-xs text-muted">{p.whenToAssign}</div> : null}
            <div className="mt-2 flex flex-wrap gap-1 text-[11px]">
              {p.modules.map((m) => (
                <span key={m.code} className="rounded bg-black/[0.05] px-1.5 py-0.5 font-medium text-ink">
                  {m.step ? `${m.step}. ` : ""}
                  {m.code}
                </span>
              ))}
            </div>
          </Card>
        ))}
      </div>

      <h2 className="mb-2 text-sm font-semibold text-ink">Modules</h2>
      <Card className="p-0 overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-[11px] text-muted border-b border-line">
              <th className="px-4 py-2.5 font-medium">Module</th>
              <th className="px-3 py-2.5 font-medium">Earns</th>
              <th className="px-3 py-2.5 font-medium text-center">Courses</th>
              <th className="px-3 py-2.5 font-medium text-center">v</th>
            </tr>
          </thead>
          <tbody>
            {modules.map((m) => (
              <tr key={m.code} className="border-b border-line last:border-0">
                <td className="px-4 py-3 align-top">
                  <span className="inline-flex items-center gap-2">
                    <span className="rounded-md bg-brand-50 px-1.5 py-0.5 text-[11px] font-semibold text-brand-700">{m.code}</span>
                    <span className="font-medium text-ink">{m.name}</span>
                  </span>
                  {m.audience ? <div className="mt-0.5 text-[11px] text-muted">{m.audience}</div> : null}
                </td>
                <td className="px-3 py-3 align-top text-muted">{m.certificationsEarned ?? "—"}</td>
                <td className="px-3 py-3 align-top text-center tabular-nums text-ink">{m.courseCount}</td>
                <td className="px-3 py-3 align-top text-center tabular-nums text-muted">{m.version}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </>
  );
}
