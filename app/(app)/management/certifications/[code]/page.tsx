import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Card, PageHeader } from "@/components/ui";
import { requireUser, isBoardObserver, homePath } from "@/lib/auth";
import { getCertificationByCode, canViewCertifications } from "@/lib/certifications";

export const dynamic = "force-dynamic";

const STATUS_CHIP: Record<string, string> = {
  exists: "bg-emerald-100 text-emerald-800",
  partial: "bg-amber-100 text-amber-800",
  none: "bg-slate-100 text-slate-700",
};

function statusBucket(s: string): "exists" | "partial" | "none" {
  const v = s.trim().toLowerCase();
  if (v.startsWith("partial")) return "partial";
  if (v === "" || v === "none") return "none";
  return "exists";
}

export default async function CertificationDetailPage({ params }: { params: Promise<{ code: string }> }) {
  const user = await requireUser();
  if (!canViewCertifications(user)) {
    redirect(isBoardObserver(user) ? "/management/board" : homePath(user));
  }
  const { code } = await params;
  const cert = await getCertificationByCode(code);
  if (!cert) notFound();

  return (
    <>
      <PageHeader
        title={`${cert.code} — ${cert.name}`}
        subtitle={`${cert.courses.length} courses${cert.isServiceCert ? " · service certification" : ""}`}
        actions={
          <Link
            href="/management/certifications"
            className="inline-flex items-center justify-center gap-2 rounded-xl border border-[#cfe0d6] bg-white px-4 py-2.5 text-sm font-medium text-[#0e1b15] hover:bg-[#eef5f0] transition-colors"
          >
            All certifications
          </Link>
        }
      />

      <Card className="mb-5 p-4">
        <div className="text-xs text-muted">
          <span className="font-medium text-emerald-700 tabular-nums">{cert.statusCounts.exists}</span> ready ·{" "}
          <span className="font-medium text-amber-700 tabular-nums">{cert.statusCounts.partial}</span> partial ·{" "}
          <span className="font-medium text-slate-600 tabular-nums">{cert.statusCounts.none}</span> none
        </div>
        {cert.inModules.length > 0 ? (
          <div className="mt-3 flex flex-wrap items-center gap-1 text-[11px] text-muted">
            <span className="font-medium text-ink">Appears in modules:</span>
            {cert.inModules.map((m) => (
              <span key={m.code} className="rounded bg-black/[0.05] px-1.5 py-0.5 font-medium text-ink">{m.code}</span>
            ))}
          </div>
        ) : null}
      </Card>

      <Card className="p-0 overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-[11px] text-muted border-b border-line">
              <th className="px-4 py-2.5 font-medium">#</th>
              <th className="px-3 py-2.5 font-medium">Course</th>
              <th className="px-3 py-2.5 font-medium">Type</th>
              <th className="px-3 py-2.5 font-medium text-right">Content</th>
            </tr>
          </thead>
          <tbody>
            {cert.courses.map((m) => (
              <tr key={m.code} className="border-b border-line last:border-0">
                <td className="px-4 py-3 align-top tabular-nums text-muted">{m.order}</td>
                <td className="px-3 py-3 align-top">
                  <span className="inline-flex items-center gap-2">
                    <span className="rounded-md bg-brand-50 px-1.5 py-0.5 text-[11px] font-semibold text-brand-700">{m.code}</span>
                    <span className="font-medium text-ink">{m.name}</span>
                  </span>
                  {m.sourceNote ? <div className="mt-0.5 text-[11px] text-muted">{m.sourceNote}</div> : null}
                </td>
                <td className="px-3 py-3 align-top text-muted">
                  {m.courseType === "field_signoff" ? (
                    <span className="rounded-full bg-indigo-100 px-2 py-0.5 text-[10px] font-medium text-indigo-800">field sign-off</span>
                  ) : (
                    <span className="text-xs">Written{m.targetMinutes ? ` · ${m.targetMinutes}m` : ""}</span>
                  )}
                </td>
                <td className="px-3 py-3 align-top text-right">
                  <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${STATUS_CHIP[statusBucket(m.contentStatus)]}`}>
                    {m.contentStatus}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </>
  );
}
