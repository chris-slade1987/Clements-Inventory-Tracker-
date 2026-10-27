import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Card } from "@/components/ui";
import { requireUser, branchLocked } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { visibleEmployeeIds } from "@/lib/org";
import PrintButton from "@/components/PrintButton";
import RecordDocument from "@/components/RecordDocument";

export const dynamic = "force-dynamic";

// Printable single personnel record (write-up, accident report, note, recognition)
// → browser Print / Save as PDF for a standalone document.
export default async function RecordPrintPage({ params }: { params: Promise<{ id: string; recordId: string }> }) {
  const user = await requireUser();
  const { id, recordId } = await params;

  const record = await prisma.personnelRecord.findUnique({
    where: { id: recordId },
    include: { employee: true, signatures: { orderBy: { signedAt: "asc" } } },
  });
  if (!record || record.employeeId !== id) notFound();

  // Access: branch-locked managers may print their own branch's records; everyone
  // else is limited to the profiles their org scope allows (HR/admin unrestricted).
  if (branchLocked(user)) {
    if (record.employee.branch !== user.branch) notFound();
  } else {
    const scope = await visibleEmployeeIds(user);
    if (scope && !scope.has(id)) notFound();
  }

  return (
    <>
      <div className="mb-2 flex items-center justify-between gap-2 print:hidden">
        <Link href={branchLocked(user) ? `/my-branch/team/${id}` : `/management/people/${id}`} className="text-xs font-medium text-brand-700 hover:underline">← Back to profile</Link>
        <PrintButton variant="primary" />
      </div>
      <Card className="p-5 sm:p-7 surface-light bg-white">
        <RecordDocument
          record={{
            type: record.type, category: record.category, title: record.title, body: record.body,
            incidentDate: record.incidentDate, actionTaken: record.actionTaken, followUp: record.followUp,
            details: record.details, attachmentName: record.attachmentName, attachmentFile: record.attachmentFile,
            authorName: record.authorName, acknowledgedAt: record.acknowledgedAt, createdAt: record.createdAt,
            signatures: record.signatures.map((s) => ({ role: s.role, signerName: s.signerName, statement: s.statement, signedAt: s.signedAt })),
          }}
          employee={{ name: record.employee.name, role: record.employee.role, division: record.employee.division, branch: record.employee.branch }}
        />
      </Card>
    </>
  );
}
