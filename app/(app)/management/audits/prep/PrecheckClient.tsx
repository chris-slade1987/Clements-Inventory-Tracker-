"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Card, btn } from "@/components/ui";

type Group = { group: string; items: { key: string; label: string }[] };

export default function PrecheckClient({
  branch, year, quarter, groups, initial, initialNotes,
}: {
  branch: string; year: number; quarter: number; groups: Group[];
  initial: Record<string, boolean>; initialNotes: string;
}) {
  const router = useRouter();
  const [items, setItems] = useState<Record<string, boolean>>(initial);
  const [notes, setNotes] = useState(initialNotes);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const all = groups.flatMap((g) => g.items);
  const done = useMemo(() => all.filter((i) => items[i.key]).length, [items, all]);
  const pct = all.length ? Math.round((done / all.length) * 100) : 0;

  async function save() {
    setBusy(true); setMsg(null);
    const res = await fetch("/api/management/audit", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "precheck", branch, year, quarter, items, notes }),
    });
    setBusy(false);
    if (res.ok) { setMsg("Saved."); router.refresh(); } else setMsg("Save failed.");
  }

  return (
    <div className="space-y-4 max-w-3xl pb-24">
      {groups.map((g) => (
        <Card key={g.group} className="p-4">
          <div className="text-sm font-semibold text-ink mb-2">{g.group}</div>
          <ul className="space-y-1.5">
            {g.items.map((it) => (
              <li key={it.key}>
                <button onClick={() => setItems((s) => ({ ...s, [it.key]: !s[it.key] }))} className="flex items-start gap-2 text-left w-full group">
                  <span className={`mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-md border text-xs ${items[it.key] ? "bg-emerald-grad border-transparent text-white" : "border-line text-transparent group-hover:border-brand-400"}`}>✓</span>
                  <span className={`text-sm ${items[it.key] ? "text-muted line-through" : "text-ink"}`}>{it.label}</span>
                </button>
              </li>
            ))}
          </ul>
        </Card>
      ))}

      <Card className="p-4">
        <label className="block text-sm font-medium">Prep notes
          <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} className="mt-1 w-full rounded-lg border border-line px-3 py-2 text-sm" />
        </label>
      </Card>

      <div className="fixed bottom-0 inset-x-0 sm:left-60 border-t border-line bg-surface/95 backdrop-blur px-4 py-3 z-20">
        <div className="max-w-3xl mx-auto flex items-center gap-4">
          <div className="text-sm"><span className="font-semibold tabular-nums">{done}/{all.length}</span> <span className="text-muted">complete · {pct}%</span>{msg ? <span className="ml-2 text-xs text-muted">{msg}</span> : null}</div>
          <button onClick={save} disabled={busy} className={`${btn.primary} ml-auto`}>{busy ? "Saving…" : "Save checklist"}</button>
        </div>
      </div>
    </div>
  );
}
