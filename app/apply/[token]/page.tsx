import Link from "next/link";
import { jobByApplyToken, sourceFromChannel } from "@/lib/ats";
import { branchLabel } from "@/lib/management";
import ApplyForm from "./ApplyForm";

export const dynamic = "force-dynamic";
export const metadata = { title: "Apply — Clements Pest Control" };

// PUBLIC — no login, no AppShell. The per-job application "front door" an Indeed
// ad or the company careers page links to. `?src=` tags the channel so the
// Candidate's source is recorded accurately.
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

  return (
    <Shell>
      {!open ? (
        <Card>
          <div className="mx-auto mb-4 grid h-14 w-14 place-items-center rounded-full bg-slate-100 text-slate-500">
            <svg viewBox="0 0 24 24" className="h-7 w-7" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round"><path d="M18 6L6 18M6 6l12 12" /></svg>
          </div>
          <h1 className="text-center text-2xl font-semibold text-slate-900">This position is no longer accepting applications</h1>
          <p className="mt-2 text-center text-slate-600">
            Thanks for your interest in Clements Pest Control. This role may have been filled or closed.
            Please view our current openings to find another great fit.
          </p>
          <div className="mt-6 text-center">
            <Link href="/careers" className="inline-block rounded-xl bg-emerald-600 px-5 py-3 text-sm font-semibold text-white transition hover:bg-emerald-700">
              See open positions
            </Link>
          </div>
        </Card>
      ) : (
        <>
          <RoleHeader title={job!.title} branch={job!.branch} openings={job!.openings} />
          <div className="grid gap-6 lg:grid-cols-5">
            <div className="lg:col-span-3">
              <Card>
                <h2 className="text-xl font-semibold text-slate-900">Apply for this role</h2>
                <p className="mt-1 text-sm text-slate-500">It takes about two minutes. Fields marked below are required.</p>
                <div className="mt-5">
                  <ApplyForm token={token} src={sourceFromChannel(src)} jobTitle={job!.title} />
                </div>
              </Card>
            </div>
            <div className="lg:col-span-2 space-y-6">
              {job!.description ? (
                <Card>
                  <h3 className="text-sm font-semibold uppercase tracking-wide text-emerald-700">About the role</h3>
                  <p className="mt-2 whitespace-pre-line text-sm leading-relaxed text-slate-600">{job!.description}</p>
                </Card>
              ) : null}
              <WhyClements />
            </div>
          </div>
        </>
      )}
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-white text-slate-900">
      <header className="bg-forest-grad">
        <div className="mx-auto flex max-w-5xl items-center gap-3 px-5 py-5">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/clements-mark.svg" alt="Clements Pest Control" className="h-9 w-9" />
          <div>
            <div className="text-base font-semibold tracking-tight text-white">Clements Pest Control</div>
            <div className="text-xs text-mint">Careers</div>
          </div>
          <Link href="/careers" className="ml-auto text-sm font-medium text-mint transition hover:text-white">
            All openings →
          </Link>
        </div>
      </header>
      <main className="mx-auto max-w-5xl px-5 py-8 sm:py-10">{children}</main>
      <Footer />
    </div>
  );
}

function RoleHeader({ title, branch, openings }: { title: string; branch: string | null; openings: number }) {
  return (
    <div className="mb-7">
      <p className="text-sm font-semibold uppercase tracking-[0.14em] text-emerald-700">Join the Clements team</p>
      <h1 className="mt-1 text-3xl font-semibold tracking-tight text-slate-900 sm:text-4xl">{title}</h1>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        {branch ? <Pill>{branchLabel(branch)}</Pill> : null}
        <Pill>{openings} opening{openings === 1 ? "" : "s"}</Pill>
        <Pill>Full-time</Pill>
      </div>
    </div>
  );
}

function WhyClements() {
  const points = [
    "A family-owned Florida leader in pest control since our founding — trusted across the Treasure Coast.",
    "Real training, clear growth paths, and the tools to do the job right.",
    "Company vehicle, benefits, and a team that has your back.",
  ];
  return (
    <Card>
      <h3 className="text-sm font-semibold uppercase tracking-wide text-emerald-700">Why work at Clements</h3>
      <ul className="mt-3 space-y-2.5">
        {points.map((p) => (
          <li key={p} className="flex gap-2.5 text-sm leading-relaxed text-slate-600">
            <svg viewBox="0 0 24 24" className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round"><path d="M20 6L9 17l-5-5" /></svg>
            <span>{p}</span>
          </li>
        ))}
      </ul>
    </Card>
  );
}

function Pill({ children }: { children: React.ReactNode }) {
  return <span className="rounded-full bg-emerald-50 px-3 py-1 text-sm font-medium text-emerald-800 ring-1 ring-emerald-100">{children}</span>;
}

function Card({ children }: { children: React.ReactNode }) {
  return <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-7">{children}</div>;
}

function Footer() {
  return (
    <footer className="border-t border-slate-200 bg-slate-50">
      <div className="mx-auto max-w-5xl px-5 py-6 text-center text-xs text-slate-500">
        © {new Date().getFullYear()} Clements Pest Control · Vero Beach · Stuart · Orlando · Equal Opportunity Employer
      </div>
    </footer>
  );
}
