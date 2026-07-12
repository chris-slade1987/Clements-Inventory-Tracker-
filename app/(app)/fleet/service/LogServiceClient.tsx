"use client";

import { useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Card, btn } from "@/components/ui";

const TYPES = [
  { key: "oil_change", label: "Oil change" },
  { key: "pm", label: "Preventive maintenance" },
  { key: "repair", label: "Repair" },
  { key: "tires", label: "Tires" },
  { key: "inspection", label: "Inspection" },
  { key: "other", label: "Other" },
];

type Vehicle = { id: string; label: string };

type Line = {
  key: string;
  vehicleId: string; // "" = unassigned
  date: string;
  type: string;
  description: string;
  cost: string;
  mileage: string;
  hint: string | null; // vehicle text the reader saw (helper only)
};

let seq = 0;
const today = () => new Date().toISOString().slice(0, 10);
const blankLine = (date: string): Line => ({
  key: `l${seq++}`,
  vehicleId: "",
  date,
  type: "other",
  description: "",
  cost: "",
  mileage: "",
  hint: null,
});

export default function LogServiceClient({ mode, vehicles }: { mode: "mock" | "claude"; vehicles: Vehicle[] }) {
  const router = useRouter();
  const [tab, setTab] = useState<"manual" | "upload">("manual");

  const [vendor, setVendor] = useState("");
  const [invoiceRef, setInvoiceRef] = useState("");
  const [headerDate, setHeaderDate] = useState(today());
  const [defaultVehicle, setDefaultVehicle] = useState("");
  const [lines, setLines] = useState<Line[]>([blankLine(today())]);

  const fileRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [read, setRead] = useState(false); // an invoice has been read into the table
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [receipt, setReceipt] = useState<{ created: number } | null>(null);

  // ---- derived summary -------------------------------------------------
  const summary = useMemo(() => {
    const withCost = lines.filter((l) => parseFloat(l.cost) > 0);
    const total = withCost.reduce((s, l) => s + (parseFloat(l.cost) || 0), 0);
    const assigned = lines.filter((l) => l.vehicleId);
    const unassigned = lines.filter((l) => !l.vehicleId && (l.description || l.cost)).length;
    const vehicleCount = new Set(assigned.map((l) => l.vehicleId)).size;
    return { total, unassigned, vehicleCount, count: withCost.length };
  }, [lines]);

  // ---- line ops --------------------------------------------------------
  const patch = (key: string, p: Partial<Line>) => setLines((prev) => prev.map((l) => (l.key === key ? { ...l, ...p } : l)));
  const remove = (key: string) => setLines((prev) => (prev.length > 1 ? prev.filter((l) => l.key !== key) : prev));
  const addLine = () => setLines((prev) => [...prev, blankLine(headerDate)]);

  function applyHeaderDate(d: string) {
    setHeaderDate(d);
    setLines((prev) => prev.map((l) => ({ ...l, date: d })));
  }
  function assignAll(vehicleId: string) {
    setDefaultVehicle(vehicleId);
    if (vehicleId) setLines((prev) => prev.map((l) => (l.vehicleId ? l : { ...l, vehicleId })));
  }

  function switchTab(next: "manual" | "upload") {
    setTab(next);
    setError(null);
    if (next === "manual" && lines.length === 0) setLines([blankLine(headerDate)]);
  }

  // ---- upload + read ---------------------------------------------------
  async function readInvoice() {
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/api/fleet/service/parse", { method: "POST", body: fd });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? "Could not read the document.");
        setBusy(false);
        return;
      }
      const inv = data.invoice;
      const date = inv.invoiceDate || today();
      setVendor(inv.vendor ?? "");
      setInvoiceRef(inv.invoiceNumber ?? "");
      setHeaderDate(date);
      const matches: (string | null)[] = data.matches ?? [];
      const newLines: Line[] = (inv.lines ?? []).map((l: { description: string; serviceType: string; cost: number | null; mileage: number | null; vehicleHint: string | null }, i: number) => ({
        key: `l${seq++}`,
        vehicleId: matches[i] ?? "",
        date,
        type: l.serviceType || "other",
        description: l.description ?? "",
        cost: l.cost != null ? String(l.cost) : "",
        mileage: l.mileage != null ? String(l.mileage) : "",
        hint: l.vehicleHint ?? null,
      }));
      setLines(newLines.length ? newLines : [blankLine(date)]);
      setRead(true);
      setBusy(false);
    } catch {
      setError("Network error while reading the document.");
      setBusy(false);
    }
  }

  // ---- submit ----------------------------------------------------------
  async function save() {
    const items = lines.filter((l) => l.vehicleId && parseFloat(l.cost) > 0);
    if (items.length === 0) {
      setError("Add at least one charge with a vehicle and a cost.");
      return;
    }
    setBusy(true);
    setError(null);
    const res = await fetch("/api/fleet/service", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "createBatch", vendor, invoiceRef, items }),
    });
    const data = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) return setError(data.error ?? "Save failed.");
    setReceipt({ created: data.created });
    router.refresh();
  }

  function reset() {
    setReceipt(null);
    setRead(false);
    setFile(null);
    setVendor("");
    setInvoiceRef("");
    setHeaderDate(today());
    setDefaultVehicle("");
    setLines([blankLine(today())]);
    setError(null);
    if (fileRef.current) fileRef.current.value = "";
  }

  // ---- receipt ---------------------------------------------------------
  if (receipt) {
    return (
      <Card className="p-5 max-w-md">
        <div className="flex items-center gap-2 text-brand-700">
          <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth={2}>
            <path d="M20 6 9 17l-5-5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <h2 className="text-lg font-semibold">
            {receipt.created} charge{receipt.created === 1 ? "" : "s"} logged
          </h2>
        </div>
        <p className="mt-2 text-sm text-muted">
          Maintenance records were added and each vehicle&rsquo;s cost totals updated.
        </p>
        <button onClick={reset} className={`${btn.primary} w-full mt-5`}>Log more</button>
      </Card>
    );
  }

  const showTable = tab === "manual" || read;

  return (
    <div className="space-y-4 max-w-4xl">
      {/* Mode switch */}
      <div className="flex gap-1 rounded-xl bg-black/20 p-1 w-fit">
        {[
          { key: "manual", label: "Enter manually" },
          { key: "upload", label: "Upload invoice / statement" },
        ].map((t) => (
          <button
            key={t.key}
            onClick={() => switchTab(t.key as "manual" | "upload")}
            className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
              tab === t.key ? "bg-emerald-grad text-[#05271c] shadow" : "text-mint hover:text-white"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Upload dropzone (upload tab, before a read) */}
      {tab === "upload" && !read ? (
        <>
          <div
            className={`rounded-xl border-2 border-dashed p-6 text-center bg-surface ${file ? "border-brand-400" : "border-line"}`}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              const f = e.dataTransfer.files?.[0];
              if (f) setFile(f);
            }}
          >
            <input ref={fileRef} type="file" accept="application/pdf,image/*" className="hidden" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
            <div className="mx-auto mb-2 grid h-12 w-12 place-items-center rounded-full bg-brand-50 text-brand-600">
              <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth={1.8}>
                <path d="M12 16V4m0 0L8 8m4-4l4 4M4 17v2a2 2 0 002 2h12a2 2 0 002-2v-2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </div>
            {file ? <p className="text-sm font-medium">{file.name}</p> : <p className="text-sm text-muted">Drag a PDF or photo of the invoice / shop statement here, or choose a file.</p>}
            <div className="mt-3 flex justify-center gap-2">
              <button onClick={() => fileRef.current?.click()} className={btn.secondary}>Choose file</button>
            </div>
          </div>
          <div className="rounded-lg bg-black/20 px-3 py-2 text-xs text-mint">
            Reader: <span className="font-medium">{mode === "claude" ? "Claude vision (live)" : "Mock parser (no API key set)"}</span>. We read every charge and try to match each to a vehicle — you confirm before anything is saved. A single statement can cover several trucks.
          </div>
          {error ? <p className="text-sm text-red-600">{error}</p> : null}
          <button onClick={readInvoice} disabled={!file || busy} className={`${btn.primary} w-full`}>
            {busy ? "Reading…" : "Read invoice / statement"}
          </button>
        </>
      ) : null}

      {/* Shared header + line table */}
      {showTable ? (
        <>
          <Card className="p-4 grid gap-3 sm:grid-cols-3">
            <label className="block text-sm font-medium">Vendor / shop
              <input value={vendor} onChange={(e) => setVendor(e.target.value)} placeholder="e.g. Vero Tire & Auto" className="mt-1 w-full rounded-lg border border-line px-3 py-2 text-sm" />
            </label>
            <label className="block text-sm font-medium">Invoice / statement #
              <input value={invoiceRef} onChange={(e) => setInvoiceRef(e.target.value)} className="mt-1 w-full rounded-lg border border-line px-3 py-2 text-sm" />
            </label>
            <label className="block text-sm font-medium">Date
              <input type="date" value={headerDate} onChange={(e) => applyHeaderDate(e.target.value)} className="mt-1 w-full rounded-lg border border-line px-3 py-2 text-sm text-ink" />
            </label>
          </Card>

          {/* "Which vehicle?" — the pop-up-style prompt. Sets every unassigned line. */}
          <Card className="p-4 ring-1 ring-brand-300 bg-brand-50/40">
            <label className="block text-sm font-medium text-ink">
              Which vehicle is this for?
              <span className="ml-1 font-normal text-muted">Sets any line you haven&rsquo;t assigned. Multiple trucks? Assign each line below.</span>
              <select value={defaultVehicle} onChange={(e) => assignAll(e.target.value)} className="mt-1 w-full rounded-lg border border-line px-3 py-2 text-sm bg-surface">
                <option value="">— Select a vehicle —</option>
                {vehicles.map((v) => <option key={v.id} value={v.id}>{v.label}</option>)}
              </select>
            </label>
          </Card>

          {/* Charges */}
          <div className="space-y-2">
            {lines.map((l, i) => {
              const unassigned = !l.vehicleId;
              return (
                <Card key={l.key} className={`p-3 ${unassigned ? "ring-1 ring-amber-300" : ""}`}>
                  <div className="flex items-center justify-between gap-2 mb-2">
                    <span className="text-xs font-medium text-muted">Charge {i + 1}{l.hint ? <span className="ml-2 font-normal">· reader saw &ldquo;{l.hint}&rdquo;</span> : null}</span>
                    <button onClick={() => remove(l.key)} disabled={lines.length === 1} className="text-muted hover:text-red-600 disabled:opacity-30 p-1" aria-label="Remove charge">
                      <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={1.8}><path d="M6 6l12 12M18 6L6 18" strokeLinecap="round" /></svg>
                    </button>
                  </div>
                  <div className="grid gap-2 sm:grid-cols-12">
                    <label className="text-xs text-muted sm:col-span-4">Vehicle
                      <select value={l.vehicleId} onChange={(e) => patch(l.key, { vehicleId: e.target.value })} className={`mt-0.5 w-full rounded-lg border px-2 py-1.5 text-sm bg-surface ${unassigned ? "border-amber-400" : "border-line"}`}>
                        <option value="">— Unassigned —</option>
                        {vehicles.map((v) => <option key={v.id} value={v.id}>{v.label}</option>)}
                      </select>
                    </label>
                    <label className="text-xs text-muted sm:col-span-3">Type
                      <select value={l.type} onChange={(e) => patch(l.key, { type: e.target.value })} className="mt-0.5 w-full rounded-lg border border-line px-2 py-1.5 text-sm bg-surface">
                        {TYPES.map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}
                      </select>
                    </label>
                    <label className="text-xs text-muted sm:col-span-2">Cost ($)
                      <input inputMode="decimal" value={l.cost} onChange={(e) => patch(l.key, { cost: e.target.value })} className="mt-0.5 w-full rounded-lg border border-line px-2 py-1.5 text-sm" />
                    </label>
                    <label className="text-xs text-muted sm:col-span-3">Mileage
                      <input inputMode="numeric" value={l.mileage} onChange={(e) => patch(l.key, { mileage: e.target.value })} className="mt-0.5 w-full rounded-lg border border-line px-2 py-1.5 text-sm" />
                    </label>
                    <label className="text-xs text-muted sm:col-span-12">Description
                      <input value={l.description} onChange={(e) => patch(l.key, { description: e.target.value })} placeholder="What was done" className="mt-0.5 w-full rounded-lg border border-line px-2 py-1.5 text-sm" />
                    </label>
                  </div>
                </Card>
              );
            })}
          </div>

          <button onClick={addLine} className={`${btn.secondary} w-full`}>+ Add another charge</button>

          {/* Summary */}
          <Card className="p-3 flex flex-wrap items-center justify-between gap-2 text-sm">
            <span className="text-muted">
              {summary.count} charge{summary.count === 1 ? "" : "s"} · {summary.vehicleCount} vehicle{summary.vehicleCount === 1 ? "" : "s"}
              {summary.unassigned > 0 ? <span className="ml-2 text-amber-600 font-medium">· {summary.unassigned} unassigned</span> : null}
            </span>
            <span className="font-semibold tabular-nums">${summary.total.toFixed(2)}</span>
          </Card>

          {error ? <p className="text-sm text-red-600">{error}</p> : null}

          <div className="flex gap-2">
            <button onClick={reset} className={btn.secondary}>Start over</button>
            <button onClick={save} disabled={busy} className={`${btn.primary} flex-1`}>
              {busy ? "Saving…" : `Save ${summary.count || ""} charge${summary.count === 1 ? "" : "s"}`.trim()}
            </button>
          </div>
        </>
      ) : null}
    </div>
  );
}
