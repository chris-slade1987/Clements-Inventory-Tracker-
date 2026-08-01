import Link from "next/link";
import { PageHeader, EmptyState } from "@/components/ui";
import { requireUser } from "@/lib/auth";
import { listPosts, canPostBulletin, myAckedPostIds, ACTIVE_DAYS } from "@/lib/bulletin";
import BulletinTile from "@/components/BulletinTile";

export const dynamic = "force-dynamic";
export const metadata = { title: "Past Bulletin — CanopyOS" };

export default async function PastBulletinPage() {
  const user = await requireUser();
  const author = canPostBulletin(user);
  const [posts, ackedIds] = await Promise.all([listPosts({ scope: "past" }), myAckedPostIds(user.id)]);

  return (
    <>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <PageHeader title="Past bulletin" subtitle={`Archived posts — older than ${ACTIVE_DAYS} days`} />
        <Link href="/bulletin" className="text-sm font-medium text-brand-300 hover:underline">← Active bulletin</Link>
      </div>

      {posts.length === 0 ? (
        <EmptyState title="Nothing archived yet" hint={`Posts move here automatically ${ACTIVE_DAYS} days after they're posted. Featured posts and upcoming events stay on the active board.`} />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {posts.map((p) => (
            <BulletinTile key={p.id} p={p} author={author} needsAck={p.requireAck && !ackedIds.has(p.id)} />
          ))}
        </div>
      )}
    </>
  );
}
