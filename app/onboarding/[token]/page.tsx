import { prisma } from "@/lib/prisma";
import { parseJson } from "@/lib/inspection";
import { PACKET_STEPS, isEditable, type Responses } from "@/lib/prehire";
import { getDocument, HANDBOOK_SLUG } from "@/lib/policy-docs";
import OnboardingWizard from "./OnboardingWizard";

export const dynamic = "force-dynamic";
export const metadata = { title: "Onboarding — Clements Pest Control" };

export default async function OnboardingPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const [pre, handbook] = await Promise.all([
    prisma.preHire.findUnique({ where: { token } }),
    getDocument(HANDBOOK_SLUG),
  ]);

  const invalid = !pre;
  const closed = pre && !isEditable(pre.status);

  return (
    <div className="min-h-screen bg-forest-grad px-4 py-8 sm:py-12 flex justify-center">
      <div className="w-full max-w-2xl">
        <div className="flex flex-col items-center mb-6">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/clements-mark.svg" alt="Clements" className="h-12 w-12" />
          <h1 className="mt-3 text-xl font-light tracking-tight text-white">Clements Pest Control</h1>
          <p className="text-sm text-mint">New-hire onboarding</p>
        </div>

        {invalid ? (
          <Panel>
            <h2 className="text-lg font-semibold text-slate-900">Link not found</h2>
            <p className="mt-1 text-sm text-slate-600">This onboarding link is not valid or has expired. Please contact the person at Clements who invited you, or reply to your invitation email.</p>
          </Panel>
        ) : closed ? (
          <Panel>
            <div className="mx-auto mb-3 grid h-12 w-12 place-items-center rounded-full bg-emerald-100 text-emerald-700">
              <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><path d="M20 6L9 17l-5-5" /></svg>
            </div>
            <h2 className="text-lg font-semibold text-slate-900 text-center">You&rsquo;re all set{pre!.name ? `, ${pre!.name.split(/\s+/)[0]}` : ""}</h2>
            <p className="mt-1 text-sm text-slate-600 text-center">Your onboarding has been submitted. Thanks — we&rsquo;ll be in touch about next steps. You can close this page.</p>
          </Panel>
        ) : (
          <OnboardingWizard
            token={token}
            candidateName={pre!.name}
            steps={PACKET_STEPS}
            initialResponses={parseJson<Responses>(pre!.responses, {})}
            initialStep={pre!.currentStep}
            handbookBody={handbook?.body}
            handbookVersion={handbook?.version}
          />
        )}
      </div>
    </div>
  );
}

function Panel({ children }: { children: React.ReactNode }) {
  return <div className="rounded-2xl border border-white/10 bg-white/95 p-5 shadow-xl">{children}</div>;
}
