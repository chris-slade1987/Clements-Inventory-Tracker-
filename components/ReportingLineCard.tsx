import Link from "next/link";
import { Card } from "@/components/ui";

// Reporting line for a profile: who this person reports to (their supervisor) and
// who reports to them (their team). Reflects Employee.reportsToId, which super
// admins set on the org chart — so a move there shows up here immediately.

type Person = { id: string; name: string; title: string | null; role: string | null };

export default function ReportingLineCard({
  supervisor,
  directReports,
  profileBase,
  editHref,
}: {
  supervisor: Person | null;
  directReports: Person[];
  profileBase: string | null;
  editHref?: string | null;
}) {
  const link = (p: Person) =>
    profileBase ? (
      <Link href={`${profileBase}/${p.id}`} className="text-brand-700 hover:underline">{p.name}</Link>
    ) : (
      <span className="text-ink">{p.name}</span>
    );

  return (
    <Card className="p-4 mb-5">
      <div className="flex items-center justify-between gap-2 mb-3">
        <div className="text-sm font-medium text-ink">Reporting line</div>
        {editHref ? <a href={editHref} className="text-xs font-medium text-brand-700 hover:underline">Edit on org chart →</a> : null}
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-wide text-muted">Reports to</div>
          {supervisor ? (
            <div className="mt-1 text-sm">{link(supervisor)}{supervisor.title || supervisor.role ? <span className="text-muted"> · {supervisor.title || supervisor.role}</span> : null}</div>
          ) : (
            <div className="mt-1 inline-flex items-center gap-1.5 rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-800">No supervisor assigned</div>
          )}
        </div>
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-wide text-muted">Team — direct reports ({directReports.length})</div>
          {directReports.length ? (
            <ul className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-sm">
              {directReports.map((p) => <li key={p.id}>{link(p)}</li>)}
            </ul>
          ) : (
            <div className="mt-1 text-sm text-muted">No direct reports.</div>
          )}
        </div>
      </div>
    </Card>
  );
}
