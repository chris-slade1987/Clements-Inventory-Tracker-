import Link from "next/link";

// Branch Command — "Your weekly flow". Makes the manager's responsibilities and
// their order explicit: review THIS month's completion → address jobs left behind →
// sign the week → approve NEXT month's routing once it's posted. Each step shows its
// live state so a manager always knows what's done and what's next. Server component.

type StepState = "done" | "now" | "todo" | "muted";

export default function BranchCommandFlow({
  branch, monthLabel, hasProd, openLeftBehind, signed, routing,
}: {
  branch: string;
  monthLabel: string | null;
  hasProd: boolean;
  openLeftBehind: number;
  signed: boolean;
  routing: { loaded: boolean; signed: boolean; periodLabel: string; approved: number; techs: number; href: string };
}) {
  // Routing step state: not posted → muted; posted + unsigned → now (actionable);
  // signed → done.
  const routingState: StepState = !routing.loaded ? "muted" : routing.signed ? "done" : "now";

  const steps: { n: number; label: string; detail: string; state: StepState; cta?: { label: string; href: string } }[] = [
    {
      n: 1,
      label: `Review ${monthLabel ?? "this month"}'s completion`,
      detail: hasProd ? "Route completion, pacing & callbacks below" : "Upload this month's reports to begin",
      state: hasProd ? "done" : "now",
    },
    {
      n: 2,
      label: "Address jobs left behind",
      detail: openLeftBehind > 0 ? `${openLeftBehind} still open — plan or reschedule each` : "All addressed",
      state: !hasProd ? "muted" : openLeftBehind > 0 ? "now" : "done",
    },
    {
      n: 3,
      label: "Sign the week",
      detail: signed ? "Signed — locked as the record" : "Respond to every flag, then attest",
      state: signed ? "done" : !hasProd ? "muted" : openLeftBehind > 0 ? "todo" : "now",
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
      <div className="flex items-center justify-between">
        <div className="text-[11px] uppercase tracking-wide text-muted">Your weekly flow</div>
        <div className="text-[11px] text-muted">Current month → next month’s routing</div>
      </div>
      <ol className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {steps.map((s) => {
          const t = tone[s.state];
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
                <Link href={s.cta.href} className="mt-2 inline-block text-xs font-medium text-brand-700 hover:underline">{s.cta.label}</Link>
              ) : null}
            </li>
          );
        })}
      </ol>
    </div>
  );
}
