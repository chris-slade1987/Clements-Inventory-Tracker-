"use client";

import { useState } from "react";

// HR-facing: the per-job public apply links to paste into the Indeed ad or the
// company website. Absolute (APP_URL) when configured; otherwise resolved
// against the current origin so the copied value is always shareable.
function absolute(url: string): string {
  if (typeof window !== "undefined" && url.startsWith("/")) return window.location.origin + url;
  return url;
}

function Row({ label, hint, url }: { label: string; hint: string; url: string }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(absolute(url));
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      /* clipboard blocked — the value is still visible to copy manually */
    }
  }
  return (
    <div>
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-semibold text-ink">{label}</span>
        <button onClick={copy} className="rounded-lg bg-brand-600 px-3 py-1 text-xs font-semibold text-white transition hover:bg-brand-700">
          {copied ? "Copied!" : "Copy link"}
        </button>
      </div>
      <input
        readOnly
        value={url}
        onFocus={(e) => e.currentTarget.select()}
        className="mt-1 w-full rounded-lg border border-line bg-black/20 px-3 py-2 text-xs text-muted"
      />
      <p className="mt-1 text-[11px] text-muted">{hint}</p>
    </div>
  );
}

export default function ApplyLinks({ indeedUrl, websiteUrl }: { indeedUrl: string; websiteUrl: string }) {
  return (
    <div className="space-y-3">
      <Row label="Indeed ad link" hint="Paste this as the apply link in the Indeed ad. Applicants who use it are tagged “Indeed”." url={indeedUrl} />
      <Row label="Company website / careers link" hint="Use this on clementspestcontrol.com or elsewhere. Applicants are tagged “Company Website”." url={websiteUrl} />
    </div>
  );
}
