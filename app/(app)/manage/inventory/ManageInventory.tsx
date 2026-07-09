"use client";

import { useRef, useState } from "react";
import { Card, btn } from "@/components/ui";

type Result = {
  productsCreated: number;
  productsMatched: number;
  branchesMatched: string[];
  unmatchedBranches: string[];
  adjustmentsPosted: number;
  rowsSkipped: number;
};

export default function ManageInventory() {
  const fileRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [label, setLabel] = useState("");
  const [reset, setReset] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<Result | null>(null);

  async function run() {
    if (!file) return;
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      if (label) fd.append("label", label);
      if (reset) fd.append("reset", "true");
      const res = await fetch("/api/manage/inventory-import", { method: "POST", body: fd });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? "Import failed.");
      } else {
        setResult(data as Result);
        setFile(null);
        if (fileRef.current) fileRef.current.value = "";
      }
    } catch {
      setError("Network error during import.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4 max-w-2xl">
      <Card className="p-4">
        <h2 className="font-semibold text-ink mb-1">Import stock on-hand</h2>
        <p className="text-sm text-muted mb-3">
          Upload the PestPac <em>Inventory On-Hand Report</em> (the tab-delimited
          .xls export) or a CSV with <code>warehouse, product, qty, uom, cost</code>.
          The importer creates any missing products and <strong>sets on-hand to
          the counted quantity</strong> for each branch by posting adjustment
          movements for the difference — so you can re-upload an updated count
          any time and it reconciles automatically. Nothing is deleted.
        </p>

        <label className="block text-sm font-medium mb-1">Label (optional)</label>
        <input
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder="e.g. On-hand as of 2026-07-09"
          className="w-full rounded-lg border border-line px-3 py-2 text-sm mb-3"
        />

        <div className="flex flex-wrap items-center gap-2">
          <input
            ref={fileRef}
            type="file"
            accept=".xls,.csv,.tsv,.txt,text/csv,text/plain"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            className="text-sm"
          />
        </div>
        {file ? <p className="mt-2 text-xs text-muted">{file.name}</p> : null}

        <label className="mt-3 flex items-start gap-2 text-sm text-ink">
          <input type="checkbox" checked={reset} onChange={(e) => setReset(e.target.checked)} className="mt-0.5" />
          <span>
            <span className="font-medium">First load —</span> clear the demo
            sample catalog &amp; all stock first, then load only this file.
            <span className="block text-xs text-muted">
              Branches, managers, and technicians are kept. Use this once for the
              initial real-data load; leave unchecked for month-end reconcile
              updates.
            </span>
          </span>
        </label>

        {error ? <p className="mt-3 text-sm text-red-600">{error}</p> : null}

        <button onClick={run} disabled={!file || busy} className={`${btn.primary} mt-4`}>
          {busy ? "Importing…" : "Import stock counts"}
        </button>
      </Card>

      {result ? (
        <Card className="p-4">
          <h3 className="font-semibold text-brand-700 mb-2">Import complete</h3>
          <ul className="text-sm space-y-1">
            <li>Products created: <strong>{result.productsCreated}</strong></li>
            <li>Product/branch counts set: <strong>{result.productsMatched}</strong></li>
            <li>Adjustments posted: <strong>{result.adjustmentsPosted}</strong></li>
            <li>Branches matched: <strong>{result.branchesMatched.join(", ") || "none"}</strong></li>
            {result.unmatchedBranches.length ? (
              <li className="text-amber-600">Unmatched branches (skipped): {result.unmatchedBranches.join(", ")}</li>
            ) : null}
            {result.rowsSkipped ? (
              <li className="text-amber-600">Rows skipped: {result.rowsSkipped}</li>
            ) : null}
          </ul>
          <p className="mt-3 text-xs text-muted">
            Check the Dashboard and Reports to see the new on-hand numbers.
          </p>
        </Card>
      ) : null}
    </div>
  );
}
