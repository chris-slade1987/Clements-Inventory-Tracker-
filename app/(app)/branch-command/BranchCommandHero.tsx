import Link from "next/link";
import type { CSSProperties } from "react";
import { branchLabel } from "@/lib/management";

// Branch Command — the command band. A forest "command deck" (brand chrome/content
// duality, same treatment as the Weather Ops deck) that puts the week's route
// completion, pacing, and sign-off state front and center the moment a manager lands.
// Server component — pure readout + links, no client state. See docs/BRANCH-COMMAND.md.

export type HeroTotals = {
  scheduled: number; completed: number; completionPct: number;
  leftBehind: number; leftBehindDollars: number; remaining: number;
  callbacks: number; netChange: number; netChangeDollars: number;
};
export type HeroGate = { openFindings: number; unreviewedTechs: number; uncheckedItems: number; openLeftBehind?: number; canSign: boolean };

const money = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;
// Completion ramp tuned to read on the forest band (lighter than the light-canvas ramp).
function compColor(pct: number): string {
  if (pct >= 98) return "#86EFAC";      // green-300
  if (pct >= 90) return "#BEF264";      // lime-300
  if (pct >= 80) return "#FDE68A";      // amber-200
  return "#FCA5A5";                     // red-300
}

export default function BranchCommandHero({
  branch, periodLabel, monthLabel, hasProd, totals, status, gate, signedName, signedAt, locked, branches,
}: {
  branch: string;
  periodLabel: string;
  monthLabel: string | null;
  hasProd: boolean;
  totals: HeroTotals;
  status: string;
  gate: HeroGate;
  signedName: string | null;
  signedAt: string | null;
  locked: boolean;
  branches: readonly string[];
}) {
  const signed = status === "signed";
  const blockers: string[] = [];
  if (gate.openFindings) blockers.push(`${gate.openFindings} flag${gate.openFindings === 1 ? "" : "s"} to explain`);
  if (gate.unreviewedTechs) blockers.push(`${gate.unreviewedTechs} tech${gate.unreviewedTechs === 1 ? "" : "s"} to review`);
  if (gate.uncheckedItems) blockers.push(`${gate.uncheckedItems} item${gate.uncheckedItems === 1 ? "" : "s"} to check off`);
  if (gate.openLeftBehind) blockers.push(`${gate.openLeftBehind} job${gate.openLeftBehind === 1 ? "" : "s"} left behind to address`);

  // Sign lamp — green when signed, amber when open with blockers, red when left-behind is open.
  const lampColor = signed ? "#86EFAC" : gate.openLeftBehind ? "#FCA5A5" : "#FDE68A";
  const compPct = hasProd ? totals.completionPct : 0;

  return (
    <section className="surface-dark bg-forest-grad relative overflow-hidden rounded-2xl">
      <div aria-hidden className="wx-grid pointer-events-none absolute inset-0 opacity-70" />
      <div className="relative p-5 sm:p-6">
        {/* Top strip: identity + branch switcher + sign lamp */}
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-[11px] uppercase tracking-[0.18em] text-muted">
              <span>Branch Command</span>
              <span aria-hidden>·</span>
              <span>{periodLabel}</span>
            </div>
            <h1 className="mt-1 text-2xl font-light tracking-tight text-ink sm:text-3xl">{branchLabel(branch)}</h1>
          </div>
          <div className="flex flex-col items-end gap-2">
            <div
              className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-medium ${signed ? "wx-lamp-live" : ""}`}
              style={{ borderColor: `${lampColor}66`, color: lampColor, "--wx-ring": `${lampColor}80` } as CSSProperties}
            >
              <span aria-hidden className="h-2 w-2 rounded-full" style={{ backgroundColor: lampColor }} />
              {signed ? "Signed" : blockers.length ? "Review open" : "Ready to sign"}
            </div>
            {!locked ? (
              <div className="flex flex-wrap justify-end gap-1">
                {branches.map((b) => (
                  <Link
                    key={b}
                    href={`/branch-command?branch=${b}`}
                    className={`rounded-lg border px-2.5 py-1 text-xs font-medium transition ${
                      b === branch ? "border-white/40 bg-white/10 text-ink" : "border-white/15 text-muted hover:bg-white/5"
                    }`}
                  >
                    {branchLabel(b)}
                  </Link>
                ))}
              </div>
            ) : null}
          </div>
        </div>

        {/* Headline readout */}
        {hasProd ? (
          <>
            <div className="mt-5 grid grid-cols-2 gap-x-4 gap-y-4 sm:grid-cols-3 lg:grid-cols-6">
              <div className="col-span-2 sm:col-span-1">
                <Readout label="Completion" value={`${compPct}%`} valueColor={compColor(compPct)} sub={`${totals.completed}/${totals.scheduled} stops`} />
                <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-white/10">
                  <div className="h-full rounded-full" style={{ width: `${Math.min(100, compPct)}%`, backgroundColor: compColor(compPct) }} />
                </div>
              </div>
              <Readout label="Left behind" value={String(totals.leftBehind)} valueColor={totals.leftBehind > 0 ? "#FCA5A5" : "#86EFAC"} sub={money(totals.leftBehindDollars)} />
              <Readout label="Remaining" value={String(totals.remaining)} sub="to run" />
              <Readout label="Callbacks" value={String(totals.callbacks)} valueColor={totals.callbacks > 0 ? "#FDE68A" : undefined} sub="this month" />
              <Readout label="Route net" value={`${totals.netChange >= 0 ? "+" : ""}${totals.netChange}`} valueColor={totals.netChangeDollars < 0 ? "#FCA5A5" : "#86EFAC"} sub={money(totals.netChangeDollars)} />
              <Readout label="Month" value={monthLabel ?? "—"} sub="period" small />
            </div>

            {/* Sign state / blockers */}
            <div className="mt-5 border-t border-white/10 pt-4">
              {signed ? (
                <p className="text-sm text-ink">
                  <span className="font-medium" style={{ color: "#86EFAC" }}>Signed</span>
                  {signedName ? ` by ${signedName}` : ""}{signedAt ? ` · ${new Date(signedAt).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "America/New_York" })}` : ""} — this week is locked as the record.
                </p>
              ) : blockers.length ? (
                <p className="text-sm text-muted">
                  <span className="text-ink">Before you can sign the week:</span> {blockers.join(" · ")}.
                </p>
              ) : (
                <p className="text-sm" style={{ color: "#86EFAC" }}>Everything’s reviewed — scroll to the bottom to sign off on the week.</p>
              )}
            </div>
          </>
        ) : (
          <div className="mt-5 border-t border-white/10 pt-4">
            <p className="text-sm text-ink">No production loaded for this branch yet.</p>
            <p className="mt-1 text-sm text-muted">
              Upload this month’s PestPac exports in <span className="text-ink">Route Completion</span> below (the Technician Schedule Report is the baseline) to light up completion, pacing, and jobs left behind.
            </p>
          </div>
        )}

        {/* Quick jumps */}
        <div className="mt-5 flex flex-wrap gap-2">
          <a href="#route-completion" className="rounded-lg border border-white/15 px-3 py-1.5 text-xs font-medium text-ink hover:bg-white/5">Route completion ↓</a>
          <a href="#flags" className="rounded-lg border border-white/15 px-3 py-1.5 text-xs font-medium text-ink hover:bg-white/5">Flags to explain ↓</a>
          <a href="#sign" className="rounded-lg border border-white/15 px-3 py-1.5 text-xs font-medium text-ink hover:bg-white/5">Sign the week ↓</a>
          <Link href={`/routing-approval?branch=${branch}`} className="rounded-lg border border-white/15 px-3 py-1.5 text-xs font-medium text-ink hover:bg-white/5">Routing Approval →</Link>
        </div>
      </div>
    </section>
  );
}

function Readout({ label, value, sub, valueColor, small }: { label: string; value: string; sub?: string; valueColor?: string; small?: boolean }) {
  return (
    <div className="min-w-0">
      <div className="text-[10px] uppercase tracking-[0.14em] text-muted">{label}</div>
      <div className={`mt-0.5 font-light tabular-nums ${small ? "text-lg" : "text-2xl"} truncate`} style={{ color: valueColor ?? undefined }} title={value}>
        {value}
      </div>
      {sub ? <div className="text-[11px] text-muted tabular-nums">{sub}</div> : null}
    </div>
  );
}
