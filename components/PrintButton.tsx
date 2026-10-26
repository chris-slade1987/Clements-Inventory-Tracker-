"use client";

import { btn } from "@/components/ui";

// Reusable "Print / Save PDF" control for any completed digital form. Uses the
// browser's print dialog (→ "Save as PDF"); the global @media print rules in
// globals.css strip the app chrome so the form prints cleanly. Hidden in print.
export default function PrintButton({ label = "Print / Save PDF", variant = "secondary", className = "" }: { label?: string; variant?: "primary" | "secondary"; className?: string }) {
  return (
    <button type="button" onClick={() => window.print()} className={`${variant === "primary" ? btn.primary : btn.secondary} print:hidden ${className}`}>
      <svg viewBox="0 0 24 24" className="mr-1.5 inline-block h-4 w-4 align-text-bottom" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round"><path d="M6 9V2h12v7M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2M6 14h12v8H6z" /></svg>
      {label}
    </button>
  );
}
