import Link from "next/link";
import { Card, PageHeader, EmptyState } from "@/components/ui";
import { requireUser } from "@/lib/auth";
import { branchLabel } from "@/lib/management";
import { listPosts, authorQueue, calendarFeed, canPostBulletin, postTypeLabel, myAckedPostIds, pastCount, type CalendarItem } from "@/lib/bulletin";
import { NewPostButton, NewEventButton, PublishNow, DeletePostText, EditPostButton } from "./BulletinClient";
import Glyph from "@/components/Glyph";
import BulletinTile from "@/components/BulletinTile";

export const dynamic = "force-dynamic";
export const metadata = { title: "Company Bulletin — Clements Command & Control" };

const fmtDay = (d: Date) => d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
const fmtLong = (d: Date) => d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });

const KIND_STYLE: Record<string, { color: string; icon: string }> = {
  holiday: { color: "text-emerald-600", icon: "sun" },
  closure: { color: "text-red-600", icon: "lock" },
  early_release: { color: "text-amber-600", icon: "clock" },
  event: { color: "text-sky-600", icon: "calendar" },
  birthday: { color: "text-fuchsia-600", icon: "cake" },
  anniversary: { color: "text-violet-600", icon: "award" },
};

export default async function BulletinPage() {
  const user = await requireUser();
  const author = canPostBulletin(user);
  const [posts, calendar, queue, ackedIds, pastN] = await Promise.all([listPosts(), calendarFeed(60), author ? authorQueue() : Promise.resolve([]), myAckedPostIds(user.id), pastCount()]);

  const pinned = posts.filter((p) => p.pinned);
  const rest = posts.filter((p) => !p.pinned);

  return (
    <>
      <PageHeader
        title="Company Bulletin"
        subtitle="Stories, announcements, shoutouts & what's coming up across Clements"
        actions={
          <div className="flex flex-wrap items-center gap-3">
            <Link href="/bulletin/past" className="text-sm font-medium text-brand-300 hover:underline">Past bulletin{pastN > 0 ? ` (${pastN})` : ""} →</Link>
            {author ? <div className="flex gap-2"><NewEventButton /><NewPostButton /></div> : null}
          </div>
        }
      />

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Feed */}
        <div className="lg:col-span-2 space-y-5">
          {author && queue.length > 0 ? (
            <Card className="p-0 overflow-hidden ring-1 ring-amber-200">
              <div className="px-4 py-2.5 border-b border-line bg-black/[0.02] flex items-center justify-between">
                <div className="text-sm font-semibold text-ink">Drafts &amp; scheduled</div>
                <span className="text-[11px] text-muted">Only you and other authors see these</span>
              </div>
              <ul className="divide-y divide-line">
                {queue.map((q) => (
                  <li key={q.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3">
                    <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase ${q.scheduled ? "bg-sky-100 text-sky-800" : "bg-amber-100 text-amber-800"}`}>{q.scheduled ? "Scheduled" : "Draft"}</span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium text-ink">{q.title}</span>
                      <span className="block text-[11px] text-muted">
                        {postTypeLabel(q.type)}
                        {q.scheduled && q.publishAt ? ` · goes live ${fmtLong(q.publishAt)}` : " · not published"}
                      </span>
                    </span>
                    <span className="flex shrink-0 items-center gap-3">
                      <PublishNow id={q.id} />
                      <EditPostButton post={{ id: q.id, type: q.type, title: q.title, excerpt: q.excerpt, body: q.body, linkUrl: q.linkUrl, location: q.location, honoreeName: q.honoreeName, branch: q.branch, eventDate: q.eventDate ? q.eventDate.toISOString().slice(0, 10) : null, requireAck: q.requireAck, hasImage: q.hasImage }} />
                      <DeletePostText id={q.id} />
                    </span>
                  </li>
                ))}
              </ul>
            </Card>
          ) : null}

          {posts.length === 0 ? (
            <EmptyState title="Nothing posted yet" hint={author ? "Click “New post” to share the first story, announcement, or shoutout." : "Check back soon — culture stories and announcements will show up here."} />
          ) : (
            <>
              {pinned.length > 0 ? (
                <div className="grid gap-4 sm:grid-cols-2">
                  {pinned.map((p) => <BulletinTile key={p.id} p={p} author={author} needsAck={p.requireAck && !ackedIds.has(p.id)} featured />)}
                </div>
              ) : null}
              <div className="grid gap-4 sm:grid-cols-2">
                {rest.map((p) => <BulletinTile key={p.id} p={p} author={author} needsAck={p.requireAck && !ackedIds.has(p.id)} />)}
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

function CalendarRow({ it }: { it: CalendarItem }) {
  const st = KIND_STYLE[it.kind] ?? KIND_STYLE.event;
  return (
    <li className="flex items-start gap-3 px-4 py-2.5">
      <div className="w-12 shrink-0 text-center">
        <div className="text-[11px] font-semibold text-ink tabular-nums">{fmtDay(it.date)}</div>
      </div>
      <span className={`mt-0.5 shrink-0 ${st.color}`}><Glyph name={st.icon} className="h-4 w-4" /></span>
      <div className="min-w-0 flex-1">
        <div className="text-sm text-ink leading-snug">{it.title}</div>
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
