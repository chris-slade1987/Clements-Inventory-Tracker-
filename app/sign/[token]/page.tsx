import { prisma } from "@/lib/prisma";
import { branchLabel } from "@/lib/management";
import { signatureRoles, recordTypeLabel } from "@/lib/personnel";
import { parseJson } from "@/lib/inspection";
import SignClient from "./SignClient";

export const dynamic = "force-dynamic";
export const metadata = { title: "Review & sign — Clements Command & Control" };

const MONTH = (d: Date) => d.toLocaleDateString();

export default async function SignPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const request = await prisma.signatureRequest.findUnique({
    where: { token },
    include: { record: { include: { employee: { select: { name: true, branch: true } } } } },
  });

  return (
    <div className="min-h-screen bg-forest-grad px-4 py-10 flex justify-center">
      <div className="w-full max-w-xl">
        <div className="flex flex-col items-center mb-6">
          <span className="grid place-items-center h-12 w-12 rounded-2xl bg-emerald-grad text-[#05271c] text-xl font-semibold shadow-xl">C</span>
          <h1 className="mt-3 text-xl font-light tracking-tight text-white">Clements Command &amp; Control</h1>
        </div>

        {!request ? (
          <Panel><p className="text-sm text-muted">This signing link is not valid or has expired. Please contact your manager or HR.</p></Panel>
        ) : request.signedAt ? (
          <Panel>
            <h2 className="text-lg font-semibold text-ink">Already signed</h2>
            <p className="mt-1 text-sm text-muted">This document was e-signed by {request.signerName ?? "the signer"} on {MONTH(request.signedAt)}. No further action is needed.</p>
          </Panel>
        ) : (
          (() => {
            const r = request.record;
            const roleDef = signatureRoles(r.type).find((x) => x.key === request.role);
            const details = parseJson<Record<string, string>>(r.details, {});
            const detailRows = Object.entries(details).filter(([, v]) => v && typeof v === "string");
            return (
              <Panel>
                <div className="text-xs uppercase tracking-wider text-muted">{recordTypeLabel(r.type)}{r.category ? ` · ${r.category}` : ""}</div>
                <h2 className="mt-1 text-lg font-semibold text-ink">{r.title || recordTypeLabel(r.type)}</h2>
                <p className="text-sm text-muted">{r.employee.name}{r.employee.branch ? ` · ${branchLabel(r.employee.branch)}` : ""}{r.incidentDate ? ` · ${MONTH(r.incidentDate)}` : ""}</p>

                {r.body ? <p className="mt-3 text-sm text-ink whitespace-pre-line">{r.body}</p> : null}
                {r.actionTaken ? <p className="mt-2 text-sm text-ink"><span className="font-medium">Action / comments:</span> {r.actionTaken}</p> : null}
                {detailRows.length > 0 ? (
                  <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
                    {detailRows.map(([k, v]) => <div key={k} className="contents"><dt className="text-muted">{k}</dt><dd className="text-ink">{String(v)}</dd></div>)}
                  </dl>
                ) : null}

                <SignClient token={token} role={roleDef?.label ?? request.role} statement={roleDef?.statement ?? "I have read and agree to the above."} defaultName={request.role === "employee" ? r.employee.name : ""} />
              </Panel>
            );
          })()
        )}
      </div>
    </div>
  );
}

function Panel({ children }: { children: React.ReactNode }) {
  return <div className="rounded-2xl border border-white/10 bg-white/95 p-5 shadow-xl">{children}</div>;
}
