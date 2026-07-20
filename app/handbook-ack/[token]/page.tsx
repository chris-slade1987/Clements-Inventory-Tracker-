import { ackTokenWithDoc } from "@/lib/policy-docs";
import Markdown from "@/components/Markdown";
import HandbookAckClient from "./HandbookAckClient";

export const dynamic = "force-dynamic";
export const metadata = { title: "Employee Handbook — Clements Pest Control" };

const D = (d: Date) => d.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });

export default async function HandbookAckPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const rec = await ackTokenWithDoc(token);

  return (
    <div className="min-h-screen bg-forest-grad px-4 py-8 sm:py-10 flex justify-center">
      <div className="w-full max-w-3xl">
        <div className="flex flex-col items-center mb-6">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/clements-mark.svg" alt="Clements" className="h-12 w-12" />
          <h1 className="mt-3 text-xl font-light tracking-tight text-white">Clements Pest Control</h1>
          <p className="text-sm text-mint">Employee Handbook acknowledgment</p>
        </div>

        {!rec ? (
          <Panel>
            <h2 className="text-lg font-semibold text-slate-900">Link not found</h2>
            <p className="mt-1 text-sm text-slate-600">This acknowledgment link is not valid or has expired. Please contact HR for a new link.</p>
          </Panel>
        ) : rec.usedAt ? (
          <Panel>
            <div className="mx-auto mb-3 grid h-12 w-12 place-items-center rounded-full bg-emerald-100 text-emerald-700">
              <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><path d="M20 6L9 17l-5-5" /></svg>
            </div>
            <h2 className="text-lg font-semibold text-slate-900 text-center">Already acknowledged</h2>
            <p className="mt-1 text-sm text-slate-600 text-center">This handbook acknowledgment was completed on {D(rec.usedAt)}. No further action is needed. You can close this page.</p>
          </Panel>
        ) : (
          <Panel>
            <div className="text-xs uppercase tracking-wider text-slate-500">{rec.document.effective ?? "Employee Handbook"}</div>
            <h2 className="mt-1 text-lg font-semibold text-slate-900">{rec.document.title}</h2>
            {rec.name ? <p className="text-sm text-slate-500">For {rec.name}</p> : null}
            <p className="mt-2 text-sm text-slate-600">Please read the handbook below, then type your full name at the bottom to acknowledge that you have read and received it.</p>

            <div className="mt-4 max-h-[55vh] overflow-y-auto rounded-lg border border-slate-200 bg-white p-4">
              <Markdown className="max-w-none">{rec.document.body}</Markdown>
            </div>

            <div className="mt-4">
              <HandbookAckClient token={token} version={rec.document.version} defaultName={rec.name ?? ""} />
            </div>
          </Panel>
        )}
      </div>
    </div>
  );
}

function Panel({ children }: { children: React.ReactNode }) {
  return <div className="rounded-2xl border border-white/10 bg-white/95 p-5 shadow-xl">{children}</div>;
}
