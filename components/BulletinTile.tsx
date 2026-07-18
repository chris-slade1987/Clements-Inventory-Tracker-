import Link from "next/link";
import { branchLabel } from "@/lib/management";
import { postTypeLabel, type BulletinTile as TileData } from "@/lib/bulletin";
import { PinPost, DeletePost } from "@/app/(app)/bulletin/BulletinClient";
import Glyph from "@/components/Glyph";

const fmtLong = (d: Date) => d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });

// Type → tile accent (gradient used when there's no photo) + chip color. All
// four sit in the site's forest/emerald family — a green→teal→cyan spread — so
// the board coordinates with the app ground while staying distinguishable.
export const ACCENT: Record<string, { grad: string; chip: string }> = {
  story: { grad: "from-emerald-900 to-emerald-600", chip: "bg-emerald-100 text-emerald-800" },
  announcement: { grad: "from-teal-900 to-teal-600", chip: "bg-teal-100 text-teal-800" },
  shoutout: { grad: "from-green-800 to-lime-600", chip: "bg-lime-100 text-lime-800" },
  event: { grad: "from-cyan-900 to-cyan-600", chip: "bg-cyan-100 text-cyan-800" },
};

export default function BulletinTile({ p, author, needsAck = false, featured = false }: { p: TileData; author: boolean; needsAck?: boolean; featured?: boolean }) {
  const accent = ACCENT[p.type] ?? ACCENT.story;
  const href = p.linkUrl || `/bulletin/${p.id}`;
  const external = !!p.linkUrl;
  const inner = (
    <>
      {p.hasImage ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={`/api/bulletin/post/${p.id}/image`} alt={p.imageAlt ?? ""} className="absolute inset-0 h-full w-full object-cover transition-transform duration-500 group-hover:scale-105" />
      ) : (
        <div className={`absolute inset-0 bg-gradient-to-br ${accent.grad} transition-transform duration-500 group-hover:scale-105`} />
      )}
      <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/35 to-transparent" />

      <div className="absolute left-3 top-3 flex items-center gap-2">
        <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${accent.chip}`}>{postTypeLabel(p.type)}</span>
        {p.pinned ? <span className="rounded-full bg-white/90 px-2 py-0.5 text-[10px] font-semibold text-ink">★ Featured</span> : null}
        {needsAck ? <span className="rounded-full bg-amber-400 px-2 py-0.5 text-[10px] font-semibold text-[#3a2a00]">Acknowledge</span> : null}
        {external ? <span className="rounded-full bg-white/85 px-2 py-0.5 text-[10px] font-semibold text-ink">↗ Link</span> : null}
      </div>

      <div className="absolute inset-x-0 bottom-0 p-4">
        {p.eventDate ? <div className="mb-1 text-[11px] font-medium text-white/90">{fmtLong(p.eventDate)}{p.location ? ` · ${p.location}` : ""}</div> : null}
        <h3 className={`font-semibold text-white text-balance ${featured ? "text-xl" : "text-lg"} leading-snug`}>{p.title}</h3>
        {p.excerpt ? <p className="mt-1 text-sm text-white/85 line-clamp-2">{p.excerpt}</p> : null}
        <div className="mt-2 flex items-center gap-2 text-[11px] text-white/70">
          {p.honoreeName ? <span className="inline-flex items-center gap-1"><Glyph name="star" className="h-3 w-3" /> {p.honoreeName}</span> : null}
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
