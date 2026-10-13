import Link from "next/link";
import { redirect } from "next/navigation";
import { Card, PageHeader } from "@/components/ui";
import { requireUser, isBoardObserver, homePath } from "@/lib/auth";
import {
  listCertifications,
  programSummary,
  canViewCertifications,
} from "@/lib/certifications";

export const dynamic = "force-dynamic";
export const metadata = { title: "Certifications — CanopyOS" };

const STATUS_CHIP: Record<string, string> = {
  exists: "bg-emerald-100 text-emerald-800",
  partial: "bg-amber-100 text-amber-800",
  none: "bg-slate-100 text-slate-700",
};

export default async function CertificationsIndexPage() {
  const user = await requireUser();
  if (!canViewCertifications(user)) {
    redirect(isBoardObserver(user) ? "/management/board" : homePath(user));
  }

  const [certs, summary] = await Promise.all([listCertifications(), programSummary()]);

  return (
    <>
      <PageHeader
        title="Certifications"
        subtitle="The internal certification program structure — certifications, modules, prerequisites, and career pathways. Read-only overview; training content is coming."
        actions={
          <Link
            href="/management/certifications/pathways"
            className="inline-flex items-center justify-center gap-2 rounded-xl border border-[#cfe0d6] bg-white px-4 py-2.5 text-sm font-medium text-[#0e1b15] hover:bg-[#eef5f0] transition-colors"
          >
            Pathways
          </Link>
        }
      />

      {/* Program summary */}
      <Card className="mb-5 p-4">
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
          <div>
            <span className="text-lg font-semibold text-ink tabular-nums">{summary.certifications}</span>
            <span className="ml-1.5 text-muted">certifications</span>
          </div>
          <div>
            <span className="text-lg font-semibold text-ink tabular-nums">{summary.modules}</span>
            <span className="ml-1.5 text-muted">modules</span>
          </div>
          <div className="text-muted">
            <span className="font-medium text-emerald-700 tabular-nums">{summary.exists}</span> exist ·{" "}
            <span className="font-medium text-amber-700 tabular-nums">{summary.partial}</span> partial ·{" "}
            <span className="font-medium text-slate-600 tabular-nums">{summary.none}</span> none
          </div>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2 text-[11px] text-muted">
          <span className="font-medium text-ink">Content status:</span>
          <span className={`rounded-full px-2 py-0.5 font-medium ${STATUS_CHIP.exists}`}>Exists</span>
          <span className={`rounded-full px-2 py-0.5 font-medium ${STATUS_CHIP.partial}`}>Partial</span>
          <span className={`rounded-full px-2 py-0.5 font-medium ${STATUS_CHIP.none}`}>None</span>
        </div>
      </Card>

      {/* Desktop / wide: table */}
      <Card className="hidden md:block p-0 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-[11px] text-muted border-b border-line">
                <th className="px-4 py-2.5 font-medium">Cert</th>
                <th className="px-3 py-2.5 font-medium">Audience</th>
                <th className="px-3 py-2.5 font-medium text-center">Modules</th>
                <th className="px-3 py-2.5 font-medium">Prerequisites</th>
                <th className="px-3 py-2.5 font-medium">Field hours</th>
                <th className="px-3 py-2.5 font-medium text-center">Pass</th>
              </tr>
            </thead>
            <tbody>
              {certs.map((c) => (
                <tr key={c.code} className="border-b border-line last:border-0 hover:bg-black/[0.02]">
                  <td className="px-4 py-3 align-top">
                    <Link href={`/management/certifications/${c.code}`} className="group block">
                      <span className="inline-flex items-center gap-2">
                        <span className="rounded-md bg-brand-50 px-1.5 py-0.5 text-[11px] font-semibold text-brand-700">{c.code}</span>
                        <span className="font-medium text-ink group-hover:underline">{c.name}</span>
                      </span>
                      {c.isServiceCert ? (
                        <span className="ml-1 mt-1 inline-block rounded-full bg-sky-100 px-2 py-0.5 text-[10px] font-medium text-sky-800">service cert</span>
                      ) : null}
                      {c.requiresAllServiceCerts ? (
                        <span className="ml-1 mt-1 inline-block rounded-full bg-violet-100 px-2 py-0.5 text-[10px] font-medium text-violet-800">all-service</span>
                      ) : null}
                    </Link>
                  </td>
                  <td className="px-3 py-3 align-top text-muted">{c.audience}</td>
                  <td className="px-3 py-3 align-top text-center tabular-nums text-ink">{c.moduleCount}</td>
                  <td className="px-3 py-3 align-top">
                    <div className="flex flex-wrap gap-1">
                      {c.prereqCodes.length === 0 && !c.requiresAllServiceCerts ? (
                        <span className="text-muted">None</span>
                      ) : (
                        <>
                          {c.prereqCodes.map((p) => (
                            <span key={p} className="rounded bg-black/[0.05] px-1.5 py-0.5 text-[11px] font-medium text-ink">{p}</span>
                          ))}
                          {c.requiresAllServiceCerts ? (
                            <span className="rounded bg-violet-100 px-1.5 py-0.5 text-[11px] font-medium text-violet-800">+ all service certs</span>
                          ) : null}
                        </>
                      )}
                    </div>
                  </td>
                  <td className="px-3 py-3 align-top text-muted">{c.fieldHoursNote ?? "TBD"}</td>
                  <td className="px-3 py-3 align-top text-center tabular-nums text-ink">{c.passScore != null ? `${c.passScore}%` : "TBD"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      {/* Mobile: stacked cards */}
      <div className="md:hidden space-y-3">
        {certs.map((c) => (
          <Link key={c.code} href={`/management/certifications/${c.code}`} className="block">
            <Card className="p-4">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <span className="inline-flex items-center gap-2">
                    <span className="rounded-md bg-brand-50 px-1.5 py-0.5 text-[11px] font-semibold text-brand-700">{c.code}</span>
                    <span className="font-medium text-ink">{c.name}</span>
                  </span>
                  <div className="mt-1 text-xs text-muted">{c.audience}</div>
                </div>
                <span className="shrink-0 text-right text-xs text-muted tabular-nums">{c.moduleCount} mod</span>
              </div>
              <div className="mt-2 flex flex-wrap gap-1">
                {c.isServiceCert ? <span className="rounded-full bg-sky-100 px-2 py-0.5 text-[10px] font-medium text-sky-800">service cert</span> : null}
                {c.requiresAllServiceCerts ? <span className="rounded-full bg-violet-100 px-2 py-0.5 text-[10px] font-medium text-violet-800">all-service</span> : null}
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-1 text-[11px] text-muted">
                <span className="font-medium text-ink">Prereqs:</span>
                {c.prereqCodes.length === 0 && !c.requiresAllServiceCerts ? (
                  <span>None</span>
                ) : (
                  <>
                    {c.prereqCodes.map((p) => (
                      <span key={p} className="rounded bg-black/[0.05] px-1.5 py-0.5 font-medium text-ink">{p}</span>
                    ))}
                    {c.requiresAllServiceCerts ? <span className="rounded bg-violet-100 px-1.5 py-0.5 font-medium text-violet-800">+ all service certs</span> : null}
                  </>
                )}
              </div>
              <div className="mt-2 text-[11px] text-muted">
                Field: {c.fieldHoursNote ?? "TBD"} · Pass: {c.passScore != null ? `${c.passScore}%` : "TBD"}
              </div>
            </Card>
          </Link>
        ))}
      </div>
    </>
  );
}
