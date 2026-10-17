import Link from "next/link";
import { Card } from "@/components/ui";
import ClearReminderButton from "@/components/ClearReminderButton";
import { branchLabel } from "@/lib/management";
import type { AttentionItem, AttentionSeverity } from "@/lib/needs-attention";

// Shared "Needs attention" list renderer for the list-style command centers
// (inventory dashboard, executive). Every role's queue is built the SAME way —
// from the unified `lib/needs-attention.ts` model — and dismissible items carry
// the keyed `ReminderDismissal` Clear affordance consistently. Brand kit: thin
// line dots, light canvas, no emoji.

const DOT: Record<AttentionSeverity, string> = {
  critical: "bg-red-500",
  warning: "bg-amber-500",
  info: "bg-brand-400",
};

export default function NeedsAttentionList({
  items,
  title = "Needs attention",
  showBranch = false,
  emptyText = "Nothing outstanding — you're all caught up.",
  limit = 12,
  className = "",
}: {
  items: AttentionItem[];
  title?: string;
  showBranch?: boolean;
  emptyText?: string;
  limit?: number;
  className?: string;
}) {
  return (
    <Card className={`p-0 overflow-hidden ${className}`} id="needs-attention">
      <div className="flex items-center justify-between gap-2 border-b border-line px-4 py-3">
        <div className="text-sm font-medium text-ink">{title}</div>
        <span className="text-xs text-muted">{items.length} item{items.length === 1 ? "" : "s"}</span>
      </div>
      {items.length === 0 ? (
        <p className="px-4 py-8 text-center text-sm text-muted">{emptyText}</p>
      ) : (
        <ul className="divide-y divide-line">
          {items.slice(0, limit).map((r) => (
            <li key={r.key} className="flex items-start gap-2 pr-3">
              <Link href={r.href} className="flex flex-1 items-start gap-3 px-4 py-3 hover:bg-black/[0.02]">
                <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${DOT[r.severity]}`} />
                <span className="flex-1">
                  <span className="block text-sm font-medium text-ink">
                    {r.count && r.count > 1 ? <span className="mr-1.5 tabular-nums text-muted">{r.count}</span> : null}
                    {r.title}
                    {showBranch && r.branch ? <span className="ml-2 text-[11px] font-normal text-muted">{branchLabel(r.branch)}</span> : null}
                  </span>
                  {r.detail ? <span className="block text-xs text-muted">{r.detail}</span> : null}
                  {r.chips && r.chips.length > 0 ? (
                    <span className="mt-1.5 flex flex-wrap gap-1.5">
                      {r.chips.map((c, i) => (
                        <span key={`${c.label}-${i}`} className="rounded-full bg-black/[0.04] px-2 py-0.5 text-[11px] font-medium text-muted">{c.label}</span>
                      ))}
                    </span>
                  ) : null}
                </span>
              </Link>
              {r.dismissible ? (
                <div className="shrink-0 self-center">
                  <ClearReminderButton reminderKey={r.key} branch={r.branch} />
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
