import Link from "next/link";
import { listOpenJobs } from "@/lib/ats";
import { branchLabel } from "@/lib/management";

export const dynamic = "force-dynamic";
export const metadata = {
  title: "Careers — Clements Pest Control",
  description: "Open positions at Clements Pest Control. Join a Florida leader in pest control.",
};

// PUBLIC — no login, no AppShell. The company careers page: every OPEN job with
// an Apply button linking to its per-job apply link (tagged ?src=website). The
// company can link to this from clementspestcontrol.com.
export default async function CareersPage() {
  const jobs = await listOpenJobs();

  return (
    <div className="min-h-screen bg-white text-slate-900">
      <header className="bg-forest-grad">
        <div className="mx-auto max-w-5xl px-5 py-5">
          <div className="flex items-center gap-3">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/clements-mark.svg" alt="Clements Pest Control" className="h-9 w-9" />
            <div>
              <div className="text-base font-semibold tracking-tight text-white">Clements Pest Control</div>
              <div className="text-xs text-mint">Careers</div>
            </div>
          </div>
          <div className="py-8 sm:py-12">
            <p className="text-sm font-semibold uppercase tracking-[0.14em] text-mint">We&rsquo;re hiring</p>
            <h1 className="mt-2 max-w-2xl text-3xl font-semibold leading-tight tracking-tight text-white sm:text-4xl">
              Build your career with a Florida leader in pest control
            </h1>
            <p className="mt-3 max-w-xl text-sm leading-relaxed text-mint sm:text-base">
              Join a family-owned team that invests in its people — real training, clear growth, and the tools to do the job right across the Treasure Coast and Central Florida.
            </p>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-5 py-8 sm:py-10">
        <h2 className="text-xl font-semibold text-slate-900">Open positions</h2>
        <p className="mt-1 text-sm text-slate-500">
          {jobs.length === 0 ? "No openings right now — please check back soon." : `${jobs.length} open role${jobs.length === 1 ? "" : "s"}.`}
        </p>

        {jobs.length > 0 ? (
          <ul className="mt-5 space-y-3">
            {jobs.map((j) => {
              const blurb = j.description ? j.description.replace(/\s+/g, " ").trim().slice(0, 160) : null;
              const href = j.applyToken ? `/apply/${j.applyToken}?src=website` : "#";
              return (
                <li key={j.id}>
                  <div className="flex flex-col gap-3 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm transition hover:border-emerald-300 sm:flex-row sm:items-center">
                    <div className="min-w-0 flex-1">
                      <h3 className="text-lg font-semibold text-slate-900">{j.title}</h3>
                      <div className="mt-1.5 flex flex-wrap items-center gap-2">
                        {j.branch ? <Pill>{branchLabel(j.branch)}</Pill> : null}
                        <Pill>{j.openings} opening{j.openings === 1 ? "" : "s"}</Pill>
                      </div>
                      {blurb ? <p className="mt-2 text-sm leading-relaxed text-slate-600">{blurb}{j.description && j.description.length > 160 ? "…" : ""}</p> : null}
                    </div>
                    <Link
                      href={href}
                      className="shrink-0 rounded-xl bg-emerald-600 px-5 py-3 text-center text-sm font-semibold text-white transition hover:bg-emerald-700"
                    >
                      Apply
                    </Link>
                  </div>
                </li>
              );
            })}
          </ul>
        ) : null}
      </main>

      <footer className="border-t border-slate-200 bg-slate-50">
        <div className="mx-auto max-w-5xl px-5 py-6 text-center text-xs text-slate-500">
          © {new Date().getFullYear()} Clements Pest Control · Vero Beach · Stuart · Orlando · Equal Opportunity Employer
        </div>
      </footer>
    </div>
  );
}

function Pill({ children }: { children: React.ReactNode }) {
  return <span className="rounded-full bg-emerald-50 px-3 py-1 text-xs font-medium text-emerald-800 ring-1 ring-emerald-100">{children}</span>;
}
