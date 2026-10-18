import { redirect } from "next/navigation";
import { requireUser, homePath } from "@/lib/auth";
import { canManageAccessRights } from "@/lib/access";
import { PageHeader, Card, EmptyState } from "@/components/ui";
import { getCopilotInsights, type KnowledgeGap } from "@/lib/copilot/gaps";

// Copilot Insights — the super-admin view of the Canopy Copilot improvement loop
// (CanopyOS Theme 5, Wave D, plan §10). READ-ONLY. Self-guarded with
// canManageAccessRights (Chris, Julie, April), exactly like Settings & Admin →
// Access Rights and Data Connections. Shows usage at a glance plus the top
// knowledge gaps (ungrounded / thumbed-down question clusters) so leadership knows
// which SOP or manual section to write next. Brand-exact: forest/light,
// Helvetica Neue 300 (font-light), thin 1.6 line icons, no emoji.
export const dynamic = "force-dynamic";

const WINDOW_DAYS = 90;

function pct(v: number | null): string {
  return v == null ? "—" : `${Math.round(v * 100)}%`;
}

function relTime(d: Date): string {
  const diff = Date.now() - d.getTime();
  if (diff < 0) return "just now";
  const s = Math.floor(diff / 1000);
  if (s < 60) return "just now";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} min${m === 1 ? "" : "s"} ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} hour${h === 1 ? "" : "s"} ago`;
  const dd = Math.floor(h / 24);
  if (dd < 30) return `${dd} day${dd === 1 ? "" : "s"} ago`;
  const mo = Math.floor(dd / 30);
  return `${mo} month${mo === 1 ? "" : "s"} ago`;
}

function ReasonChip({ reason }: { reason: "ungrounded" | "thumbs_down" }) {
  const isDown = reason === "thumbs_down";
  const color = isDown ? "#DC2626" : "#E3B23C"; // danger / warning (brand semantic)
  const label = isDown ? "Marked not helpful" : "No company source";
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-medium"
      style={{ color, backgroundColor: `${color}1A`, border: `1px solid ${color}33` }}
    >
      <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: color }} />
      {label}
    </span>
  );
}

function GapCard({ gap, rank }: { gap: KnowledgeGap; rank: number }) {
  return (
    <Card className="p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-brand-50 text-xs font-medium text-brand-700 tabular-nums">
              {rank}
            </span>
            <h3 className="truncate text-lg font-light text-ink">{gap.theme}</h3>
          </div>
          <p className="mt-1 text-xs text-muted">
            {gap.count} question{gap.count === 1 ? "" : "s"} fell short
            {gap.ungrounded > 0 ? ` · ${gap.ungrounded} without a company source` : ""}
            {gap.thumbsDown > 0 ? ` · ${gap.thumbsDown} marked not helpful` : ""}
          </p>
        </div>
        <span className="shrink-0 rounded-full bg-brand-50 px-2.5 py-1 text-sm font-medium text-brand-700 tabular-nums">
          {gap.count}
        </span>
      </div>

      <div className="mt-4 space-y-2.5 border-t border-line pt-3">
        <div className="text-[11px] font-semibold uppercase tracking-wider text-muted">Recent examples</div>
        <ul className="space-y-2.5">
          {gap.examples.map((ex, i) => (
            <li key={i} className="text-sm text-ink">
              <p className="leading-snug">&ldquo;{ex.question}&rdquo;</p>
              <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-muted">
                <ReasonChip reason={ex.reason} />
                {ex.screen ? <span>on {ex.screen}</span> : null}
                <span>· {relTime(ex.at)}</span>
              </div>
            </li>
          ))}
        </ul>
      </div>
    </Card>
  );
}

export default async function CopilotInsightsPage() {
  const user = await requireUser();
  if (!canManageAccessRights(user)) redirect(homePath(user));

  const { stats, gaps } = await getCopilotInsights({ windowDays: WINDOW_DAYS });

  const tiles: { label: string; value: string; hint?: string }[] = [
    { label: "Conversations", value: stats.conversations.toLocaleString(), hint: `last ${WINDOW_DAYS} days` },
    { label: "Questions asked", value: stats.questions.toLocaleString() },
    {
      label: "Thumbs-up rate",
      value: pct(stats.thumbsUpRate),
      hint: stats.thumbsUp + stats.thumbsDown > 0 ? `${stats.thumbsUp} up · ${stats.thumbsDown} down` : "no votes yet",
    },
    {
      label: "Answers grounded",
      value: pct(stats.groundedRate),
      hint: `${stats.groundedCount} of ${stats.answers} cited a source`,
    },
  ];

  const topGap = gaps[0];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Copilot Insights"
        subtitle="How Canopy Copilot is doing, and what to write next. Read-only — the questions it couldn't ground in company sources, and the answers people marked unhelpful, roll up into the knowledge gaps below."
      />

      {/* Usage at a glance */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {tiles.map((t) => (
          <Card key={t.label} className="p-4">
            <div className="text-xs text-muted">{t.label}</div>
            <div className="mt-2 text-2xl font-light text-ink tabular-nums">{t.value}</div>
            {t.hint ? <div className="mt-1 text-[11px] text-muted">{t.hint}</div> : null}
          </Card>
        ))}
      </div>

      {/* What to do nudge */}
      {topGap ? (
        <Card className="p-5">
          <div className="flex items-start gap-3">
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-brand-50 text-brand-600">
              <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M9 18h6M10 21h4M12 3a6 6 0 00-4 10.5c.6.6 1 1.4 1 2.5h6c0-1.1.4-1.9 1-2.5A6 6 0 0012 3z" />
              </svg>
            </span>
            <div className="min-w-0">
              <h2 className="text-lg font-light text-ink">What to do next</h2>
              <p className="mt-1 text-sm text-muted">
                The biggest gap right now is <span className="font-medium text-ink">{topGap.theme}</span> ({topGap.count} question{topGap.count === 1 ? "" : "s"}
                {" "}the Copilot couldn&rsquo;t answer well). Writing an SOP or adding a section to the Manager Operating Manual on this topic will let the
                Copilot answer it, with a citation, the next time someone asks. Published SOPs and manual updates are re-indexed automatically.
              </p>
            </div>
          </div>
        </Card>
      ) : null}

      {/* Top knowledge gaps */}
      <section className="space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-muted">Top knowledge gaps</h2>
        {gaps.length === 0 ? (
          <EmptyState
            title="No knowledge gaps yet"
            hint="When the Copilot can't ground an answer in the company's materials, or someone marks an answer unhelpful, the question clusters show up here to guide what to document next."
            icon={
              <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M9 11l3 3L22 4M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11" />
              </svg>
            }
          />
        ) : (
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            {gaps.map((g, i) => (
              <GapCard key={g.theme + i} gap={g} rank={i + 1} />
            ))}
          </div>
        )}
      </section>

      <p className="text-xs text-muted">
        Computed from the Copilot conversation log over the last {WINDOW_DAYS} days. The log is append-only and access-scoped — it stores only
        what already flowed through each user&rsquo;s own answer; personnel data is never logged here. Nothing on this page changes any system.
      </p>
    </div>
  );
}
