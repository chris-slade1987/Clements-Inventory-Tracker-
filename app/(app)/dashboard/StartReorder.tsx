"use client";

import { useState } from "react";
import Link from "next/link";
import { btn } from "@/components/ui";

export type ReorderItem = {
  productName: string;
  warehouseName: string;
  onHand: number;
  unit: string;
  reorderQty: number;
};

// "Start reorder": turns the live low-stock list into a copyable order list the
// manager can paste into a distributor order / email, plus a link into Check-In
// to receive it once it arrives. Read-only staging — it never posts stock.
export default function StartReorder({ items }: { items: ReorderItem[] }) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);

  if (items.length === 0) return null;

  const text = buildOrderText(items);

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }

  return (
    <>
      <button onClick={() => setOpen(true)} className="text-xs font-medium text-brand-700 hover:underline">
        Start reorder
      </button>
      {open ? (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-end sm:items-center justify-center p-0 sm:p-4" onClick={() => setOpen(false)}>
          <div className="surface-light w-full sm:max-w-lg rounded-t-2xl sm:rounded-2xl p-5 space-y-3" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-semibold">Reorder list</h3>
            <p className="text-sm text-muted">
              {items.length} item{items.length === 1 ? "" : "s"} running low. Copy this list into a distributor order, then use Check-In to receive it when it arrives.
            </p>
            <textarea
              readOnly
              value={text}
              rows={Math.min(14, items.length + 2)}
              className="w-full rounded-lg border border-line bg-surface p-3 text-xs font-mono"
              onFocus={(e) => e.currentTarget.select()}
            />
            <div className="flex flex-wrap gap-2 pt-1">
              <button onClick={copy} className={btn.primary}>{copied ? "Copied" : "Copy list"}</button>
              <Link href="/check-in" className={btn.secondary}>Open Check-In</Link>
              <button onClick={() => setOpen(false)} className="ml-auto text-sm font-medium text-muted hover:text-ink">Close</button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}

function buildOrderText(items: ReorderItem[]): string {
  const byBranch = new Map<string, ReorderItem[]>();
  for (const it of items) {
    const list = byBranch.get(it.warehouseName) ?? [];
    list.push(it);
    byBranch.set(it.warehouseName, list);
  }
  const lines: string[] = [];
  for (const [branch, list] of byBranch) {
    lines.push(`${branch}:`);
    for (const it of list) {
      lines.push(`  - ${it.productName} — order ~${Math.round(it.reorderQty)} ${it.unit} (on hand ${Math.round(it.onHand)})`);
    }
    lines.push("");
  }
  return lines.join("\n").trimEnd();
}
