import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Card, PageHeader } from "@/components/ui";
import { requireUser, branchLocked } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { branchLabel } from "@/lib/management";
import { dateShort } from "@/lib/format";
import { employeeRecords, recordTypeLabel } from "@/lib/personnel";
import { parseJson } from "@/lib/inspection";
import PtoProfileCard from "@/components/PtoProfileCard";
import RecordForm from "./RecordForm";
import SignatureBlock from "./SignatureBlock";

export const dynamic = "force-dynamic";

const TYPE_STYLE: Record<string, string> = {
  writeup: "bg-amber-100 text-amber-700",
  note: "bg-slate-100 text-slate-600",
  recognition: "bg-emerald-100 text-emerald-700",
  accident: "bg-red-100 text-red-700",
};

export default async function TeamMemberPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await params;
  const employee = await prisma.employee.findUnique({ where: { id } });
  if (!employee) notFound();
  if (branchLocked(user) && employee.branch !== user.branch) redirect("/my-branch/team");

  const records = await employeeRecords(id);

  return (
    <>
      <div className="mb-2"><Link href="/my-branch/team" className="text-xs font-medium text-brand-300 hover:underline">← My Team</Link></div>
      <PageHeader title={employee.name} subtitle={[employee.role, employee.division, employee.branch ? branchLabel(employee.branch) : null].filter(Boolean).join(" · ") || "Team member"} />

      <PtoProfileCard
        employeeId={employee.id}
        canManage={user.role === "admin" || user.hrAccess || (user.role === "manager" && !!user.branch && user.branch === employee.branch)}
      />

      <RecordForm employeeId={employee.id} employeeName={employee.name} />

      <Card className="p-0 overflow-hidden mt-5">
        <div className="px-4 py-3 border-b border-line text-sm font-medium text-ink">Personnel record</div>
        {records.length === 0 ? (
          <p className="px-4 py-8 text-center text-sm text-muted">No records yet. Use the actions above to file the first one.</p>
        ) : (
          <ul className="divide-y divide-line">
            {records.map((r) => {
              const details = parseJson<Record<string, string>>(r.details, {});
              return (
                <li key={r.id} className="px-4 py-3">
                  <div className="flex items-center gap-2">
                    <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${TYPE_STYLE[r.type] ?? "bg-slate-100 text-slate-600"}`}>{recordTypeLabel(r.type)}{r.category ? ` · ${r.category}` : ""}</span>
                    <span className="text-xs text-muted">{dateShort(r.createdAt)} · {r.authorName ?? "—"}</span>
                    {r.hrNotified ? <span className="text-[11px] text-brand-600">HR notified</span> : <span className="text-[11px] text-muted">HR queued</span>}
                  </div>
                  {r.title ? <div className="mt-1 text-sm font-medium text-ink">{r.title}</div> : null}
                  {r.body ? <div className="mt-0.5 text-sm text-muted whitespace-pre-line">{r.body}</div> : null}
                  {r.incidentDate ? <div className="mt-1 text-xs text-muted">Incident: {dateShort(r.incidentDate)}</div> : null}
                  {Object.keys(details).length > 0 ? (
                    <div className="mt-1 text-xs text-muted">
                      {Object.entries(details).filter(([, v]) => v && typeof v === "string").slice(0, 8).map(([k, v]) => <span key={k} className="mr-3"><span className="font-medium">{k}:</span> {String(v)}</span>)}
                    </div>
                  ) : null}
                  {r.actionTaken ? <div className="mt-1 text-xs"><span className="font-medium text-ink">Action:</span> <span className="text-muted">{r.actionTaken}</span></div> : null}
                  {r.attachmentFile ? <a href={r.attachmentFile} target="_blank" className="mt-1 inline-block text-xs font-medium text-brand-700 hover:underline">📎 {r.attachmentName ?? "attachment"}</a> : null}
                  {(r.type === "writeup" || r.type === "accident") ? (
                    <SignatureBlock
                      recordId={r.id}
                      type={r.type}
                      employeeEmail={employee.email ?? ""}
                      signatures={r.signatures.map((s) => ({ id: s.id, role: s.role, signerName: s.signerName, signedAt: s.signedAt }))}
                      requests={r.signatureRequests.map((q) => ({ id: q.id, role: q.role, email: q.email }))}
                    />
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </Card>
    </>
  );
}
