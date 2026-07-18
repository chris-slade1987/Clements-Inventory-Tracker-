import Link from "next/link";
import { Card, PageHeader, EmptyState } from "@/components/ui";
import { requireUser } from "@/lib/auth";
import { branchLabel } from "@/lib/management";
import { listPosts, calendarFeed, canPostBulletin, postTypeLabel, type BulletinTile, type CalendarItem } from "@/lib/bulletin";
import { NewPostButton, NewEventButton, DeletePost, PinPost } from "./BulletinClient";

export const dynamic = "force-dynamic";
export const metadata = { title: "Company Bulletin — Clements Command & Control" };

const fmtDay = (d: Date) => d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
const fmtLong = (d: Date) => d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });

// Type → tile accent (gradient used when there's no photo) + chip color.
const ACCENT: Record<string, { grad: string; chip: string }> = {
  story: { grad: "from-emerald-800 to-emerald-600", chip: "bg-emerald-100 text-emerald-800" },
  announcement: { grad: "from-amber-800 to-amber-600", chip: "bg-amber-100 text-amber-800" },
  shoutout: { grad: "from-fuchsia-800 to-violet-600", chip: "bg-violet-100 text-violet-800" },
  event: { grad: "from-sky-800 to-cyan-600", chip: "bg-sky-100 text-sky-800" },
};

const KIND_STYLE: Record<string, { dot: string; icon: string }> = {
  holiday: { dot: "bg-emerald-500", icon: "🏖️" },
  closure: { dot: "bg-red-500", icon: "🔒" },
  early_release: { dot: "bg-amber-500", icon: "⏰" },
  event: { dot: "bg-sky-500", icon: "📅" },
  birthday: { dot: "bg-fuchsia-500", icon: "🎂" },
  anniversary: { dot: "bg-violet-500", icon: "🎉" },
};

export default async function BulletinPage() {
  const user = await requireUser();
  const author = canPostBulletin(user);
  const [posts, calendar] = await Promise.all([listPosts(), calendarFeed(60)]);

  const pinned = posts.filter((p) => p.pinned);
  const rest = posts.filter((p) => !p.pinned);

  return (
    <>
      <PageHeader
        title="Company Bulletin"
        subtitle="Stories, announcements, shoutouts & what's coming up across Clements"
        actions={author ? <div className="flex gap-2"><NewEventButton /><NewPostButton /></div> : undefined}
      />

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Feed */}
        <div className="lg:col-span-2 space-y-5">
          {posts.length === 0 ? (
            <EmptyState title="Nothing posted yet" hint={author ? "Click “New post” to share the first story, announcement, or shoutout." : "Check back soon — culture stories and announcements will show up here."} />
          ) : (
            <>
              {pinned.length > 0 ? (
                <div className="grid gap-4 sm:grid-cols-2">
                  {pinned.map((p) => <Tile key={p.id} p={p} author={author} featured />)}
                </div>
              ) : null}
              <div className="grid gap-4 sm:grid-cols-2">
                {rest.map((p) => <Tile key={p.id} p={p} author={author} />)}
              </div>
            </>
          )}
        </div>

        {/* Cascading company calendar */}
        <div className="lg:col-span-1">
          <Card className="p-0 overflow-hidden lg:sticky lg:top-4">
            <div className="px-4 py-3 border-b border-line flex items-center justify-between">
              <div className="text-sm font-semibold text-ink">Company calendar</div>
              <span className="text-[11px] text-muted">next 60 days</span>
            </div>
            {calendar.length === 0 ? (
              <p className="px-4 py-8 text-center text-sm text-muted">No upcoming events, birthdays, or anniversaries yet.{author ? " Add one with “Event”." : ""}</p>
            ) : (
              <ul className="divide-y divide-line max-h-[70vh] overflow-y-auto">
                {calendar.map((it) => <CalendarRow key={`${it.source}-${it.id}`} it={it} />)}
              </ul>
            )}
            <div className="px-4 py-2 border-t border-line text-[11px] text-muted">
              Birthdays &amp; anniversaries populate from employee profiles — filling in from HR soon.
            </div>
          </Card>
        </div>
      </div>
    </>
  );
}

function Tile({ p, author, featured = false }: { p: BulletinTile; author: boolean; featured?: boolean }) {
  const accent = ACCENT[p.type] ?? ACCENT.story;
  const href = p.linkUrl || `/bulletin/${p.id}`;
  const external = !!p.linkUrl;
  const inner = (
    <>
      {/* Background: photo if present, else a type-colored gradient */}
      {p.hasImage ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={`/api/bulletin/post/${p.id}/image`} alt={p.imageAlt ?? ""} className="absolute inset-0 h-full w-full object-cover transition-transform duration-500 group-hover:scale-105" />
      ) : (
        <div className={`absolute inset-0 bg-gradient-to-br ${accent.grad} transition-transform duration-500 group-hover:scale-105`} />
      )}
      <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/35 to-transparent" />

      {/* Top chips */}
      <div className="absolute left-3 top-3 flex items-center gap-2">
        <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${accent.chip}`}>{postTypeLabel(p.type)}</span>
        {p.pinned ? <span className="rounded-full bg-white/90 px-2 py-0.5 text-[10px] font-semibold text-ink">★ Featured</span> : null}
        {external ? <span className="rounded-full bg-white/85 px-2 py-0.5 text-[10px] font-semibold text-ink">↗ Link</span> : null}
      </div>

      {/* Bottom text */}
      <div className="absolute inset-x-0 bottom-0 p-4">
        {p.eventDate ? <div className="mb-1 text-[11px] font-medium text-white/90">{fmtLong(p.eventDate)}{p.location ? ` · ${p.location}` : ""}</div> : null}
        <h3 className={`font-semibold text-white text-balance ${featured ? "text-xl" : "text-lg"} leading-snug`}>{p.title}</h3>
        {p.excerpt ? <p className="mt-1 text-sm text-white/85 line-clamp-2">{p.excerpt}</p> : null}
        <div className="mt-2 flex items-center gap-2 text-[11px] text-white/70">
          {p.honoreeName ? <span>👏 {p.honoreeName}</span> : null}
          {p.branch ? <span>{branchLabel(p.branch)}</span> : null}
          {p.authorName ? <span>· {p.authorName}</span> : null}
        </div>
      </div>
    </>
  );

  return (
    <div className={`group relative overflow-hidden rounded-2xl border border-line shadow-lg shadow-black/10 ${featured ? "min-h-[16rem] sm:min-h-[18rem]" : "min-h-[13rem]"}`}>
      {external ? (
        <a href={href} target="_blank" rel="noopener noreferrer" className="absolute inset-0 z-10" aria-label={p.title} />
      ) : (
        <Link href={href} className="absolute inset-0 z-10" aria-label={p.title} />
      )}
      {inner}
      {author ? (
        <div className="absolute right-2 top-2 z-20 flex gap-1">
          <PinPost id={p.id} pinned={p.pinned} />
          <DeletePost id={p.id} />
        </div>
      ) : null}
    </div>
  );
}

function CalendarRow({ it }: { it: CalendarItem }) {
  const st = KIND_STYLE[it.kind] ?? KIND_STYLE.event;
  return (
    <li className="flex items-start gap-3 px-4 py-2.5">
      <div className="w-12 shrink-0 text-center">
        <div className="text-[11px] font-semibold text-ink tabular-nums">{fmtDay(it.date)}</div>
      </div>
      <span className={`mt-1 h-2 w-2 shrink-0 rounded-full ${st.dot}`} />
      <div className="min-w-0 flex-1">
        <div className="text-sm text-ink leading-snug">{st.icon} {it.title}</div>
        <div className="text-[11px] text-muted">
          {it.kind === "birthday" || it.kind === "anniversary" ? "" : it.kind.replace("_", " ")}
          {it.timeLabel ? ` · ${it.timeLabel}` : ""}
          {it.branch ? `${it.kind === "birthday" || it.kind === "anniversary" ? "" : " · "}${branchLabel(it.branch)}` : ""}
          {it.endDate ? ` – ${fmtDay(it.endDate)}` : ""}
        </div>
      </div>
    </li>
  );
}
