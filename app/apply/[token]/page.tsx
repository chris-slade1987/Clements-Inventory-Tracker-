import Link from "next/link";
import { jobByApplyToken, sourceFromChannel } from "@/lib/ats";
import { branchLabel } from "@/lib/management";
import ApplyForm from "./ApplyForm";

export const dynamic = "force-dynamic";
export const metadata = { title: "Apply — Clements Pest Control" };

// PUBLIC — no login, no AppShell. The per-job application "front door" an Indeed,
// LinkedIn ad, or the company careers page links to. `?src=` tags the channel so
// the Candidate's source is recorded accurately. Designed to feel like a
// world-class careers experience — brand hero, clear process, trust signals.
export default async function ApplyPage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ src?: string }>;
}) {
  const { token } = await params;
  const { src } = await searchParams;
  const job = await jobByApplyToken(token);
  const open = job && job.status === "open";

  if (!open) {
    return (
      <Shell>
        <div className="mx-auto max-w-2xl px-5 py-16 sm:py-24">
          <div className="rounded-3xl border border-slate-200 bg-white p-8 text-center shadow-sm sm:p-10">
            <div className="mx-auto mb-5 grid h-14 w-14 place-items-center rounded-full bg-slate-100 text-slate-500">
              <svg viewBox="0 0 24 24" className="h-7 w-7" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round"><path d="M18 6L6 18M6 6l12 12" /></svg>
            </div>
            <h1 className="text-2xl font-semibold tracking-tight text-slate-900">This position is no longer accepting applications</h1>
            <p className="mt-3 text-slate-600">
              Thanks for your interest in Clements Pest Control. This role may have been filled or closed — but we&rsquo;re often hiring across the Treasure Coast and Central Florida.
            </p>
            <div className="mt-7">
              <Link href="/careers" className="inline-flex items-center gap-2 rounded-xl bg-emerald-grad px-6 py-3 text-sm font-semibold text-[#05271c] shadow-sm transition hover:brightness-95">
                See open positions
                <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14M13 6l6 6-6 6" /></svg>
              </Link>
            </div>
          </div>
        </div>
      </Shell>
    );
  }

  return (
    <Shell>
      <Hero title={job!.title} branch={job!.branch} openings={job!.openings} />

      <main className="relative mx-auto -mt-12 max-w-6xl px-5 pb-16 sm:-mt-16">
        <div className="grid gap-6 lg:grid-cols-5 lg:gap-8">
          {/* Application card */}
          <div className="lg:col-span-3">
            <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-xl shadow-emerald-900/5 sm:p-8">
              <div className="flex items-center gap-2 text-emerald-700">
                <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round"><path d="M9 11l3 3 8-8M20 4v7m0 0h-7M4 20h6M4 16h10M4 12h4" /></svg>
                <span className="text-xs font-semibold uppercase tracking-[0.12em]">Application</span>
              </div>
              <h2 className="mt-2 text-2xl font-semibold tracking-tight text-slate-900">Apply in about two minutes</h2>
              <p className="mt-1.5 text-sm text-slate-500">Tell us how to reach you and attach your résumé — that&rsquo;s all we need to get started.</p>
              <div className="mt-6">
                <ApplyForm token={token} src={sourceFromChannel(src)} jobTitle={job!.title} />
              </div>
            </div>
          </div>

          {/* Right rail: about, benefits, process */}
          <div className="space-y-6 lg:col-span-2">
            {job!.description ? (
              <RailCard eyebrow="About the role">
                <p className="whitespace-pre-line text-sm leading-relaxed text-slate-600">{job!.description}</p>
              </RailCard>
            ) : null}

            <RailCard eyebrow="Why build your career here">
              <ul className="space-y-3">
                {BENEFITS.map((b) => (
                  <li key={b.title} className="flex gap-3">
                    <span className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-emerald-50 text-emerald-700">
                      <svg viewBox="0 0 24 24" className="h-4.5 w-4.5 h-[18px] w-[18px]" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round"><path d={b.icon} /></svg>
                    </span>
                    <span>
                      <span className="block text-sm font-semibold text-slate-800">{b.title}</span>
                      <span className="block text-sm leading-relaxed text-slate-500">{b.body}</span>
                    </span>
                  </li>
                ))}
              </ul>
            </RailCard>

            <RailCard eyebrow="What happens next">
              <ol className="relative space-y-5 before:absolute before:left-[11px] before:top-1 before:h-[calc(100%-1.5rem)] before:w-px before:bg-emerald-100">
                {PROCESS.map((step, i) => (
                  <li key={step.title} className="relative flex gap-3.5">
                    <span className="z-10 grid h-6 w-6 shrink-0 place-items-center rounded-full bg-emerald-grad text-[11px] font-bold text-[#05271c] ring-4 ring-white">{i + 1}</span>
                    <span>
                      <span className="block text-sm font-semibold text-slate-800">{step.title}</span>
                      <span className="block text-sm leading-relaxed text-slate-500">{step.body}</span>
                    </span>
                  </li>
                ))}
              </ol>
            </RailCard>
          </div>
        </div>
      </main>
    </Shell>
  );
}

const BENEFITS = [
  { title: "Family-owned & established", body: "A Florida leader in pest control, trusted across the Treasure Coast and Central Florida.", icon: "M3 21h18M5 21V7l7-4 7 4v14M9 21v-6h6v6" },
  { title: "Real training & growth", body: "We invest in licensing, mentorship, and a clear path to advance.", icon: "M22 10L12 5 2 10l10 5 10-5zM6 12v5c0 1 2.7 3 6 3s6-2 6-3v-5" },
  { title: "Company vehicle & benefits", body: "Take-home truck, competitive pay, and a full benefits package.", icon: "M3 13l2-5a2 2 0 012-1.4h10A2 2 0 0116 8l2 5M5 13h14v4H5zM7 17v2M17 17v2" },
  { title: "A team that has your back", body: "Supportive branch managers and crews who look out for each other.", icon: "M17 21v-2a4 4 0 00-4-4H7a4 4 0 00-4 4v2M10 11a4 4 0 100-8 4 4 0 000 8zM21 21v-2a4 4 0 00-3-3.87" },
];

const PROCESS = [
  { title: "We review your application", body: "Our hiring team looks at every résumé that comes in." },
  { title: "Quick phone screen", body: "A short call to get to know you and answer your questions." },
  { title: "In-person interview", body: "Meet the branch team and talk through your experience." },
  { title: "Offer & onboarding", body: "Background/drug screening, then welcome to Clements." },
];

function Hero({ title, branch, openings }: { title: string; branch: string | null; openings: number }) {
  return (
    <section className="relative overflow-hidden bg-forest-grad">
      {/* soft brand watermark */}
      <img src="/clements-mark.svg" alt="" aria-hidden className="pointer-events-none absolute -right-10 -top-8 h-72 w-72 opacity-[0.06] sm:h-96 sm:w-96" />
      <div className="mx-auto max-w-6xl px-5 pb-24 pt-12 sm:pb-28 sm:pt-16">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-mint">
          Now hiring{branch ? ` · ${branchLabel(branch)}` : ""}
        </p>
        <h1 className="mt-3 max-w-3xl text-3xl font-semibold leading-[1.08] tracking-tight text-white sm:text-5xl">{title}</h1>
        <p className="mt-4 max-w-xl text-[15px] leading-relaxed text-mint sm:text-base">
          Join a family-owned team that invests in its people — real training, clear growth, and the tools to do the job right. Apply below; it only takes a couple of minutes.
        </p>
        <div className="mt-6 flex flex-wrap items-center gap-2">
          {branch ? <HeroPill>{branchLabel(branch)}</HeroPill> : null}
          <HeroPill>Full-time</HeroPill>
          <HeroPill>{openings} opening{openings === 1 ? "" : "s"}</HeroPill>
          <HeroPill>Company vehicle</HeroPill>
        </div>
      </div>
    </section>
  );
}

function HeroPill({ children }: { children: React.ReactNode }) {
  return (
    <span className="rounded-full border border-white/15 bg-white/10 px-3.5 py-1.5 text-sm font-medium text-white backdrop-blur-sm">
      {children}
    </span>
  );
}

function RailCard({ eyebrow, children }: { eyebrow: string; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
      <h3 className="mb-4 text-xs font-semibold uppercase tracking-[0.12em] text-emerald-700">{eyebrow}</h3>
      {children}
    </div>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col bg-slate-50 text-slate-900">
      <header className="sticky top-0 z-20 border-b border-emerald-900/10 bg-forest/95 backdrop-blur supports-[backdrop-filter]:bg-forest/80">
        <div className="mx-auto flex max-w-6xl items-center gap-3 px-5 py-3.5">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/clements-mark.svg" alt="Clements Pest Control" className="h-8 w-8" />
          <div className="leading-tight">
            <div className="text-sm font-semibold tracking-tight text-white">Clements Pest Control</div>
            <div className="text-[11px] text-mint">Careers</div>
          </div>
          <Link href="/careers" className="ml-auto text-sm font-medium text-mint transition hover:text-white">
            All openings →
          </Link>
        </div>
      </header>
      <div className="flex-1">{children}</div>
      <Assurance />
      <Footer />
    </div>
  );
}

function Assurance() {
  const items = [
    { label: "Family-owned", icon: "M3 21h18M5 21V7l7-4 7 4v14" },
    { label: "Licensed & insured", icon: "M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" },
    { label: "3 Florida branches", icon: "M12 21s-6-5.7-6-10a6 6 0 1112 0c0 4.3-6 10-6 10zM12 11a2 2 0 100-4 2 2 0 000 4z" },
    { label: "Equal Opportunity Employer", icon: "M20 6L9 17l-5-5" },
  ];
  return (
    <section className="border-t border-slate-200 bg-white">
      <div className="mx-auto grid max-w-6xl grid-cols-2 gap-4 px-5 py-6 sm:grid-cols-4">
        {items.map((it) => (
          <div key={it.label} className="flex items-center gap-2.5 text-slate-600">
            <svg viewBox="0 0 24 24" className="h-5 w-5 shrink-0 text-emerald-600" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round"><path d={it.icon} /></svg>
            <span className="text-sm font-medium">{it.label}</span>
          </div>
        ))}
      </div>
    </section>
  );
}

function Footer() {
  return (
    <footer className="bg-forest">
      <div className="mx-auto max-w-6xl px-5 py-6 text-center text-xs text-mint">
        © {new Date().getFullYear()} Clements Pest Control · Vero Beach · Stuart · Orlando · Equal Opportunity Employer
      </div>
    </footer>
  );
}
