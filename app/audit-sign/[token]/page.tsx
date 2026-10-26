import { prisma } from "@/lib/prisma";
import AuditView from "@/components/AuditView";
import AuditSignClient from "./AuditSignClient";

export const dynamic = "force-dynamic";
export const metadata = { title: "Review & sign your branch audit — CanopyOS" };

function Panel({ children }: { children: React.ReactNode }) {
  return <div className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-black/5">{children}</div>;
}

export default async function AuditSignPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const audit = await prisma.branchAudit.findUnique({
    where: { managerSignToken: token },
    include: { rideAlongs: true, followUps: { orderBy: { createdAt: "asc" } } },
  });

  let body: React.ReactNode;
  if (!audit) {
    body = <Panel><p className="text-sm text-slate-600">This signing link is not valid or has already been used. Please contact the Director of Field Operations.</p></Panel>;
  } else if (audit.status === "signed" || audit.managerSignedAt) {
    body = <Panel><h2 className="text-lg font-semibold text-slate-900">Already signed</h2><p className="mt-1 text-sm text-slate-600">This audit is complete and on file. No further action is needed.</p></Panel>;
  } else {
    body = (
      <Panel>
        <AuditView audit={audit} />
        <div className="mt-6 border-t border-slate-200 pt-4">
          <div className="mb-2 text-sm font-semibold text-slate-900">Your signature</div>
          <AuditSignClient token={token} />
        </div>
      </Panel>
    );
  }

  return (
    <div className="min-h-screen bg-forest-grad px-4 py-10 flex justify-center">
      <div className="w-full max-w-2xl">
        <div className="mb-6 flex flex-col items-center">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/canopyos-wordmark.png" alt="CanopyOS" className="h-12 w-auto" />
        </div>
        {body}
      </div>
    </div>
  );
}
