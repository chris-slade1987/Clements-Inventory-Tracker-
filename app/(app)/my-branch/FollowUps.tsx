"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Card } from "@/components/ui";

type FollowUp = { id: string; description: string; dueDate: string | null; quarter: number; year: number; overdue: boolean };

export default function FollowUps({ items }: { items: FollowUp[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [hidden, setHidden] = useState<Set<string>>(new Set());

  async function done(id: string) {
    setBusy(id);
    const res = await fetch("/api/management/audit", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "followupDone", id, done: true }),
    });
    setBusy(null);
    if (res.ok) { setHidden((s) => new Set(s).add(id)); router.refresh(); }
  }

  const visible = items.filter((i) => !hidden.has(i.id));
  if (visible.length === 0) return null;

  return (
    <Card className="p-0 overflow-hidden mb-5">
      <div className="px-4 py-3 border-b border-line flex items-center justify-between">
        <div className="text-sm font-medium text-ink">Audit action items</div>
        <div className="text-xs text-muted">{visible.length} open</div>
      </div>
      <ul className="divide-y divide-line">
        {visible.map((f) => (
          <li key={f.id} className="flex items-start gap-3 px-4 py-3">
            <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${f.overdue ? "bg-red-500" : "bg-amber-500"}`} />
            <span className="flex-1">
              <span className="block text-sm text-ink">{f.description}</span>
              <span className="block text-xs text-muted">
                Q{f.quarter} {f.year} audit{f.dueDate ? ` · ${f.overdue ? "overdue" : "due"} ${new Date(f.dueDate).toLocaleDateString()}` : ""}
              </span>
            </span>
            <button onClick={() => done(f.id)} disabled={busy === f.id} className="shrink-0 rounded-lg bg-brand-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-brand-700 disabled:opacity-50">
              {busy === f.id ? "…" : "Mark done"}
            </button>
          </li>
        ))}
      </ul>
    </Card>
  );
}
