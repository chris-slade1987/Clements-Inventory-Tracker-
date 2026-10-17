"use client";

// Branded error boundary for authenticated screens. Rendered inside the (app)
// shell (nav stays), so a thrown error in any page becomes a calm recovery card
// instead of an unstyled, path-less dead-end. Offers a retry (reset) + home link.

import { useEffect } from "react";
import { btn } from "@/components/ui";

export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Surface to the console for diagnostics; the digest ties it to server logs.
    console.error(error);
  }, [error]);

  return (
    <div className="mx-auto max-w-md py-10 text-center">
      <div className="mx-auto mb-4 grid h-12 w-12 place-items-center rounded-full bg-brand-50 text-brand-600">
        <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M12 9v4m0 4h.01M10.3 3.9L2.4 18a2 2 0 001.7 3h15.8a2 2 0 001.7-3L13.7 3.9a2 2 0 00-3.4 0z" />
        </svg>
      </div>
      <h1 className="text-2xl font-light tracking-tight text-ink">Something went wrong</h1>
      <p className="mt-2 text-sm text-muted">
        We hit a snag loading this screen. Try again, or head back to your home.
      </p>
      {error.digest ? (
        <p className="mt-2 text-[11px] text-muted/80">Reference: {error.digest}</p>
      ) : null}
      <div className="mt-6 flex items-center justify-center gap-3">
        <button type="button" onClick={reset} className={btn.primary}>
          <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M4 4v6h6M20 20v-6h-6M20 8a8 8 0 00-14.9-2M4 16a8 8 0 0014.9 2" />
          </svg>
          Try again
        </button>
        <a href="/" className={btn.secondary}>
          Go home
        </a>
      </div>
    </div>
  );
}
