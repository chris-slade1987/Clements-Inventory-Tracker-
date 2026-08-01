import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { threadDetail } from "@/lib/threads";
import ThreadView from "./ThreadView";

export const dynamic = "force-dynamic";
export const metadata = { title: "Discussion — CanopyOS" };

export default async function ThreadPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireUser();
  const data = await threadDetail(id, user.id);
  if (!data) notFound();

  const { thread } = data;
  const messages = thread.messages.map((m) => ({
    id: m.id,
    authorName: m.authorName,
    body: m.body,
    createdAt: m.createdAt.toISOString(),
    mine: m.authorUserId === user.id,
  }));

  return (
    <>
      <div className="mb-4">
        <Link href="/inbox" className="text-sm text-brand-700 hover:underline">← All messages</Link>
      </div>
      <ThreadView
        id={thread.id}
        subject={thread.subject}
        status={thread.status}
        contextLabel={thread.contextLabel}
        contextHref={thread.contextHref}
        participants={thread.participants.map((p) => ({ name: p.name, isMe: p.userId === user.id, hasLogin: !!p.userId }))}
        messages={messages}
      />
    </>
  );
}
