"use client";

import { useState } from "react";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { btn } from "@/components/ui";

// Routing sign-off responsibility modal. Opens when a manager reaches the Routes
// page from their "Complete {month} routing sign-off" to-do (deep-linked with
// ?signoff=1). It states, in plain language, what they must do and by when; a
// single "Start reviewing" button dismisses it and strips the param so a refresh
// doesn't re-open it. CanopyOS brand: forest-green chrome, Helvetica Neue 300,
// thin 1.6px line icon, no emoji.
export default function SignoffModal({
  open: initialOpen,
  monthLabel,
  deadlineLabel,
}: {
  open: boolean;
  monthLabel: string;
  deadlineLabel: string;
}) {
  const [open, setOpen] = useState(initialOpen);
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  function dismiss() {
    setOpen(false);
    // Drop ?signoff from the URL so a refresh / back doesn't re-trigger the modal,
    // keeping the branch + period the manager landed on.
    const params = new URLSearchParams(searchParams.toString());
    params.delete("signoff");
    const qs = params.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  }

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-0 sm:items-center sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="signoff-title"
    >
      <div className="surface-light w-full max-w-md space-y-4 rounded-t-2xl p-6 sm:rounded-2xl">
        <div className="flex items-start gap-3">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-brand-50 text-brand-700" aria-hidden="true">
            <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round">
              <path d="M9 11l3 3L22 4" />
              <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
            </svg>
          </span>
          <div>
            <h3 id="signoff-title" className="text-lg font-light text-ink">Sign off your {monthLabel} routes</h3>
            <p className="mt-0.5 text-xs text-muted">Monthly manager responsibility</p>
          </div>
        </div>

        <p className="text-sm text-ink">
          Review and sign off on every one of your routes for {monthLabel}. Open each route,
          confirm it is correct, and approve it for the month.
        </p>
        <p className="text-sm font-medium text-ink">
          All of your routes must be approved by {deadlineLabel}.
        </p>

        <div className="pt-1">
          <button type="button" onClick={dismiss} className={`${btn.primary} w-full`}>
            Start reviewing
          </button>
        </div>
      </div>
    </div>
  );
}
