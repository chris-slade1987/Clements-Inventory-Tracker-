import Link from "next/link";
import { redirect } from "next/navigation";
import { Card, PageHeader, EmptyState } from "@/components/ui";
import { requireUser, isBoardObserver, homePath } from "@/lib/auth";
import { canViewAllPto } from "@/lib/pto";
import { isHrDirector } from "@/lib/personnel";
import { branchLabel } from "@/lib/management";
import { handbookAckRoster } from "@/lib/policy-docs";
import RowActions from "./RowActions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Handbook acknowledgments — Canopy OS" };

const D = (d: Date | null) => (d ? d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "");
const SOURCE: Record<string, string> = { in_app: "in-app", onboarding: "onboarding", link: "signed link" };

export default async function HandbookRosterPage() {
  const user = await requireUser();
  if (isBoardObserver(user)) redirect(homePath(user));
  if (!(canViewAllPto(user) || isHrDirector(user))) redirect("/management/people");

  const { version, rows } = await handbookAckRoster();
  const done = rows.filter((r) => r.acknowledged);
  const outstanding = rows.filter((r) => !r.acknowledged);
  const pct = rows.length ? Math.round((done.length / rows.length) * 100) : 0;

  // Group by branch for readability.
  const branches = Array.from(new Set(rows.map((r) => r.branch ?? "—"))).sort();

  return (
    <>
      <PageHeader
        title="Handbook acknowledgments"
        subtitle={`Employee Handbook v${version} — who has signed and who still needs to.`}
        actions={<Link href="/management/people" className="text-sm font-medium text-emerald-700 hover:underline">← People / HR</Link>}
      />

      <div className="grid grid-cols-3 gap-3 mb-5">
        <Stat label="Acknowledged" value={`${done.length}`} tone="emerald" />
        <Stat label="Outstanding" value={`${outstanding.length}`} tone="amber" />
        <Stat label="Completion" value={`${pct}%`} tone="slate" />
      </div>

      {rows.length === 0 ? (
        <EmptyState title="No active employees" hint="Once employees are on the roster their acknowledgment status will appear here." />
      ) : (
        <div className="space-y-6">
          {branches.map((b) => {
            const list = rows.filter((r) => (r.branch ?? "—") === b);
            return (
              <Card key={b} className="overflow-hidden">
                <div className="px-4 py-2.5 border-b border-line bg-brand-50/50 text-sm font-semibold text-ink">
                  {b === "—" ? "Unassigned branch" : branchLabel(b)} <span className="font-normal text-muted">· {list.filter((r) => r.acknowledged).length}/{list.length}</span>
                </div>
                <div className="divide-y divide-line">
                  {list.map((r) => (
                    <div key={r.employeeId} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-medium text-ink truncate">{r.name}</div>
                        {r.email ? <div className="text-xs text-muted truncate">{r.email}</div> : null}
                      </div>
                      {r.acknowledged ? (
                        <div className="text-xs">
                          <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 font-medium text-emerald-700">✓ Acknowledged v{r.version}</span>
                          <span className="ml-2 text-muted">{D(r.acknowledgedAt)}{r.source ? ` · ${SOURCE[r.source] ?? r.source}` : ""}</span>
                        </div>
                      ) : (
                        <div className="flex items-center gap-3">
                          <span className="inline-flex items-center rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700">Outstanding</span>
                          <RowActions employeeId={r.employeeId} />
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone: "emerald" | "amber" | "slate" }) {
  const cls = tone === "emerald" ? "text-emerald-700" : tone === "amber" ? "text-amber-700" : "text-ink";
  return (
    <Card className="p-4">
      <div className="text-xs uppercase tracking-wide text-muted">{label}</div>
      <div className={`mt-1 text-2xl font-light ${cls}`}>{value}</div>
    </Card>
  );
}
