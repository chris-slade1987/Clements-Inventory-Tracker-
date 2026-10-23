"use client";

// Minimal print trigger for the read-only inspection report.
export default function PrintButton() {
  return (
    <button
      type="button"
      onClick={() => window.print()}
      className="rounded-lg border border-line px-3 py-1.5 text-xs font-medium text-ink hover:bg-black/5 print:hidden"
    >
      Print / Save PDF
    </button>
  );
}
