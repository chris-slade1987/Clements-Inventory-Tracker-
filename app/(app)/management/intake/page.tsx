import { redirect } from "next/navigation";
import { PageHeader, Card, EmptyState } from "@/components/ui";
import { requireUser } from "@/lib/auth";
import { dateShort } from "@/lib/format";
import { branchLabel } from "@/lib/management";
import { listVehicles } from "@/lib/fleet";
import { recentIntake, destinationLabel, intakeReaderMode } from "@/lib/intake";
import IntakeWorkbench from "./IntakeWorkbench";

export const dynamic = "force-dynamic";

export default async function IntakePage() {
  const user = await requireUser();
  if (user.role !== "admin" && user.role !== "manager") redirect("/");

  const [vehicles, recent] = await Promise.all([listVehicles(undefined, "all"), recentIntake(15)]);
  const vehicleOpts = vehicles.map((v) => ({ id: v.id, label: `${v.unitNumber ? `#${v.unitNumber} · ` : ""}${v.name}${v.branch ? ` · ${branchLabel(v.branch)}` : ""}` }));
  const branchOpts = [
    { key: "vero", label: "Vero Beach (HQ)" },
    { key: "stuart", label: "Stuart" },
    { key: "orlando", label: "Orlando" },
    { key: "naples", label: "Naples" },
  ];

  return (
    <>
      <PageHeader title="Document Intake" subtitle="Drop in any file, tell Claude what it is, and approve where it goes" />

      <IntakeWorkbench vehicles={vehicleOpts} branches={branchOpts} readerMode={intakeReaderMode()} />

      <Card className="p-0 overflow-hidden mt-5">
        <div className="px-4 py-3 border-b border-line text-sm font-medium text-ink">Recently handled</div>
        {recent.length === 0 ? (
          <EmptyState title="Nothing filed yet" hint="Upload a document above to route your first one." />
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
}
