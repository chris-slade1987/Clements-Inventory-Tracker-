"use client";

// Client reload button for the offline fallback. A plain anchor/button can't
// re-request the page, so this triggers a full reload when the user taps it.
export default function TryAgain() {
  return (
    <button
      type="button"
      onClick={() => window.location.reload()}
      className="inline-flex items-center justify-center gap-2 rounded-xl bg-emerald-grad px-5 py-2.5 text-sm font-medium text-white shadow-sm shadow-black/10 hover:brightness-110 active:brightness-95 transition-[filter] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400 focus-visible:ring-offset-2 focus-visible:ring-offset-[#0b3d20]"
    >
      <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M4 4v6h6M20 20v-6h-6M20 8a8 8 0 00-14.9-2M4 16a8 8 0 0014.9 2" />
      </svg>
      Try again
    </button>
  );
}
