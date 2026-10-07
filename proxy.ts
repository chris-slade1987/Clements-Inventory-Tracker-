import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

// Coarse authentication backstop (defense in depth).
//
// Next 16 renamed the `middleware` file convention to `proxy` — this is that file.
// Real, fine-grained authorization still lives in each page/route (the (app)
// layout calls requireUser(), and pages apply their own role/branch guards). This
// proxy only enforces the *coarse* rule — "you must present a session cookie to
// reach an app page" — so a page that ever forgets its guard still can't be
// opened by a signed-out visitor. It intentionally does NOT validate the session
// (no DB access at the edge); an invalid/expired cookie passes here and is then
// rejected by requireUser() in the layout, which redirects to /login.
//
// API routes are excluded (they do their own per-route auth, and several are
// intentionally public: token sign pages, apply, cron, health), as are the
// public pages and static assets — see `config.matcher` below.

const SESSION_COOKIE = "cinv_session";

export function proxy(req: NextRequest) {
  const hasSession = req.cookies.has(SESSION_COOKIE);
  if (hasSession) {
    // Carry the pathname forward as a request header so the (app) layout — which
    // has DB access but can't see the URL — can enforce the forced-password-change
    // deadline for the page actually being requested. This does NOT change the
    // coarse "must have a cookie" rule below; signed-out visitors still redirect.
    const headers = new Headers(req.headers);
    headers.set("x-pathname", req.nextUrl.pathname);
    const res = NextResponse.next({ request: { headers } });
    // Authenticated responses are per-user — never let a browser/CDN reuse one
    // for a different signed-in account (that caused the wrong "Welcome <name>").
    res.headers.set("Cache-Control", "no-store, must-revalidate");
    return res;
  }

  const url = req.nextUrl.clone();
  url.pathname = "/login";
  // Preserve where they were headed so login can bounce them back.
  const dest = req.nextUrl.pathname + req.nextUrl.search;
  if (dest && dest !== "/") url.searchParams.set("next", dest);
  return NextResponse.redirect(url);
}

// Run on everything EXCEPT: api routes, Next internals, the public/unauthenticated
// pages (login + token capability pages + health), and static files (any path
// with a file extension). Everything left is an authenticated app page.
export const config = {
  matcher: [
    "/((?!api|_next/static|_next/image|login|apply|onboarding|sign|review-sign|scorecard-sign|health|manifest.webmanifest|sw.js|offline|robots.txt|sitemap.xml|favicon.ico|icons/|.*\\.).*)",
  ],
};
