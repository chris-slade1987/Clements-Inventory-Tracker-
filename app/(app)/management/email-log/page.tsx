import { redirect } from "next/navigation";
import { PageHeader, Card, EmptyState } from "@/components/ui";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

// Admin-only audit of every outbound notification. `sendEmail` (lib/email.ts)
// logs EVERY attempt — sent, skipped (no provider / no address), or errored — so
// this page is the ground truth when someone reports "I never got the email."
// Read-only; newest first; filterable by kind.

const STATUS_STYLE: Record<string, { label: string; cls: string }> = {
  sent: { label: "Sent", cls: "bg-emerald-100 text-emerald-800" },
  skipped_no_provider: { label: "No provider", cls: "bg-amber-100 text-amber-800" },
  skipped_no_address: { label: "No address", cls: "bg-amber-100 text-amber-800" },
  error: { label: "Error", cls: "bg-red-100 text-red-800" },
};

function StatusBadge({ status }: { status: string }) {
  const s = STATUS_STYLE[status] ?? { label: status, cls: "bg-slate-100 text-slate-700" };
  return <span className={`inline-block rounded-full px-2 py-0.5 text-[11px] font-medium ${s.cls}`}>{s.label}</span>;
}

export default async function EmailLogPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const user = await requireUser();
  if (user.role !== "admin") redirect("/");
  const sp = await searchParams;
  const kind = sp.kind && sp.kind !== "all" ? sp.kind : null;

  const [rows, kinds] = await Promise.all([
    prisma.emailLog.findMany({
      where: kind ? { kind } : undefined,
      orderBy: { createdAt: "desc" },
      take: 250,
    }),
    prisma.emailLog.findMany({ distinct: ["kind"], select: { kind: true }, orderBy: { kind: "asc" } }),
  ]);

  // At-a-glance health across the shown rows.
  const failed = rows.filter((r) => r.status !== "sent").length;

  return (
    <>
      <PageHeader
        title="Email delivery log"
        subtitle="Every outbound notification and its delivery status — sent, skipped, or errored"
      />

      {/* Kind filter */}
      <div className="mb-4 flex flex-wrap gap-1.5 print:hidden">
        <FilterChip href="/management/email-log" label="All" active={!kind} />
        {kinds.map((k) => (
          <FilterChip key={k.kind} href={`/management/email-log?kind=${encodeURIComponent(k.kind)}`} label={k.kind} active={kind === k.kind} />
        ))}
      </div>

      {rows.length === 0 ? (
        <EmptyState title="No emails logged yet" hint="Outbound notifications will appear here as the portal sends them." />
      ) : (
        <Card className="p-0 overflow-hidden">
          <div className="flex items-center justify-between px-4 py-2.5 border-b border-line text-xs text-muted">
            <span>Showing {rows.length} most-recent{kind ? ` · kind “${kind}”` : ""}</span>
            {failed > 0 ? <span className="font-medium text-red-700">{failed} not delivered</span> : <span className="text-emerald-700">All delivered</span>}
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-muted border-b border-line">
                  <th className="py-2 px-4 font-medium">When</th>
                  <th className="py-2 px-4 font-medium">Status</th>
                  <th className="py-2 px-4 font-medium">Kind</th>
                  <th className="py-2 px-4 font-medium">To</th>
                  <th className="py-2 px-4 font-medium">Subject</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className="border-b border-line last:border-0 align-top">
                    <td className="py-2 px-4 whitespace-nowrap text-muted tabular-nums">{r.createdAt.toLocaleString()}</td>
                    <td className="py-2 px-4"><StatusBadge status={r.status} /></td>
                    <td className="py-2 px-4 whitespace-nowrap text-ink">{r.kind}</td>
                    <td className="py-2 px-4 text-ink break-all">{r.to}</td>
                    <td className="py-2 px-4 text-ink">
                      {r.subject}
                      {r.error ? <div className="mt-0.5 text-[11px] text-red-700 break-all">{r.error}</div> : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </>
  );
}

function FilterChip({ href, label, active }: { href: string; label: string; active: boolean }) {
  return (
    <a
      href={href}
      className={`rounded-full border px-3 py-1 text-xs font-medium ${active ? "border-brand-500 bg-brand-50 text-brand-800" : "border-line text-muted hover:border-brand-300"}`}
    >
      {label}
    </a>
  );
}
