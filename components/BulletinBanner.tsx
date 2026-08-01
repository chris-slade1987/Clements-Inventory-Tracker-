import Link from "next/link";
import { listPosts, pendingAckCount } from "@/lib/bulletin";
import { getSessionUser } from "@/lib/auth";
import Glyph from "@/components/Glyph";

// A "stay informed" banner + tile preview that links into the Company Bulletin.
// Dropped on the tech and manager landing pages so the latest news greets people
// on login, without them having to hunt for the nav link.
export default async function BulletinBanner() {
  const user = await getSessionUser();
  const [posts, pending] = await Promise.all([listPosts({ limit: 3 }), user ? pendingAckCount(user.id) : Promise.resolve(0)]);
  const latest = posts[0];

  return (
    <Link href="/bulletin" className="group mb-5 block">
      <div className="relative overflow-hidden rounded-2xl border border-white/10 bg-forest-grad text-white shadow-lg shadow-black/10">
        <div className="flex items-center gap-4 p-4 sm:p-5">
          <div className="grid h-12 w-12 shrink-0 place-items-center rounded-xl bg-white/10 text-mint"><Glyph name="megaphone" className="h-6 w-6" /></div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <div className="text-[11px] font-semibold uppercase tracking-wider text-mint">Company Bulletin</div>
              {pending > 0 ? <span className="rounded-full bg-amber-400 px-2 py-0.5 text-[10px] font-semibold text-[#3a2a00]">{pending} need{pending === 1 ? "s" : ""} acknowledgment</span> : null}
            </div>
            <div className="font-semibold text-white">Stay informed on all the news</div>
            {latest ? (
              <div className="mt-0.5 truncate text-sm text-white/80"><span className="text-mint">Latest:</span> {latest.title}</div>
            ) : (
              <div className="mt-0.5 text-sm text-white/70">Stories, announcements, shoutouts &amp; upcoming events</div>
            )}
          </div>

          {/* Tile previews of the most recent posts (larger screens) */}
          {posts.length > 0 ? (
            <div className="hidden shrink-0 gap-2 lg:flex">
              {posts.slice(0, 2).map((p) => (
                <div key={p.id} className="relative h-14 w-24 overflow-hidden rounded-lg border border-white/15">
                  {p.hasImage ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={`/api/bulletin/post/${p.id}/image`} alt="" className="absolute inset-0 h-full w-full object-cover" />
                  ) : (
                    <div className="absolute inset-0 bg-gradient-to-br from-emerald-700 to-emerald-500" />
                  )}
                  <div className="absolute inset-0 bg-black/30" />
                  <div className="absolute inset-x-1 bottom-1 line-clamp-2 text-[9px] font-medium leading-tight text-white">{p.title}</div>
                </div>
              ))}
            </div>
          ) : null}

          <span className="shrink-0 rounded-lg bg-emerald-grad px-3 py-2 text-sm font-medium text-white transition group-hover:brightness-95">View →</span>
        </div>
      </div>
    </Link>
  );
}
