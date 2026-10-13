import Link from "next/link";
import { redirect } from "next/navigation";
import { Card, PageHeader } from "@/components/ui";
import { requireUser, isBoardObserver, homePath } from "@/lib/auth";
import {
  listPathways,
  canViewCertifications,
  SERVICE_CERT_CODES,
} from "@/lib/certifications";

export const dynamic = "force-dynamic";
export const metadata = { title: "Certification Pathways — CanopyOS" };

function CodeChip({ code }: { code: string }) {
  return (
    <Link
      href={`/management/certifications/${code}`}
      className="rounded-md bg-brand-50 px-1.5 py-0.5 text-[11px] font-semibold text-brand-700 hover:bg-brand-100"
    >
      {code}
    </Link>
  );
}

export default async function CertificationPathwaysPage() {
  const user = await requireUser();
  if (!canViewCertifications(user)) {
    redirect(isBoardObserver(user) ? "/management/board" : homePath(user));
  }

  const pathways = await listPathways();

  return (
    <>
      <div className="mb-2">
        <Link href="/management/certifications" className="text-xs font-medium text-brand-700 hover:underline">
          ← Certifications
        </Link>
      </div>
      <PageHeader
        title="Certification Pathways"
        subtitle="The required certifications for each career move. Read-only; rule flags (e.g. “all service certs”) are expanded here for reference — no enforcement is applied yet."
      />

      <div className="space-y-4">
        {pathways.map((p) => {
          const rules: string[] = [];
          if (p.includeHiredService) rules.push("the hired service's certification");
          if (p.includeAllServiceCerts) rules.push(`all service certifications (${SERVICE_CERT_CODES.join(", ")})`);
          if (p.includeSLS) rules.push("SLS");
          if (p.includeCSR) rules.push("CSR");
          if (p.includeAllCerts) rules.push("every certification (all service certs + CSR + SLS)");
          const nothing = p.fixedCerts.length === 0 && rules.length === 0;

          return (
            <Card key={p.key} className="p-4">
              <div className="text-base font-medium text-ink">{p.label}</div>
              {p.description ? <div className="mt-0.5 text-sm text-muted">{p.description}</div> : null}

              <div className="mt-3 border-t border-line pt-3">
                <div className="text-[11px] font-semibold uppercase tracking-wide text-muted">Required certifications</div>
                {nothing ? (
                  <div className="mt-1.5 text-sm text-muted">None defined.</div>
                ) : (
                  <div className="mt-2 space-y-2">
                    {p.fixedCerts.length > 0 ? (
                      <div className="flex flex-wrap items-center gap-1.5">
                        {p.fixedCerts.map((c) => (
                          <CodeChip key={c.code} code={c.code} />
                        ))}
                      </div>
                    ) : null}
                    {rules.length > 0 ? (
                      <ul className="space-y-1">
                        {rules.map((r, i) => (
                          <li key={i} className="flex items-start gap-2 text-sm text-ink">
                            <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-brand-400" />
                            <span>{r}</span>
                          </li>
                        ))}
                      </ul>
                    ) : null}
                  </div>
                )}
              </div>
            </Card>
          );
        })}
      </div>
    </>
  );
}
