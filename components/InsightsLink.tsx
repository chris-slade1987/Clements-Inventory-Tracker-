import Link from "next/link";

// Consistent "Ask Insights" entry surfaced from every leadership dashboard
// (Company KPIs, Executive — Operating, Board — Financial statements). Links to
// the grounded AI Q&A at /management/insights. Thin 1.6 line glyph per the brand
// kit — no emoji. The caller is responsible for gating on Insights eligibility
// (admin or senior leadership).
export default function InsightsLink({ className = "" }: { className?: string }) {
  return (
    <Link
      href="/management/insights"
      className={`inline-flex items-center gap-1.5 rounded-xl border border-line bg-white px-3 py-2 text-sm font-medium text-ink hover:bg-[#eef5f0] transition-colors ${className}`}
    >
      <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M21 11.5a8 8 0 01-11.8 7L3 20l1.5-5.5A8 8 0 1121 11.5z" />
      </svg>
      Ask Insights
    </Link>
  );
}
