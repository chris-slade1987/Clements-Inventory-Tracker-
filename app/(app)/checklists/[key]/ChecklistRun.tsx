"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Card, btn } from "@/components/ui";
import { groupByCategory, type ChecklistItem, type ItemResult } from "@/lib/checklists";

type ExistingRecord = {
  signedName: string;
  attestation: string;
  createdAt: string;
  itemResults: ItemResult[];
};

const DATE = (iso: string) => new Date(iso).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" });

export default function ChecklistRun({
  templateId,
  intro,
  branch,
  periodKey,
  periodLabel,
  items,
  attestation,
  canSign,
  defaultName,
  existing,
}: {
  templateId: string;
  intro: string | null;
  branch: string;
  periodKey: string;
  periodLabel: string;
  items: ChecklistItem[];
  attestation: string;
  canSign: boolean;
  defaultName: string;
  existing: ExistingRecord | null;
}) {
  const router = useRouter();
  const groups = useMemo(() => groupByCategory(items), [items]);

  const [checked, setChecked] = useState<Record<string, boolean>>({});
  const [name, setName] = useState(defaultName ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<ExistingRecord | null>(existing);

  const doneCount = items.filter((it) => checked[it.id]).length;

  // Read-only signed record (already signed, or just submitted).
  if (saved) {
    const byId = new Map(saved.itemResults.map((r) => [r.itemId, r]));
    return (
      <Card className="p-0 overflow-hidden">
        <div className="px-5 py-4 border-b border-line bg-emerald-50/50">
          <div className="flex items-center gap-2">
            <span className="grid h-7 w-7 place-items-center rounded-full bg-emerald-100 text-emerald-700 text-sm">✓</span>
            <div>
              <div className="text-sm font-semibold text-emerald-800">Signed &amp; recorded</div>
              <div className="text-xs text-emerald-700">This is a permanent, non-editable record.</div>
            </div>
          </div>
          <p className="mt-3 text-sm text-ink italic">&ldquo;{saved.attestation}&rdquo;</p>
          <p className="mt-2 text-xs text-muted">
            Signed by <span className="font-medium text-ink">{saved.signedName}</span> on {DATE(saved.createdAt)}
          </p>
        </div>
        <ul className="divide-y divide-line">
          {items.map((it) => {
            const r = byId.get(it.id);
            const ok = r?.checked === true;
            return (
              <li key={it.id} className="flex items-start gap-3 px-5 py-3">
                <span className={`mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded text-[11px] ${ok ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-400"}`}>{ok ? "✓" : "—"}</span>
                <div className="flex-1">
                  <div className="text-[15px] font-semibold text-ink">{it.label}</div>
                  <div className="text-xs text-muted mt-0.5">{it.objective}</div>
                </div>
              </li>
            );
          })}
        </ul>
      </Card>
    );
  }

  async function submit() {
    if (!canSign) return setError("Only branch managers may sign a checklist.");
    if (!name.trim()) return setError("Type your full name to sign the attestation.");
    setBusy(true);
    setError(null);
    const itemResults: ItemResult[] = items.map((it) => ({
      itemId: it.id,
      checked: !!checked[it.id],
      note: "",
    }));
    const res = await fetch("/api/checklists", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "submit", templateId, branch, periodKey, itemResults, signedName: name.trim() }),
    });
    const data = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) return setError(data.error ?? "Could not submit.");
    setSaved({
      signedName: name.trim(),
      attestation,
      createdAt: new Date().toISOString(),
      itemResults,
    });
    router.refresh();
  }

  return (
    <div className="space-y-4">
      {intro ? (
        <Card className="px-5 py-3">
          <p className="text-sm text-muted">{intro}</p>
        </Card>
      ) : null}

      <Card className="p-0 overflow-hidden">
        <div className="px-5 py-3 border-b border-line flex items-center justify-between">
          <div className="text-sm font-medium text-ink">Progress</div>
          <div className="text-sm tabular-nums text-muted">{doneCount}/{items.length} checked</div>
        </div>
        {groups.map((g) => (
          <div key={g.category}>
            <div className="px-5 py-2 bg-black/[0.02] text-[11px] font-semibold uppercase tracking-wider text-muted">{g.category}</div>
            <ul className="divide-y divide-line">
              {g.items.map((it) => {
                const isChecked = !!checked[it.id];
                return (
                  <li key={it.id} className="px-4 py-3">
                    <label className="flex items-start gap-3 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={isChecked}
                        onChange={(e) => setChecked((c) => ({ ...c, [it.id]: e.target.checked }))}
                        className="mt-1 h-5 w-5 shrink-0 rounded border-slate-300 accent-emerald-600"
                      />
                      <span className="flex-1">
                        <span className={`block text-[15px] font-semibold ${isChecked ? "text-brand-700" : "text-ink"}`}>
                          {it.label}
                        </span>
                        <span className="block text-xs text-muted mt-0.5">{it.objective}</span>
                      </span>
                    </label>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </Card>

      {/* Typed-signature attestation */}
      <Card className="px-5 py-4">
        <div className="text-sm font-medium text-ink">Sign off — attestation</div>
        <p className="mt-2 text-sm text-ink italic">&ldquo;{attestation}&rdquo;</p>
        <p className="mt-2 text-xs text-muted">
          Type your full name below to sign. Signing creates a permanent, timestamped, non-editable record for {periodLabel}. It cannot be changed once signed.
        </p>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Type your full name to sign"
          className="mt-3 w-full rounded-lg border border-line px-3 py-2.5 text-sm bg-surface"
          disabled={!canSign}
        />
        {error ? <p className="mt-2 text-sm text-red-600">{error}</p> : null}
        <button onClick={submit} disabled={busy || !canSign} className={`${btn.primary} w-full mt-3`}>
          {busy ? "Signing…" : "Sign & submit"}
        </button>
        {!canSign ? <p className="mt-2 text-xs text-muted">Only branch managers may sign a checklist.</p> : null}
      </Card>
    </div>
  );
}
