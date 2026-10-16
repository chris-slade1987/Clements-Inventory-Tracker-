import Link from "next/link";
import { Card, PageHeader, EmptyState } from "@/components/ui";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { branchLabel } from "@/lib/management";
import { ptoBalance } from "@/lib/pto";
import { documentsForEmployee, docCategoryLabel } from "@/lib/branch-hub";
import { employeeAssignments } from "@/lib/training";
import { getDocument, HANDBOOK_SLUG, latestAckForUser, latestAckForEmployee } from "@/lib/policy-docs";
import Glyph from "@/components/Glyph";

export const dynamic = "force-dynamic";

function fmtDate(d: Date | null | undefined): string {
  return d ? d.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" }) : "—";
}

// My profile — the employee's own read-only record: identity, PTO balance,
// earned certifications, licenses/documents on file, and their handbook
// acknowledgment. Self-service only (shows the signed-in person's own data).
export default async function MyProfilePage() {
  const user = await requireUser();

  if (!user.employeeId) {
    return (
      <>
        <PageHeader title="My profile" subtitle="Your employee record" />
        <EmptyState
          title="No personnel profile linked"
          hint="This login isn't linked to an employee profile yet. Ask HR to link it so your record, PTO, and certifications appear here."
        />
      </>
    );
  }

  const employeeId = user.employeeId;
  const handbookDoc = await getDocument(HANDBOOK_SLUG);

  const [employee, pto, awards, docs, assignments, ackUser, ackEmp] = await Promise.all([
    prisma.employee.findUnique({
      where: { id: employeeId },
      include: { reportsTo: { select: { name: true, title: true } } },
    }),
    ptoBalance(employeeId),
    prisma.certAward.findMany({
      where: { employeeId },
      orderBy: { awardedAt: "desc" },
      include: { certification: { select: { code: true, name: true } } },
    }),
    documentsForEmployee(employeeId),
    employeeAssignments(employeeId),
    handbookDoc ? latestAckForUser(handbookDoc.id, user.id) : Promise.resolve(null),
    handbookDoc ? latestAckForEmployee(handbookDoc.id, employeeId) : Promise.resolve(null),
  ]);

  if (!employee) {
    return (
      <>
        <PageHeader title="My profile" subtitle="Your employee record" />
        <EmptyState title="Profile not found" hint="Your linked employee profile could not be loaded. Please contact HR." />
      </>
    );
  }

  // Most recent handbook acknowledgment across login- and employee-tied records.
  const ack = [ackUser, ackEmp]
    .filter(Boolean)
    .sort((a, b) => (b!.acknowledgedAt.getTime() - a!.acknowledgedAt.getTime()))[0] ?? null;
  const handbookCurrent = handbookDoc ? ack?.version === handbookDoc.version : false;

  // Onboarding = onboarding-category LMS courses assigned to them.
  const onboarding = assignments.filter((a) => a.course.category === "onboarding");
  const onboardingDone = onboarding.filter((a) => a.status === "completed").length;

  return (
    <>
      <PageHeader title="My profile" subtitle="Your employee record, certifications, and documents" />

      {/* Identity */}
      <Card className="p-5 mb-5">
        <div className="flex items-start gap-4">
          <span className="grid h-14 w-14 shrink-0 place-items-center rounded-2xl bg-brand-50 text-brand-600 text-lg font-light">
            {employee.name.split(" ").map((w) => w[0]).filter(Boolean).slice(0, 2).join("").toUpperCase()}
          </span>
          <div className="min-w-0 flex-1">
            <div className="text-lg font-light text-ink">{employee.name}</div>
            <div className="text-sm text-muted">
              {[employee.title || employee.role, employee.division].filter(Boolean).join(" · ") || "—"}
            </div>
          </div>
        </div>
        <dl className="mt-5 grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-3">
          <Field label="Branch" value={employee.branch ? branchLabel(employee.branch) : "—"} />
          <Field label="Hire date" value={fmtDate(employee.hireDate)} />
          <Field label="Reports to" value={employee.reportsTo?.name ?? "—"} />
          <Field label="Work email" value={employee.email ?? "—"} />
          <Field label="Work phone" value={employee.phone ?? "—"} />
          <Field label="License #" value={employee.licenseNumber ?? "—"} />
        </dl>
      </Card>

      {/* PTO snapshot */}
      <Card className="p-0 overflow-hidden mb-5">
        <Link href="/me/pto" className="flex items-center gap-3 px-4 py-4 hover:bg-black/[0.02]">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-brand-50 text-brand-600"><Glyph name="calendar" className="h-5 w-5" /></span>
          <div className="min-w-0 flex-1">
            <div className="text-sm font-medium text-ink">Paid time off</div>
            <div className="text-xs text-muted">
              {pto.remaining} of {pto.allowance} days remaining
              {pto.used ? ` · ${pto.used} used` : ""}
              {pto.pending ? ` · ${pto.pending} pending review` : ""}
            </div>
          </div>
          <span className="shrink-0 text-xs font-medium text-brand-700">Request time off →</span>
        </Link>
      </Card>

      {/* Certifications earned */}
      <Card className="p-0 overflow-hidden mb-5">
        <div className="px-4 py-3 border-b border-line flex items-center justify-between">
          <div className="text-sm font-medium text-ink">Internal certifications</div>
          <span className="text-[11px] text-muted">{awards.length} earned</span>
        </div>
        {awards.length === 0 ? (
          <p className="px-4 py-6 text-center text-sm text-muted">
            No certifications awarded yet. Completed training in the{" "}
            <Link href="/me/training" className="text-brand-700 hover:underline">Training Center</Link> earns them.
          </p>
        ) : (
          <ul className="divide-y divide-line">
            {awards.map((a) => (
              <li key={a.id} className="flex items-center gap-3 px-4 py-3">
                <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-brand-50 text-brand-600"><Glyph name="award" className="h-4 w-4" /></span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-medium text-ink">{a.certification.name}</span>
                  <span className="block text-xs text-muted">{a.certification.code} · awarded {fmtDate(a.awardedAt)}</span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {/* Documents / licenses on file */}
      <Card className="p-0 overflow-hidden mb-5">
        <div className="px-4 py-3 border-b border-line text-sm font-medium text-ink">Documents &amp; licenses on file</div>
        {docs.length === 0 ? (
          <p className="px-4 py-6 text-center text-sm text-muted">No documents are on file for you. HR keeps licensing and credential records here as they&rsquo;re added.</p>
        ) : (
          <ul className="divide-y divide-line">
            {docs.map((d) => (
              <li key={d.id} className="flex items-center gap-3 px-4 py-3">
                <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-brand-50 text-brand-600"><Glyph name="shield" className="h-4 w-4" /></span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-medium text-ink">{d.title}</span>
                  <span className="block text-xs text-muted">
                    {docCategoryLabel(d.category)}
                    {d.licenseNumber ? ` · #${d.licenseNumber}` : ""}
                    {d.expirationDate ? ` · expires ${fmtDate(d.expirationDate)}` : ""}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {/* Agreements & acknowledgments */}
      <Card className="p-0 overflow-hidden">
        <div className="px-4 py-3 border-b border-line text-sm font-medium text-ink">Agreements &amp; acknowledgments</div>
        <ul className="divide-y divide-line">
          {/* Handbook ack */}
          <li className="flex items-center gap-3 px-4 py-3">
            <span className={`mt-0.5 h-2 w-2 shrink-0 rounded-full ${handbookCurrent ? "bg-emerald-500" : "bg-amber-500"}`} />
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-medium text-ink">Employee Handbook</span>
              <span className="block text-xs text-muted">
                {ack
                  ? handbookCurrent
                    ? `Acknowledged v${ack.version} on ${fmtDate(ack.acknowledgedAt)}`
                    : `A newer version is published — please re-acknowledge (you signed v${ack.version})`
                  : "Not yet acknowledged"}
              </span>
            </span>
            <Link href="/resources/handbook" className="shrink-0 text-xs font-medium text-brand-700 hover:underline">
              {handbookCurrent ? "View →" : "Review & sign →"}
            </Link>
          </li>
          {/* Onboarding */}
          {onboarding.length > 0 ? (
            <li className="flex items-center gap-3 px-4 py-3">
              <span className={`mt-0.5 h-2 w-2 shrink-0 rounded-full ${onboardingDone === onboarding.length ? "bg-emerald-500" : "bg-amber-500"}`} />
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-medium text-ink">Onboarding</span>
                <span className="block text-xs text-muted">{onboardingDone} of {onboarding.length} onboarding items complete</span>
              </span>
              <Link href="/me/training" className="shrink-0 text-xs font-medium text-brand-700 hover:underline">Open →</Link>
            </li>
          ) : null}
          {/* Employment agreement — no portal data source yet; state it plainly. */}
          <li className="flex items-center gap-3 px-4 py-3">
            <span className="mt-0.5 h-2 w-2 shrink-0 rounded-full bg-slate-300" />
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-medium text-ink">Signed employment agreement</span>
              <span className="block text-xs text-muted">Not yet stored in the portal. Contact HR for a copy of your agreement.</span>
            </span>
            <Link href="/me/hr" className="shrink-0 text-xs font-medium text-brand-700 hover:underline">Ask HR →</Link>
          </li>
        </ul>
      </Card>
    </>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-[11px] uppercase tracking-wider text-muted">{label}</dt>
      <dd className="mt-0.5 text-sm text-ink break-words">{value}</dd>
    </div>
  );
}
