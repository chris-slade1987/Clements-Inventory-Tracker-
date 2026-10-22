import Link from "next/link";
import { Card, PageHeader, EmptyState } from "@/components/ui";
import { requireUser } from "@/lib/auth";
import { employeeAssignments, STATUS_LABEL } from "@/lib/training";
import { getEmployeeRecord, COURSE_STATUS_LABEL } from "@/lib/training-center";
import { ensureSelfEmployeeLink } from "@/lib/self-link";
import { AchievementBar, MilestoneStepper, type Step } from "@/components/motivation";
import { Buzz } from "@/components/Buzz";

// A certification course counts as "done" once complete or credited.
function courseStep(status: string): Step["state"] {
  return status === "complete" || status === "credited" ? "done" : "todo";
}
// Build the module's course sequence as stepper nodes, marking the first
// unfinished course as the current one.
function moduleSteps(courses: { code: string; status: string }[]): Step[] {
  const firstTodo = courses.findIndex((c) => courseStep(c.status) !== "done");
  return courses.map((c, i) => ({
    label: c.code,
    state: courseStep(c.status) === "done" ? "done" : i === firstTodo ? "current" : "todo",
  }));
}

export const dynamic = "force-dynamic";
export const metadata = { title: "My Training — CanopyOS" };

const STATUS_CHIP: Record<string, string> = {
  assigned: "bg-slate-100 text-slate-700",
  in_progress: "bg-amber-100 text-amber-800",
  complete: "bg-emerald-100 text-emerald-800",
  credited: "bg-emerald-50 text-emerald-700",
  not_started: "bg-slate-100 text-slate-500",
};

export default async function MyTrainingPage() {
  const user = await requireUser();
  const employeeId = user.employeeId ?? (await ensureSelfEmployeeLink(user));
  if (!employeeId) {
    return (
      <>
        <PageHeader title="My Training" subtitle="Your training courses & certifications" />
        <EmptyState title="No personnel profile linked" hint="This login isn't linked to an employee profile, so there's no training to show. Ask HR to link your profile." />
      </>
    );
  }

  const [record, ceu] = await Promise.all([
    getEmployeeRecord(employeeId),
    employeeAssignments(employeeId),
  ]);
  const ceuOpen = ceu.filter((a) => a.status !== "completed");
  const activeMods = record?.activeAssignments ?? [];
  const certDone = activeMods.reduce((s, a) => s + a.completeCount, 0);
  const certTotal = activeMods.reduce((s, a) => s + a.totalCount, 0);
  const anyModuleComplete = activeMods.some((a) => a.totalCount > 0 && a.completeCount >= a.totalCount);

  return (
    <>
      <PageHeader title="My Training" subtitle="Your certification program, course progress, and CEU courses." />

      {/* Certifications held */}
      {record && record.awards.length > 0 ? (
        <Card className="mb-5 p-4">
          <div className="mb-2 text-sm font-semibold text-ink">My certifications</div>
          <div className="flex flex-wrap gap-2">
            {record.awards.map((a) => (
              <span key={a.code} className="inline-flex items-center gap-1.5 rounded-full bg-emerald-100 px-2.5 py-1 text-xs font-medium text-emerald-800">
                <span className="font-semibold">{a.code}</span>
                {a.name}
                <span className="text-emerald-600">· {a.awardedAt}</span>
              </span>
            ))}
          </div>
        </Card>
      ) : null}

      {/* Training Center module progress */}
      <h2 className="mb-2 text-sm font-semibold text-ink">Certification courses</h2>
      {!record || record.activeAssignments.length === 0 ? (
        <EmptyState title="No active certification modules" hint="When HR assigns you a module, your course list and progress will show here." />
      ) : (
        <div className="mb-6 space-y-3">
          {/* Overall certification progress across active modules + a Buzz welcome
              when a module is fully done (celebration mascot marks arrival only). */}
          <Card className="p-4">
            <div className="flex items-center gap-4">
              {anyModuleComplete ? <Buzz size={56} className="shrink-0" title="A module complete — nice work!" /> : null}
              <div className="flex-1">
                <AchievementBar
                  label="Certification progress"
                  value={certDone}
                  target={certTotal}
                  caption={`${certDone} of ${certTotal} courses complete across your active modules`}
                  size="lg"
                />
              </div>
            </div>
          </Card>
          {record.activeAssignments.map((a) => (
            <Card key={a.id} className="p-4">
              <div className="mb-3 flex items-center justify-between gap-2">
                <div className="inline-flex items-center gap-2">
                  {a.moduleCode ? (
                    <span className="rounded-md bg-brand-50 px-1.5 py-0.5 text-[11px] font-semibold text-brand-700">{a.moduleCode}</span>
                  ) : a.standaloneCourseCode ? (
                    <span className="rounded-md bg-brand-50 px-1.5 py-0.5 text-[11px] font-semibold text-brand-700">{a.standaloneCourseCode}</span>
                  ) : null}
                  <span className="font-medium text-ink">{a.moduleName ?? "Single course"}</span>
                </div>
                <span className="shrink-0 text-xs text-muted tabular-nums">{a.completeCount}/{a.totalCount} done</span>
              </div>
              <AchievementBar className="mb-3" value={a.completeCount} target={a.totalCount} showPercent={false} size="sm" />
              {a.courses.length > 1 ? <MilestoneStepper className="mb-3 px-1" steps={moduleSteps(a.courses)} /> : null}
              {a.prereqNote ? (
                <div className="mb-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">{a.prereqNote}</div>
              ) : null}
              <ol className="space-y-1.5">
                {a.courses.map((c) => {
                  const done = c.status === "complete" || c.status === "credited";
                  const openable = !!c.contentUrl && c.courseType !== "field_signoff";
                  return (
                    <li key={c.code} className="flex flex-wrap items-center gap-2 text-sm">
                      <span className="rounded-md bg-slate-50 px-1.5 py-0.5 text-[11px] font-semibold text-slate-700">{c.code}</span>
                      {openable ? (
                        <a href={c.contentUrl!} target="_blank" rel="noreferrer" className="font-medium text-brand-700 hover:underline">{c.name}</a>
                      ) : (
                        <span className="text-ink">{c.name}</span>
                      )}
                      {c.courseType === "field_signoff" ? (
                        <span className="rounded-full bg-sky-100 px-2 py-0.5 text-[10px] font-medium text-sky-800">field sign-off</span>
                      ) : null}
                      <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${STATUS_CHIP[c.status] ?? "bg-slate-100 text-slate-700"}`}>
                        {COURSE_STATUS_LABEL[c.status] ?? c.status}
                      </span>
                      {c.completedDate ? <span className="text-xs text-muted">{c.completedDate}</span> : null}
                      {openable ? (
                        <a href={c.contentUrl!} target="_blank" rel="noreferrer" className="ml-auto shrink-0 inline-flex items-center gap-1 rounded-lg bg-emerald-grad px-2.5 py-1 text-[11px] font-semibold text-white hover:brightness-95">
                          {done ? "Review" : "Open"}
                          <svg viewBox="0 0 24 24" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><path d="M14 3h7v7M21 3l-9 9M5 5h6M5 5v14h14v-6" /></svg>
                        </a>
                      ) : null}
                    </li>
                  );
                })}
              </ol>
              {a.courses.some((c) => c.courseType === "field_signoff") ? (
                <p className="mt-3 rounded-lg border border-sky-200 bg-sky-50 px-3 py-2 text-xs text-sky-800">
                  <span className="font-medium">Field sign-off</span> courses aren&rsquo;t a quiz — you complete the task in the field with a trainer, who records and approves the sign-off. It moves to complete once your supervisor approves it; nothing for you to submit here.
                </p>
              ) : null}
            </Card>
          ))}
        </div>
      )}

      {/* CEU / onboarding quiz courses (existing training system) */}
      <h2 className="mb-2 text-sm font-semibold text-ink">CEU &amp; onboarding courses</h2>
      {ceu.length === 0 ? (
        <EmptyState title="No CEU courses assigned" />
      ) : (
        <Card className="p-0 overflow-hidden">
          <div className="px-4 py-3 border-b border-line flex items-center justify-between">
            <div className="text-sm font-medium text-ink">Assigned courses{ceuOpen.length ? ` · ${ceuOpen.length} open` : ""}</div>
            <Link href="/me/library" className="text-xs font-medium text-brand-700 hover:underline">Lesson library →</Link>
          </div>
          <ul className="divide-y divide-line">
            {ceu.map((a) => (
              <li key={a.id}>
                <Link href={`/me/training/${a.id}`} className="flex items-center gap-3 px-4 py-3 hover:bg-black/[0.02]">
                  <span className="flex-1">
                    <span className="block text-sm font-medium text-ink">{a.course.title}</span>
                    <span className="block text-xs text-muted">
                      {STATUS_LABEL[a.status] ?? a.status}
                      {a.course.category === "onboarding" ? " · onboarding" : " · CEU"}
                      {a.status === "completed" && a.score != null ? ` · ${a.score}%` : ""}
                    </span>
                  </span>
                  <span className="text-xs font-medium text-brand-700">{a.status === "completed" ? "Review" : "Open →"}</span>
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </>
  );
}
