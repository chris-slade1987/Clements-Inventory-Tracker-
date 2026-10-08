"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { btn } from "@/components/ui";

// Admin control on the course page: remove every assignment of THIS course that
// isn't completed yet, in one click. Completed records and the course itself are
// kept. Used to clear early/pre-launch assignments (e.g. the August roll-out) so
// they don't show as incomplete until training actually goes live.
export default function ClearOutstandingButton({ courseId, outstanding }: { courseId: string; outstanding: number }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  if (outstanding === 0) return null;

  async function run() {
    const who = `${outstanding} ${outstanding === 1 ? "person who hasn't" : "people who haven't"} completed it`;
    if (!confirm(`Unassign this course from the ${who}?\n\nThe course stays, and anyone who already completed it keeps their record. You can reassign later.`)) return;
    setBusy(true); setMsg(null);
    const res = await fetch("/api/management/course/manage", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "unassignOutstanding", courseId }),
    });
    const d = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) return setMsg(d.error ?? "Could not unassign.");
    setMsg(`Unassigned ${d.removed}.`);
    router.refresh();
  }

  return (
    <div className="flex items-center gap-2">
      <button onClick={run} disabled={busy} className={btn.secondary}>
        {busy ? "Unassigning…" : `Unassign outstanding (${outstanding})`}
      </button>
      {msg ? <span className="text-xs font-medium text-emerald-700">{msg}</span> : null}
    </div>
  );
}
