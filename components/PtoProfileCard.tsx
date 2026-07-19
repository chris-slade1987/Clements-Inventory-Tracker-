import { Card } from "@/components/ui";
import { ptoBalance, approvedPtoForEmployee, ptoTypeLabel } from "@/lib/pto";
import { prisma } from "@/lib/prisma";
import PtoAllowanceEditor from "@/components/PtoAllowanceEditor";

// Employee-profile PTO section: balance + upcoming/recent approved time off,
// with an inline allotment editor for authorized managers/HR. Server component.
function fmt(d: Date): string {
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
}

export default async function PtoProfileCard({ employeeId, canManage = false }: { employeeId: string; canManage?: boolean }) {
  const [balance, approved, emp] = await Promise.all([
    ptoBalance(employeeId),
    approvedPtoForEmployee(employeeId, 12),
    prisma.employee.findUnique({ where: { id: employeeId }, select: { ptoAllowanceDays: true } }),
  ]);
  const now = Date.now();
  const upcoming = approved.filter((r) => r.endDate.getTime() >= now).sort((a, b) => a.startDate.getTime() - b.startDate.getTime());
  const recent = approved.filter((r) => r.endDate.getTime() < now);

  return (
    <Card className="p-4 mb-5">
      <div className="flex items-center justify-between mb-3">
        <div className="text-sm font-medium text-ink">Paid time off</div>
        {canManage ? <PtoAllowanceEditor employeeId={employeeId} current={emp?.ptoAllowanceDays ?? null} /> : null}
      </div>
      <div className="grid grid-cols-4 gap-3 mb-3">
        <Stat label="Allotted" value={balance.allowance} />
        <Stat label="Used" value={balance.used} tone="warn" />
        <Stat label="Remaining" value={balance.remaining} tone={balance.remaining <= 0 ? "bad" : "good"} />
        <Stat label="Pending" value={balance.pending} />
      </div>
      {emp?.ptoAllowanceDays == null ? (
        <p className="text-[11px] text-muted mb-2">Using the company default allotment — set a specific value with “Set allotment”.</p>
      ) : null}

      {upcoming.length > 0 ? (
        <div className="mt-1">
          <div className="text-xs font-medium text-muted mb-1">Upcoming</div>
          <ul className="space-y-1">
            {upcoming.map((r) => (
              <li key={r.id} className="flex items-center gap-2 text-sm">
                <span className="h-2 w-2 rounded-full bg-emerald-500" />
                <span className="text-ink">{fmt(r.startDate)}{r.days > 1 ? ` – ${fmt(r.endDate)}` : ""}</span>
                <span className="text-xs text-muted">· {r.days} {ptoTypeLabel(r.type).toLowerCase()} day{r.days === 1 ? "" : "s"}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {recent.length > 0 ? (
        <div className="mt-3">
          <div className="text-xs font-medium text-muted mb-1">Recent</div>
          <ul className="space-y-1">
            {recent.slice(0, 5).map((r) => (
              <li key={r.id} className="flex items-center gap-2 text-sm text-muted">
                <span className="h-2 w-2 rounded-full bg-slate-300" />
                <span>{fmt(r.startDate)}{r.days > 1 ? ` – ${fmt(r.endDate)}` : ""}</span>
                <span className="text-xs">· {r.days} day{r.days === 1 ? "" : "s"}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {upcoming.length === 0 && recent.length === 0 ? (
        <p className="text-sm text-muted">No approved PTO on file.</p>
      ) : null}
    </Card>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone?: "good" | "warn" | "bad" }) {
  const color = tone === "bad" ? "text-red-600" : tone === "warn" ? "text-amber-600" : tone === "good" ? "text-brand-600" : "text-ink";
  return (
    <div>
      <div className="text-[11px] uppercase tracking-wider text-muted">{label}</div>
      <div className={`text-xl font-light tabular-nums ${color}`}>{value}</div>
    </div>
  );
}
