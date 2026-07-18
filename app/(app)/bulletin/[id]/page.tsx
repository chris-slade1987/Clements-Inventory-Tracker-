import Link from "next/link";
import { notFound } from "next/navigation";
import { Card } from "@/components/ui";
import { requireUser } from "@/lib/auth";
import { branchLabel } from "@/lib/management";
import { postDetail, postTypeLabel, canPostBulletin } from "@/lib/bulletin";
import { EditPostButton } from "../BulletinClient";
import Glyph from "@/components/Glyph";

export const dynamic = "force-dynamic";

const fmt = (d: Date | null) => (d ? d.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric", timeZone: "UTC" }) : "");

const CHIP: Record<string, string> = {
  story: "bg-emerald-100 text-emerald-800",
  announcement: "bg-teal-100 text-teal-800",
  shoutout: "bg-lime-100 text-lime-800",
  event: "bg-cyan-100 text-cyan-800",
};

export default async function BulletinDetail({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await params;
  const post = await postDetail(id);
  const author = canPostBulletin(user);
  if (!post || (!post.published && !author)) notFound();

  return (
    <div className="mx-auto max-w-3xl">
      <Link href="/bulletin" className="text-sm text-brand-700 hover:underline">← Back to bulletin</Link>

      {!post.published ? (
        <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          {post.publishAt ? `Scheduled — goes live ${fmt(post.publishAt)}.` : "Draft — not published yet."} Only authors can see this preview.
        </div>
      ) : null}

      <Card className="mt-3 overflow-hidden">
        {post.imagePath ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={`/api/bulletin/post/${post.id}/image`} alt={post.imageAlt ?? ""} className="h-56 sm:h-72 w-full object-cover" />
        ) : (
          <div className="h-24 bg-emerald-grad" />
        )}
        <div className="p-5 sm:p-6">
          <div className="flex flex-wrap items-center gap-2">
            <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide ${CHIP[post.type] ?? CHIP.story}`}>{postTypeLabel(post.type)}</span>
            {post.pinned ? <span className="rounded-full bg-brand-100 px-2 py-0.5 text-[11px] font-semibold text-brand-700">★ Featured</span> : null}
            {post.branch ? <span className="text-[11px] text-muted">{branchLabel(post.branch)}</span> : null}
            {author ? <span className="ml-auto"><EditPostButton post={{ id: post.id, type: post.type, title: post.title, excerpt: post.excerpt, body: post.body, linkUrl: post.linkUrl, location: post.location, honoreeName: post.honoreeName, branch: post.branch, eventDate: post.eventDate ? post.eventDate.toISOString().slice(0, 10) : null }} /></span> : null}
          </div>

          <h1 className="mt-3 text-2xl sm:text-3xl font-light tracking-tight text-ink text-balance">{post.title}</h1>

          {post.eventDate ? (
            <div className="mt-2 inline-flex items-center gap-2 rounded-lg bg-cyan-50 px-3 py-1.5 text-sm text-cyan-800">
              <Glyph name="calendar" className="h-4 w-4" /> {fmt(post.eventDate)}{post.location ? ` · ${post.location}` : ""}
            </div>
          ) : null}
          {post.honoreeName ? <div className="mt-2 inline-flex items-center gap-1.5 text-sm text-violet-700"><Glyph name="star" className="h-4 w-4" /> Celebrating {post.honoreeName}</div> : null}

          {post.body ? (
            <div className="mt-4 whitespace-pre-wrap text-[15px] leading-relaxed text-ink/90">{post.body}</div>
          ) : post.excerpt ? (
            <p className="mt-4 text-[15px] leading-relaxed text-ink/90">{post.excerpt}</p>
          ) : null}

          {post.linkUrl ? (
            <a href={post.linkUrl} target="_blank" rel="noopener noreferrer" className="mt-4 inline-block text-sm font-medium text-brand-700 hover:underline">Read more ↗</a>
          ) : null}

          <div className="mt-6 border-t border-line pt-3 text-xs text-muted">
            {post.authorName ? `Posted by ${post.authorName}` : "Posted"} · {fmt(post.createdAt)}
          </div>
        </div>
      </Card>
    </div>
  );
}
