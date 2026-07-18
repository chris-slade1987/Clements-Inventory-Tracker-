import Link from "next/link";
import { PageHeader, Card, EmptyState } from "@/components/ui";
import { requireUser } from "@/lib/auth";
import { listThreadsForUser, participantSummary } from "@/lib/threads";
import ComposeThread from "@/components/ComposeThread";

export const dynamic = "force-dynamic";
export const metadata = { title: "Messages — Clements Command & Control" };

export default async function InboxPage() {
  const user = await requireUser();
  const threads = await listThreadsForUser(user.id);
  const unread = threads.filter((t) => t.unread).length;

  return (
    <>
      <PageHeader
        title="Messages"
        subtitle="Internal discussions with your team, HR, and management — kept inside the portal."
        actions={<ComposeThread variant="primary" label="+ New message" />}
      />

      {unread > 0 ? (
        <p className="mb-4 text-sm text-brand-700">
          {unread} unread {unread === 1 ? "discussion" : "discussions"}.
        </p>
      ) : null}

      {threads.length === 0 ? (
        <EmptyState
          title="No messages yet"
          hint="Start a discussion from here, or use the “Discuss” button next to a reminder or alert to loop in the right people."
        />
      ) : (
        <Card className="p-0 overflow-hidden">
          <ul className="divide-y divide-line">
            {threads.map((t) => (
              <li key={t.id}>
                <Link href={`/inbox/${t.id}`} className="flex items-start gap-3 px-4 py-3 hover:bg-black/[0.02]">
                  <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${t.unread ? "bg-red-500" : "bg-transparent"}`} />
                  <span className="flex-1 min-w-0">
                    <span className="flex items-center gap-2">
                      <span className={`block text-sm truncate ${t.unread ? "font-semibold text-ink" : "font-medium text-ink"}`}>{t.subject}</span>
                      {t.status === "resolved" ? <span className="shrink-0 rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-medium text-slate-500">Resolved</span> : null}
                    </span>
                    {t.contextLabel ? <span className="block text-[11px] text-brand-700">Re: {t.contextLabel}</span> : null}
                    <span className="block text-xs text-muted truncate">
                      <span className="text-slate-500">{t.lastAuthor}:</span> {t.lastMessage}
                    </span>
                    <span className="block text-[11px] text-muted mt-0.5">{participantSummary(t.participantNames)}</span>
                  </span>
                  <span className="shrink-0 text-[11px] text-muted mt-0.5">{t.updatedAt.toLocaleDateString()}</span>
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </>
  );
}
