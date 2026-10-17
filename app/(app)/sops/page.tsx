import Link from "next/link";
import { Card, PageHeader, EmptyState } from "@/components/ui";
import { requireUser, scopedBranch, branchLocked } from "@/lib/auth";
import { BRANCHES, branchLabel } from "@/lib/management";
import { listSopTemplates, openAssignments, recentSopCompletions } from "@/lib/sop";

export const dynamic = "force-dynamic";

const DATE = (d: Date) => d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });

export default async function SopsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const user = await requireUser();
  const sp = await searchParams;
  const requested = BRANCHES.find((b) => b.key === sp.branch)?.key ?? null;
  const branch = scopedBranch(user, requested) ?? (branchLocked(user) ? null : BRANCHES[0].key);
  const locked = branchLocked(user);

  if (!branch) {
    return (
      <>
        <PageHeader title="Standard Operating Procedures" subtitle="Run a procedure step by step, then sign off" />
        <EmptyState title="No branch to show" hint="Your account isn't tied to a branch." />
      </>
    );
  }

  const now = new Date();
  const [assignments, templates, recent] = await Promise.all([
    openAssignments(branch, now),
    listSopTemplates(),
    recentSopCompletions(branch, 10),
  ]);

  const adhoc = templates.filter((t) => t.dueRule === "adhoc");

  return (
    <>
      <PageHeader
        title="Standard Operating Procedures"
        subtitle={`${branchLabel(branch)} · guided, signed run-throughs of the Clements Way`}
      />

      {locked ? null : (
        <div className="mb-4 flex flex-wrap gap-1 rounded-xl bg-black/20 p-1 w-fit">
          {BRANCHES.map((b) => (
            <Link
              key={b.key}
              href={`/sops?branch=${b.key}`}
              className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${branch === b.key ? "bg-emerald-grad text-white shadow" : "text-muted hover:text-ink"}`}
            >
              {b.label}
            </Link>
          ))}
        </div>
      )}

      {/* Due now — assigned SOPs awaiting a run */}
      <section className="mb-6">
        <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-muted">Due now</h2>
        {assignments.length === 0 ? (
          <EmptyState title="Nothing assigned right now" hint="Assigned SOPs for this branch show up here. You can also start any SOP on demand below." />
        ) : (
          <div className="grid gap-3 md:grid-cols-2">
            {assignments.map((a) => (
              <Card key={a.id} className={`p-0 overflow-hidden ${a.overdue ? "ring-1 ring-red-200" : "ring-1 ring-amber-200"}`}>
                <div className="px-5 py-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="text-lg font-medium text-ink">{a.title || a.templateTitle}</div>
                      {a.category ? <div className="text-xs text-muted mt-0.5">{a.category}</div> : null}
                    </div>
                    <span className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-medium ${a.overdue ? "bg-red-100 text-red-700" : "bg-amber-100 text-amber-700"}`}>
                      {a.overdue ? "Overdue" : a.dueDate ? `Due ${DATE(a.dueDate)}` : "Due"}
                    </span>
                  </div>
                  {a.note ? <p className="mt-2 text-sm text-muted">{a.note}</p> : null}
                  {a.assignedByName ? <p className="mt-1 text-xs text-muted">Assigned by {a.assignedByName}</p> : null}
                  <Link
                    href={`/sops/${a.templateId}?assignment=${a.id}&branch=${branch}`}
                    className="mt-3 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-emerald-grad px-4 py-2.5 text-sm font-medium text-white shadow-sm shadow-brand-600/30 hover:brightness-[0.97]"
                  >
                    Start SOP
                  </Link>
                </div>
              </Card>
            ))}
          </div>
        )}
      </section>

      {/* Run on demand — every active ad-hoc SOP */}
      <section className="mb-6">
        <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-muted">Run an SOP</h2>
        {adhoc.length === 0 ? (
          <EmptyState title="No SOPs published yet" hint="Published SOPs appear here for the branch to run any time." />
        ) : (
          <div className="grid gap-3 md:grid-cols-2">
            {adhoc.map((t) => (
              <Card key={t.id} className="p-0 overflow-hidden">
                <div className="px-5 py-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="text-lg font-medium text-ink">{t.title}</div>
                      <div className="text-xs text-muted mt-0.5">
                        {t.category ? `${t.category} · ` : ""}v{t.version} · {t.steps.length} steps
                      </div>
                    </div>
                  </div>
                  {t.intro ? <p className="mt-2 text-sm text-muted">{t.intro}</p> : null}
                  <Link
                    href={`/sops/${t.id}?branch=${branch}`}
                    className="mt-3 inline-flex w-full items-center justify-center gap-2 rounded-xl border border-[#cfe0d6] bg-white px-4 py-2.5 text-sm font-medium text-[#0e1b15] hover:bg-[#eef5f0]"
                  >
                    Run now
                  </Link>
                </div>
              </Card>
            ))}
          </div>
        )}
      </section>

      {/* Recently completed */}
      {recent.length > 0 ? (
        <section>
          <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-muted">Recently completed</h2>
          <Card className="p-0 overflow-hidden">
            <ul className="divide-y divide-line">
              {recent.map((c) => (
                <li key={c.id} className="flex items-center justify-between gap-3 px-5 py-3">
                  <div className="min-w-0">
                    <div className="text-sm font-medium text-ink truncate">{c.templateTitle}</div>
                    <div className="text-xs text-muted">v{c.templateVersion} · signed by {c.signedName}</div>
                  </div>
                  <div className="shrink-0 text-xs text-muted">{DATE(c.createdAt)}</div>
                </li>
              ))}
            </ul>
          </Card>
        </section>
      ) : null}
    </>
  );
}
