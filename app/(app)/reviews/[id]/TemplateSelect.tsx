"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { REVIEW_TEMPLATES } from "@/lib/review-forms";

// HR-only: change which role-specific form this new hire is reviewed on. Always
// available (even after the review is in progress) — set_template rejects only a
// completed review. POSTs set_template and refreshes.
export default function TemplateSelect({
  reviewId,
  current,
  disabled,
}: {
  reviewId: string;
  current: string;
  disabled?: boolean;
}) {
  const router = useRouter();
  const [value, setValue] = useState(current);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function change(next: string) {
    const prev = value;
    setValue(next);
    setBusy(true); setError(null);
    const res = await fetch("/api/reviews", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "set_template", reviewId, template: next }),
    });
    setBusy(false);
    if (!res.ok) {
      const d = await res.json().catch(() => ({}));
      setValue(prev);
      return setError(d.error ?? "Could not change the form.");
    }
    router.refresh();
  }

  return (
    <label className="ml-auto flex items-center gap-2 text-xs text-muted">
      Form
      <select
        value={value}
        onChange={(e) => change(e.target.value)}
        disabled={busy || disabled}
        className="rounded-lg border border-line bg-surface px-2 py-1 text-xs text-ink disabled:opacity-60"
      >
        {REVIEW_TEMPLATES.map((t) => (
          <option key={t.key} value={t.key}>{t.label}</option>
        ))}
      </select>
      {error ? <span className="text-red-600">{error}</span> : null}
    </label>
  );
}
