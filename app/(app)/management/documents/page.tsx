import Link from "next/link";
import { redirect } from "next/navigation";
import { Card, PageHeader, EmptyState } from "@/components/ui";
import { requireUser, isBoardObserver } from "@/lib/auth";
import { dateShort } from "@/lib/format";
import { branchLabel } from "@/lib/management";
import { listVehicles } from "@/lib/fleet";
import { pendingDocs, recentFiledDocs, expiringDocs, categoryLabel } from "@/lib/documents";
import { recentIntake, destinationLabel, intakeReaderMode } from "@/lib/intake";
import DeleteDocButton from "./DeleteDocButton";
import DocumentsTabs from "./DocumentsTabs";
import IntakeWorkbench from "@/app/(app)/management/intake/IntakeWorkbench";
import FuelStatementUpload from "@/components/FuelStatementUpload";

export const dynamic = "force-dynamic";

const CAT_STYLE: Record<string, string> = {
  insurance: "bg-brand-100 text-brand-700",
  registration: "bg-amber-100 text-amber-700",
  title: "bg-slate-100 text-slate-600",
  inspection: "bg-emerald-100 text-emerald-700",
  other: "bg-slate-100 text-slate-600",
};

const BRANCH_OPTS = [
  { key: "vero", label: "Vero Beach (HQ)" },
  { key: "stuart", label: "Stuart" },
  { key: "orlando", label: "Orlando" },
  { key: "naples", label: "Naples" },
];

// Unified Documents home. "Add" = the agentic intake chat (one way in, for any
// file). "Filed" = the vehicle-document library + renewals + fuel statements
// (exec / HR). A branch manager gets the Add tab only; they use their Branch Hub
// for branch documents.
export default async function DocumentsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const user = await requireUser();
  if (isBoardObserver(user)) redirect("/management/board");
  const sp = await searchParams;
  // Add (intake) is open to admins + managers; the Filed vehicle-doc library is
  // exec / HR. Anyone else goes to their Branch Hub for on-site documents.
  const canAdd = user.role === "admin" || user.role === "manager";
  const canSeeFiled = user.role === "admin" || !!user.seniorLeadership || !!user.hrAccess;
  if (!canAdd && !canSeeFiled) redirect("/my-branch/documents");

  // Intake "Add" tab data (vehicle picker for routing a doc to a vehicle).
  const vehicles = await listVehicles(undefined, "all");
  const vehicleOpts = vehicles.map((v) => ({ id: v.id, label: `${v.unitNumber ? `#${v.unitNumber} · ` : ""}${v.name}${v.branch ? ` · ${branchLabel(v.branch)}` : ""}` }));
  const recent = await recentIntake(15);

  const addNode = (
    <>
      <IntakeWorkbench vehicles={vehicleOpts} branches={BRANCH_OPTS} readerMode={intakeReaderMode()} />
      <Card className="p-0 overflow-hidden mt-5">
        <div className="px-4 py-3 border-b border-line text-sm font-medium text-ink">Recently handled</div>
        {recent.length === 0 ? (
          <EmptyState title="Nothing handled yet" hint="Upload a document above to route your first one." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-muted border-b border-line">
                  <th className="px-4 py-2 font-medium">Document</th>
                  <th className="px-3 py-2 font-medium">Routed to</th>
                  <th className="px-3 py-2 font-medium">Status</th>
                  <th className="px-4 py-2 font-medium text-right">When</th>
                </tr>
              </thead>
              <tbody>
                {recent.map((d) => (
                  <tr key={d.id} className="border-b border-line last:border-0">
                    <td className="px-4 py-2">
                      {d.filePath ? <a href={d.filePath} target="_blank" className="font-medium text-brand-700 hover:underline">{d.title ?? d.fileName ?? "Document"}</a> : <span className="font-medium">{d.title ?? d.fileName ?? "Document"}</span>}
                      {d.tags ? <div className="text-[11px] text-muted">{d.tags}</div> : null}
                    </td>
                    <td className="px-3 py-2 text-muted">{d.routedLabel ?? (d.routedTo ? destinationLabel(d.routedTo) : "—")}</td>
                    <td className="px-3 py-2">
                      <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${d.status === "filed" ? "bg-emerald-100 text-emerald-700" : d.status === "discarded" ? "bg-slate-100 text-slate-500" : "bg-amber-100 text-amber-700"}`}>
                        {d.status === "filed" ? "Filed" : d.status === "discarded" ? "Discarded" : "Pending"}
                      </span>
                    </td>
                    <td className="px-4 py-2 text-right text-muted">{dateShort(d.filedAt ?? d.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </>
  );

  let filedNode: React.ReactNode = null;
  if (canSeeFiled) {
    const now = Date.now();
    const [pending, filed, expiring] = await Promise.all([pendingDocs(), recentFiledDocs(20), expiringDocs(45)]);
    filedNode = (
      <>
        <div className="mb-5">
          <div className="mb-1.5 flex items-center justify-between">
            <div className="text-xs font-semibold uppercase tracking-wide text-muted">Fuel statements (Coast)</div>
            <Link href="/fleet/fuel" className="text-xs font-medium text-brand-700 hover:underline">Fuel dashboard →</Link>
          </div>
          <FuelStatementUpload />
        </div>

        {expiring.length > 0 ? (
          <Card className="p-0 overflow-hidden mb-5 ring-1 ring-amber-200">
            <div className="px-4 py-3 border-b border-line text-sm font-medium text-ink">Renewals due soon</div>
            <ul className="divide-y divide-line">
              {expiring.map((d) => {
                const overdue = d.expirationDate!.getTime() < now;
                return (
                  <li key={d.id} className="flex flex-wrap items-center gap-2 px-4 py-2.5">
                    <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${CAT_STYLE[d.category]}`}>{categoryLabel(d.category)}</span>
                    <span className="text-sm text-ink">{d.title}</span>
                    {d.vehicle ? <Link href={`/fleet/${d.vehicleId}`} className="text-xs text-brand-700 hover:underline">{d.vehicle.unitNumber ? `#${d.vehicle.unitNumber} · ` : ""}{d.vehicle.name}</Link> : null}
                    <span className={`ml-auto text-xs font-medium ${overdue ? "text-red-600" : "text-amber-600"}`}>{overdue ? "expired" : "due"} {dateShort(d.expirationDate!)}</span>
                  </li>
                );
              })}
            </ul>
          </Card>
        ) : null}

        {pending.length > 0 ? (
          <Card className="p-0 overflow-hidden mb-5">
            <div className="px-4 py-3 border-b border-line text-sm font-medium text-ink">Awaiting filing</div>
            <ul className="divide-y divide-line">
              {pending.map((d) => (
                <li key={d.id} className="flex flex-wrap items-center gap-2 px-4 py-2.5">
                  <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${CAT_STYLE[d.category]}`}>{categoryLabel(d.category)}</span>
                  <span className="text-sm text-ink">{d.title}</span>
                  {d.filePath ? <a href={d.filePath} target="_blank" className="text-xs text-brand-700 hover:underline">view file</a> : null}
                  <span className="ml-auto text-xs text-muted">uploaded {dateShort(d.createdAt)}</span>
                  <DeleteDocButton id={d.id} label="Discard" />
                </li>
              ))}
            </ul>
          </Card>
        ) : null}

        <Card className="p-0 overflow-hidden">
          <div className="px-4 py-3 border-b border-line text-sm font-medium text-ink">Recently filed</div>
          {filed.length === 0 ? (
            <EmptyState title="No documents yet" hint="Add an insurance policy or registration in the Add tab to get started." />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-muted border-b border-line">
                    <th className="px-4 py-2 font-medium">Document</th>
                    <th className="px-3 py-2 font-medium">Category</th>
                    <th className="px-3 py-2 font-medium">Vehicle</th>
                    <th className="px-3 py-2 font-medium">Renewal</th>
                    <th className="px-3 py-2 font-medium text-right">Filed</th>
                    <th className="px-4 py-2 font-medium text-right"></th>
                  </tr>
                </thead>
                <tbody>
                  {filed.map((d) => (
                    <tr key={d.id} className="border-b border-line last:border-0">
                      <td className="px-4 py-2">
                        {d.filePath ? <a href={d.filePath} target="_blank" className="font-medium text-brand-700 hover:underline">{d.title}</a> : <span className="font-medium">{d.title}</span>}
                        {d.insurer ? <div className="text-[11px] text-muted">{d.insurer}{d.policyNumber ? ` · ${d.policyNumber}` : ""}</div> : null}
                      </td>
                      <td className="px-3 py-2"><span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${CAT_STYLE[d.category]}`}>{categoryLabel(d.category)}</span></td>
                      <td className="px-3 py-2">{d.vehicle ? <Link href={`/fleet/${d.vehicleId}`} className="text-brand-700 hover:underline">{d.vehicle.unitNumber ? `#${d.vehicle.unitNumber} · ` : ""}{d.vehicle.name}</Link> : "—"}</td>
                      <td className="px-3 py-2 text-muted">{d.expirationDate ? dateShort(d.expirationDate) : "—"}</td>
                      <td className="px-3 py-2 text-right text-muted">{dateShort(d.createdAt)}</td>
                      <td className="px-4 py-2 text-right"><DeleteDocButton id={d.id} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </>
    );
  }

  return (
    <>
      <PageHeader title="Documents" subtitle="Add any document through the AI intake, or browse what's been filed" />
      <DocumentsTabs initialTab={sp.tab} canSeeFiled={canSeeFiled} add={addNode} filed={filedNode} />
    </>
  );
}
