import Link from "next/link";

// Branch Command — "Your weekly flow". The guided playbook that makes the manager's
// responsibilities and their order explicit and drives them down the page: review THIS
// month's completion → address jobs left behind → sign the week → approve NEXT month's
// routing once it's posted. A live progress meter shows exactly what's left before the
// week can be signed, and every step jumps to the section where the work happens.
// Server component.

type StepState = "done" | "now" | "todo" | "muted";
type Count = { done: number; total: number };

export default function BranchCommandFlow({
  branch, monthLabel, hasProd, gate, progress, signed, routing,
}: {
  branch: string;
  monthLabel: string | null;
  hasProd: boolean;
  gate: { openFindings: number; unreviewedTechs: number; uncheckedItems: number; openLeftBehind?: number; canSign: boolean };
  progress: { checkoffs: Count; techs: Count; flags: Count; jobs: Count };
  signed: boolean;
  routing: { loaded: boolean; signed: boolean; periodLabel: string; approved: number; techs: number; href: string };
}) {
  const openLeftBehind = gate.openLeftBehind ?? 0;
  const routingState: StepState = !routing.loaded ? "muted" : routing.signed ? "done" : "now";

  // Sign step reflects the WHOLE gate (flags, tech review, checkoffs AND left-behind).
  const signBlockers: string[] = [];
  if (gate.openFindings) signBlockers.push(`${gate.openFindings} flag${gate.openFindings === 1 ? "" : "s"}`);
  if (gate.unreviewedTechs) signBlockers.push(`${gate.unreviewedTechs} tech${gate.unreviewedTechs === 1 ? "" : "s"}`);
  if (gate.uncheckedItems) signBlockers.push(`${gate.uncheckedItems} checkoff${gate.uncheckedItems === 1 ? "" : "s"}`);
  if (openLeftBehind) signBlockers.push(`${openLeftBehind} job${openLeftBehind === 1 ? "" : "s"} left behind`);
  const signState: StepState = signed ? "done" : !hasProd ? "muted" : gate.canSign ? "now" : "todo";
  const signDetail = signed
    ? "Signed — locked as the record"
    : signBlockers.length
      ? `Still open: ${signBlockers.join(" · ")}`
      : "Respond to every flag, then attest";

  const steps: { n: number; label: string; detail: string; state: StepState; cta?: { label: string; href: string } }[] = [
    {
      n: 1,
      label: `Review ${monthLabel ?? "this month"}'s completion`,
      detail: hasProd ? "Route completion, pacing & callbacks below" : "Upload this month's reports to begin",
      state: hasProd ? "done" : "now",
      cta: hasProd ? { label: "Review completion ↓", href: "#route-completion" } : undefined,
    },
    {
      n: 2,
      label: "Address jobs left behind",
      detail: openLeftBehind > 0 ? `${openLeftBehind} still open — plan or reschedule each` : "All addressed",
      state: !hasProd ? "muted" : openLeftBehind > 0 ? "now" : "done",
      cta: openLeftBehind > 0 ? { label: "Address jobs ↓", href: "#route-completion" } : undefined,
    },
    {
      n: 3,
      label: "Sign the week",
      detail: signDetail,
      state: signState,
      cta: signed ? undefined : { label: gate.canSign ? "Sign the week ↓" : "Go to sign-off ↓", href: "#sign" },
    },
    {
      n: 4,
      label: `Approve ${routing.periodLabel} routing`,
      detail: !routing.loaded
        ? "Not posted yet — you'll be prompted when it's uploaded"
        : routing.signed
          ? "Approved & signed"
          : `${routing.approved}/${routing.techs} techs approved — review & sign off`,
      state: routingState,
      cta: routing.loaded && !routing.signed ? { label: "Approve routing →", href: routing.href } : undefined,
    },
  ];

  const tone: Record<StepState, { ring: string; fill: string; text: string }> = {
    done: { ring: "border-brand-500", fill: "bg-brand-100 text-brand-700", text: "text-ink" },
    now: { ring: "border-amber-400", fill: "bg-amber-100 text-amber-700", text: "text-ink" },
    todo: { ring: "border-line", fill: "bg-black/[0.05] text-muted", text: "text-ink" },
    muted: { ring: "border-line", fill: "bg-black/[0.04] text-muted", text: "text-muted" },
  };

  return (
    <div className="rounded-xl border border-line bg-surface p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="text-[11px] uppercase tracking-wide text-muted">Your weekly flow</div>
        {hasProd && !signed ? (
          <div className="flex flex-wrap items-center gap-1.5">
            <Meter label="Checkoffs" c={progress.checkoffs} />
            <Meter label="Techs" c={progress.techs} />
            <Meter label="Flags" c={progress.flags} />
            <Meter label="Jobs" c={progress.jobs} />
          </div>
        ) : (
          <div className="text-[11px] text-muted">Current month → next month’s routing</div>
        )}
      </div>
      <ol className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {steps.map((s) => {
          const t = tone[s.state];
          const isHash = s.cta?.href.startsWith("#");
          return (
            <li key={s.n} className={`relative rounded-lg border ${t.ring} p-3`}>
              <div className="flex items-center gap-2">
                <span className={`grid h-6 w-6 shrink-0 place-items-center rounded-full text-xs font-medium ${t.fill}`}>
                  {s.state === "done" ? (
                    <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><path d="M5 13l4 4L19 7" /></svg>
                  ) : s.n}
                </span>
                <span className={`text-sm font-medium ${t.text}`}>{s.label}</span>
              </div>
              <p className="mt-1.5 text-xs text-muted">{s.detail}</p>
              {s.cta ? (
                isHash ? (
                  <a href={s.cta.href} className="mt-2 inline-block text-xs font-medium text-brand-700 hover:underline">{s.cta.label}</a>
                ) : (
                  <Link href={s.cta.href} className="mt-2 inline-block text-xs font-medium text-brand-700 hover:underline">{s.cta.label}</Link>
                )
              ) : null}
            </li>
          );
        })}
      </ol>
    </div>
  );
}

// A compact done/total chip — green when complete, amber while work remains.
function Meter({ label, c }: { label: string; c: Count }) {
  if (c.total === 0) return null;
  const done = c.done >= c.total;
  return (
    <span
      className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium tabular-nums"
      style={
        done
          ? { color: "#1F7A45", backgroundColor: "rgba(31,122,69,.08)", borderColor: "rgba(31,122,69,.3)" }
          : { color: "#8F6400", backgroundColor: "rgba(227,178,60,.12)", borderColor: "rgba(227,178,60,.4)" }
      }
    >
      {label} {c.done}/{c.total}
    </span>
  );
}
