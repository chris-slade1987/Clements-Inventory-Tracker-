"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

const BRANCH_LABEL: Record<string, string> = { vero: "Vero Beach", stuart: "Stuart", orlando: "Orlando", naples: "Naples" };

type Candidate = { id: string; name: string; role: string; branch: string | null };

export default function AssignReviewer({
  reviewId,
  branch,
  candidates,
  currentReviewerId,
}: {
  reviewId: string;
  branch: string | null;
  candidates: Candidate[];
  currentReviewerId: string | null;
}) {
  const router = useRouter();
  // That branch's managers first, then all-branch/exec.
  const options = [...candidates].sort((a, b) => {
    const aw = a.branch === branch ? 0 : 1;
    const bw = b.branch === branch ? 0 : 1;
    return aw - bw || a.name.localeCompare(b.name);
  });
  const [reviewerUserId, setReviewerUserId] = useState(currentReviewerId ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function send() {
    if (!reviewerUserId) return setError("Choose who will conduct the review.");
    setBusy(true); setError(null);
    const res = await fetch("/api/reviews", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "send", reviewId, reviewerUserId }) });
    setBusy(false);
    if (!res.ok) { const d = await res.json().catch(() => ({})); return setError(d.error ?? "Could not send."); }
    router.refresh();
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <select value={reviewerUserId} onChange={(e) => setReviewerUserId(e.target.value)} className="rounded-lg border border-line px-2 py-1.5 text-sm bg-surface">
        <option value="">— Select reviewer —</option>
        {options.map((c) => (
          <option key={c.id} value={c.id}>{c.name}{c.branch ? ` · ${BRANCH_LABEL[c.branch] ?? c.branch}` : ""}{c.branch && branch && c.branch !== branch ? " (other branch)" : ""}</option>
        ))}
      </select>
      <button onClick={send} disabled={busy} className="rounded-lg bg-brand-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-brand-700 disabled:opacity-50">
        {busy ? "Sending…" : currentReviewerId ? "Reassign & notify" : "Assign & notify"}
      </button>
      {error ? <span className="text-xs text-red-600">{error}</span> : null}
    </div>
  );
}
