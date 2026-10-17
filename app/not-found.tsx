// Root 404 for unmatched URLs (which never enter the (app) shell). Standalone,
// forest-branded, with the real wordmark and a way home — a signed-out visitor
// may land here, so it carries no authenticated nav.

import Link from "next/link";

export const metadata = { title: "Not found — CanopyOS" };

export default function RootNotFound() {
  return (
    <div className="min-h-screen grid place-items-center p-6 text-center bg-forest-grad">
      <div className="flex flex-col items-center">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/canopyos-wordmark.png" alt="CanopyOS" className="h-9 w-auto" />
        <h1 className="mt-6 text-lg font-light text-white">Page not found</h1>
        <p className="mt-1 text-sm text-mint max-w-xs">
          The page you&rsquo;re looking for may have moved or no longer exists.
        </p>
        <Link
          href="/"
          className="mt-5 inline-flex items-center justify-center gap-2 rounded-xl bg-emerald-grad px-5 py-2.5 text-sm font-medium text-white shadow-sm shadow-black/10 hover:brightness-110 active:brightness-95 transition-[filter] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400 focus-visible:ring-offset-2 focus-visible:ring-offset-[#0b3d20]"
        >
          Go home
        </Link>
      </div>
    </div>
  );
}
