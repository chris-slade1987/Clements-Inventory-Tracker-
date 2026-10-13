import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Card, PageHeader, EmptyState } from "@/components/ui";
import { requireUser, isBoardObserver, homePath } from "@/lib/auth";
import { getCertificationByCode, canViewCertifications } from "@/lib/certifications";

export const dynamic = "force-dynamic";

const STATUS: Record<string, { label: string; chip: string }> = {
  exists: { label: "Exists", chip: "bg-emerald-100 text-emerald-800" },
  partial: { label: "Partial", chip: "bg-amber-100 text-amber-800" },
  none: { label: "None", chip: "bg-slate-100 text-slate-700" },
};

const PATHWAY_VIA: Record<string, string> = {
  fixed: "required",
  "all-service-certs": "via all service certs",
  "all-certs": "via all certifications",
  sls: "via SLS",
  csr: "via CSR",
};

export default async function CertDetailPage({ params }: { params: Promise<{ code: string }> }) {
  const user = await requireUser();
  if (!canViewCertifications(user)) {
    redirect(isBoardObserver(user) ? "/management/board" : homePath(user));
  }

  const { code } = await params;
  const cert = await getCertificationByCode(code);
  if (!cert) notFound();

  const sc = cert.statusCounts;

  return (
    <>
      <div className="mb-2">
        <Link href="/management/certifications" className="text-xs font-medium text-brand-700 hover:underline">
          ← Certifications
        </Link>
      </div>

      <PageHeader
        title={cert.name}
        subtitle={cert.audience}
        actions={
          <span className="rounded-md bg-brand-50 px-2 py-1 text-sm font-semibold text-brand-700">{cert.code}</span>
        }
      />

      <div className="mb-3 flex flex-wrap gap-2">
        {cert.isServiceCert ? <span className="rounded-full bg-sky-100 px-2 py-0.5 text-[11px] font-medium text-sky-800">Service certification</span> : null}
        {cert.requiresAllServiceCerts ? <span className="rounded-full bg-violet-100 px-2 py-0.5 text-[11px] font-medium text-violet-800">Requires all service certs</span> : null}
        {cert.status !== "active" ? <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-700">{cert.status}</span> : null}
      </div>

      {/* Requirements summary */}
      <Card className="mb-5 p-4">
        <div className="text-sm text-ink">
          <span className="font-medium">Written:</span> {cert.modules.length} module{cert.modules.length === 1 ? "" : "s"}
          {" · "}
          <span className="font-medium">Field:</span> {cert.fieldHoursNote ?? "TBD"}
          {" · "}
          <span className="font-medium">Pass:</span> {cert.passScore != null ? `${cert.passScore}%` : "TBD"}
          {" · "}
          <span className="font-medium">Sign-off:</span> {cert.signOffRoles ?? "TBD"}
        </div>
        {cert.externalRequirement ? (
          <div className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-[13px] text-amber-900">
            <span className="font-medium">External requirement:</span> {cert.externalRequirement}
          </div>
        ) : null}
      </Card>

      {/* Prerequisites */}
      <Card className="mb-5 p-4">
        <div className="text-sm font-semibold text-ink">Prerequisites</div>
        {cert.prerequisites.length === 0 && !cert.requiresAllServiceCerts ? (
          <div className="mt-2 text-sm text-muted">None.</div>
        ) : (
          <div className="mt-2 space-y-2">
            {cert.prerequisites.length > 0 ? (
              <ul className="space-y-1.5">
                {cert.prerequisites.map((p) => (
                  <li key={p.code}>
                    <Link href={`/management/certifications/${p.code}`} className="inline-flex items-center gap-2 hover:underline">
                      <span className="rounded-md bg-brand-50 px-1.5 py-0.5 text-[11px] font-semibold text-brand-700">{p.code}</span>
                      <span className="text-sm text-ink">{p.name}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            ) : null}
            {cert.requiresAllServiceCerts ? (
              <div className="text-sm text-ink">Plus all service certifications.</div>
            ) : null}
          </div>
        )}
      </Card>

      {/* Modules */}
      <Card className="mb-5 p-0 overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 border-b border-line">
          <div className="text-sm font-semibold text-ink">Modules</div>
          {sc.total > 0 ? (
            <div className="text-[11px] text-muted">
              <span className="font-medium text-emerald-700 tabular-nums">{sc.exists}</span> exist ·{" "}
              <span className="font-medium text-amber-700 tabular-nums">{sc.partial}</span> partial ·{" "}
              <span className="font-medium text-slate-600 tabular-nums">{sc.none}</span> none
            </div>
          ) : null}
        </div>
        {cert.modules.length === 0 ? (
          <div className="p-4">
            <EmptyState title="No modules defined yet" hint="This certification's module content has not been outlined." />
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-[11px] text-muted border-b border-line">
                  <th className="px-4 py-2 font-medium text-center">#</th>
                  <th className="px-3 py-2 font-medium">Code</th>
                  <th className="px-3 py-2 font-medium">Name</th>
                  <th className="px-3 py-2 font-medium text-center">Content</th>
                  <th className="px-3 py-2 font-medium">Source note</th>
                </tr>
              </thead>
              <tbody>
                {cert.modules.map((m) => {
                  const s = STATUS[m.contentStatus] ?? STATUS.none;
                  return (
                    <tr key={m.code} className="border-b border-line last:border-0">
                      <td className="px-4 py-2.5 text-center tabular-nums text-muted">{m.order}</td>
                      <td className="px-3 py-2.5 font-medium text-ink whitespace-nowrap">{m.code}</td>
                      <td className="px-3 py-2.5 text-ink">{m.name}</td>
                      <td className="px-3 py-2.5 text-center">
                        <span className={`inline-block rounded-full px-2 py-0.5 text-[10px] font-medium ${s.chip}`}>{s.label}</span>
                      </td>
                      <td className="px-3 py-2.5 text-muted">{m.sourceNote ?? "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* Required by */}
      <Card className="p-4">
        <div className="text-sm font-semibold text-ink">Required by</div>
        {cert.requiredByCerts.length === 0 && cert.requiredByPathways.length === 0 ? (
          <div className="mt-2 text-sm text-muted">No other certification or pathway requires this one.</div>
        ) : (
          <div className="mt-3 grid gap-4 sm:grid-cols-2">
            <div>
              <div className="text-[11px] font-semibold uppercase tracking-wide text-muted">Certifications</div>
              {cert.requiredByCerts.length === 0 ? (
                <div className="mt-1.5 text-sm text-muted">None.</div>
              ) : (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {cert.requiredByCerts.map((c) => (
                    <Link key={c.code} href={`/management/certifications/${c.code}`} className="rounded-md bg-brand-50 px-1.5 py-0.5 text-[11px] font-semibold text-brand-700 hover:bg-brand-100" title={c.name}>
                      {c.code}
                    </Link>
                  ))}
                </div>
              )}
            </div>
            <div>
              <div className="text-[11px] font-semibold uppercase tracking-wide text-muted">Pathways</div>
              {cert.requiredByPathways.length === 0 ? (
                <div className="mt-1.5 text-sm text-muted">None.</div>
              ) : (
                <ul className="mt-2 space-y-1">
                  {cert.requiredByPathways.map((p) => (
                    <li key={p.key} className="text-sm text-ink">
                      {p.label}
                      <span className="ml-1 text-[11px] text-muted">({PATHWAY_VIA[p.via]})</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        )}
        <div className="mt-3 border-t border-line pt-3">
          <Link href="/management/certifications/pathways" className="text-xs font-medium text-brand-700 hover:underline">
            View all pathways →
          </Link>
        </div>
      </Card>
    </>
  );
}
