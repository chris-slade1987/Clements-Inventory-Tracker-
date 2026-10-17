// Branded 404 for authenticated screens. Rendered inside the (app) shell (nav
// stays) so any notFound() across the portal lands on a styled page with a way
// out, not the bare Next.js default.

import Link from "next/link";
import { btn } from "@/components/ui";

export default function AppNotFound() {
  return (
    <div className="mx-auto max-w-md py-10 text-center">
      <div className="mx-auto mb-4 grid h-12 w-12 place-items-center rounded-full bg-brand-50 text-brand-600">
        <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <circle cx="11" cy="11" r="7" />
          <path d="M21 21l-4.3-4.3M11 8v3m0 3h.01" />
        </svg>
      </div>
      <h1 className="text-2xl font-light tracking-tight text-ink">We couldn&rsquo;t find that</h1>
      <p className="mt-2 text-sm text-muted">
        The page you&rsquo;re looking for may have moved or no longer exists.
      </p>
      <div className="mt-6 flex items-center justify-center gap-3">
        <Link href="/" className={btn.primary}>
          Go home
        </Link>
      </div>
    </div>
  );
}
