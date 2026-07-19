import Link from "next/link";
import { redirect } from "next/navigation";
import { Card, PageHeader } from "@/components/ui";
import { requireUser } from "@/lib/auth";
import { money } from "@/lib/format";
import { branchLabel } from "@/lib/management";
import {
  branchHealth, needsAttention, coverageMatrix, renewalCalendar, obligations,
  canViewCompliance,
  type ComplianceStatus,
} from "@/lib/compliance";

export const dynamic = "force-dynamic";
export const metadata = { title: "Compliance Command Center — Clements Command & Control" };

const fmt = (d: Date | null) => (d ? d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }) : "—");
const MONTH = (ym: string) => { const [y, m] = ym.split("-").map(Number); return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString("en-US", { month: "short", year: "2-digit", timeZone: "UTC" }); };

const STATUS: Record<ComplianceStatus, { label: string; pill: string; dot: string }> = {
  ok: { label: "Current", pill: "bg-emerald-100 text-emerald-800", dot: "bg-emerald-500" },
  warning: { label: "Due soon", pill: "bg-amber-100 text-amber-800", dot: "bg-amber-500" },
  critical: { label: "Expiring", pill: "bg-orange-100 text-orange-800", dot: "bg-orange-500" },
  expired: { label: "Expired", pill: "bg-red-100 text-red-800", dot: "bg-red-500" },
  missing: { label: "Missing", pill: "bg-red-100 text-red-800", dot: "bg-red-600" },
};
const RAG = {
  green: { ring: "ring-emerald-300", chip: "bg-emerald-500", label: "Compliant" },
  amber: { ring: "ring-amber-300", chip: "bg-amber-500", label: "Attention" },
  red: { ring: "ring-red-300", chip: "bg-red-500", label: "Action needed" },
};

export default async function CompliancePage() {
  const user = await requireUser();
  if (!canViewCompliance(user)) redirect("/dashboard");

  const [health, attention, matrix, calendar, obl] = await Promise.all([
    branchHealth(), needsAttention(), coverageMatrix(), renewalCalendar(90), obligations(6),
  ]);
  const maxMonth = Math.max(1, ...obl.byMonth.map((m) => m.total));

  return (
    <>
      <PageHeader title="Compliance Command Center" subtitle="Every license, insurance policy, lease & renewal across Clements — one live view. Senior leadership only." />

      {/* Health board */}
      <div className="grid gap-3 grid-cols-2 lg:grid-cols-4 mb-6">
        {health.map((h) => (
          <Card key={h.branch} className={`p-4 ring-1 ${RAG[h.status].ring}`}>
            <div className="flex items-center justify-between">
              <div className="text-sm font-semibold text-ink">{h.label}</div>
              <span className={`h-2.5 w-2.5 rounded-full ${RAG[h.status].chip}`} />
            </div>
            <div className="mt-1 text-xs font-medium text-muted">{RAG[h.status].label}</div>
            {h.issues.length > 0 ? (
              <ul className="mt-2 space-y-0.5">
                {h.issues.map((i, k) => <li key={k} className={`text-[11px] ${i.level === "red" ? "text-red-600" : "text-amber-600"}`}>{i.text}</li>)}
              </ul>
            ) : <div className="mt-2 text-[11px] text-emerald-700">All requirements current</div>}
          </Card>
        ))}
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2 space-y-6">
          {/* Needs attention */}
          <Card className="p-0 overflow-hidden">
            <div className="px-4 py-3 border-b border-line flex items-center justify-between">
              <div className="text-sm font-semibold text-ink">Needs attention now</div>
              <span className="text-[11px] text-muted">{attention.length} item{attention.length === 1 ? "" : "s"}</span>
            </div>
            {attention.length === 0 ? (
              <p className="px-4 py-8 text-center text-sm text-muted">Nothing expired or missing — every branch is covered.</p>
            ) : (
              <ul className="divide-y divide-line">
                {attention.map((i) => (
                  <li key={i.id}>
                    <Link href={i.href} className="flex items-start gap-3 px-4 py-3 hover:bg-black/[0.02]">
                      <span className={`mt-1 h-2 w-2 shrink-0 rounded-full ${STATUS[i.status].dot}`} />
                      <span className="min-w-0 flex-1">
                        <span className="block text-sm font-medium text-ink">{i.title}</span>
                        <span className="block text-xs text-muted">
                          {i.categoryLabel}{i.branch ? ` · ${branchLabel(i.branch)}` : ""}{i.detail ? ` · ${i.detail}` : ""}
                          {i.expiration ? ` · ${i.status === "expired" ? "expired" : "expires"} ${fmt(i.expiration)}` : ""}
                        </span>
                      </span>
                      <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold ${STATUS[i.status].pill}`}>{STATUS[i.status].label}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          {/* Coverage matrix */}
          <Card className="p-0 overflow-hidden">
            <div className="px-4 py-3 border-b border-line text-sm font-semibold text-ink">Coverage matrix</div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-[11px] text-muted border-b border-line">
                    <th className="px-4 py-2 font-medium">Requirement</th>
                    {matrix.rows.map((r) => <th key={r.branch} className="px-3 py-2 font-medium text-center">{r.label}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {matrix.requirements.map((req) => (
                    <tr key={req.key} className="border-b border-line last:border-0">
                      <td className="px-4 py-2.5 font-medium text-ink">{req.label}{req.critical ? "" : " *"}</td>
                      {matrix.rows.map((r) => {
                        const c = r.cells[req.key];
                        const ok = c.status === "ok" || c.status === "warning";
                        return (
                          <td key={r.branch} className="px-3 py-2.5 text-center">
                            <span className={`inline-flex h-6 w-6 items-center justify-center rounded-full text-xs ${ok ? "bg-emerald-100 text-emerald-700" : c.status === "warning" ? "bg-amber-100 text-amber-700" : "bg-red-100 text-red-600"}`}>
                              {ok ? "✓" : c.status === "missing" ? "—" : "!"}
                            </span>
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="px-4 py-2 border-t border-line text-[11px] text-muted">✓ current · ! expiring/expired · — not on file. General liability is company-wide. <span className="opacity-70">* lease is N/A for owned locations.</span></div>
          </Card>
        </div>

        {/* Right column: forward calendar + obligations */}
        <div className="space-y-6">
          <Card className="p-0 overflow-hidden">
            <div className="px-4 py-3 border-b border-line flex items-center justify-between">
              <div className="text-sm font-semibold text-ink">Renewals</div>
              <span className="text-[11px] text-muted">next 90 days</span>
            </div>
            {calendar.length === 0 ? (
              <p className="px-4 py-8 text-center text-sm text-muted">No renewals due in the next 90 days.</p>
            ) : (
              <ul className="divide-y divide-line max-h-[22rem] overflow-y-auto">
                {calendar.map((i) => (
                  <li key={i.id} className="flex items-start gap-3 px-4 py-2.5">
                    <span className={`mt-0.5 h-2 w-2 shrink-0 rounded-full ${STATUS[i.status].dot}`} />
                    <span className="min-w-0 flex-1">
                      <span className="block text-[13px] font-medium text-ink leading-snug">{i.title}</span>
                      <span className="block text-[11px] text-muted">{i.categoryLabel}{i.branch ? ` · ${branchLabel(i.branch)}` : ""}</span>
                    </span>
                    <span className="shrink-0 text-right">
                      <span className="block text-[11px] font-medium text-ink tabular-nums">{fmt(i.expiration)}</span>
                      {i.daysOut != null ? <span className="block text-[10px] text-muted tabular-nums">{i.daysOut}d</span> : null}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card className="p-4">
            <div className="text-sm font-semibold text-ink mb-2">Obligations &amp; cash</div>
            <div className="space-y-1.5 mb-3">
              {obl.byMonth.map((m) => (
                <div key={m.month} className="flex items-center gap-2">
                  <div className="w-10 shrink-0 text-[11px] text-muted">{MONTH(m.month)}</div>
                  <div className="flex-1 h-4 rounded bg-black/[0.05] overflow-hidden"><div className="h-full bg-emerald-grad rounded" style={{ width: `${(m.total / maxMonth) * 100}%` }} /></div>
                  <div className="w-16 shrink-0 text-right text-[11px] tabular-nums text-ink">{money(m.total)}</div>
                </div>
              ))}
            </div>
            <div className="text-[11px] text-muted">Insurance installments + monthly rent, next 6 months. Fleet loan payments fold in once payment terms are captured.</div>
          </Card>
        </div>
      </div>
    </>
  );
}
