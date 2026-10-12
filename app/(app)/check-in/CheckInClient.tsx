"use client";

import { useRef, useState } from "react";
import { Card, btn, UnitSelect } from "@/components/ui";
import DateInput from "@/components/DateInput";
import { uomCode } from "@/lib/uom";
import { matchProduct } from "@/lib/invoice/match";
import type { ParsedLine } from "@/lib/invoice/types";

type Warehouse = { id: string; name: string };
type Product = { id: string; name: string; unit: string; distributorSku: string | null };

// A draft staged by the Document Intake inventory hand-off, loaded via ?draft=.
export type InitialDraft = {
  warehouseId: string | null;
  distributor: string;
  invoiceNumber: string;
  invoiceDate: string;
  subtotal: number | null;
  total: number | null;
  filePath: string | null;
  lines: ParsedLine[];
};

// A line shape returned by the chat assistant (the full revised line set).
type ChatDraftLine = {
  descriptionRaw?: string;
  description?: string;
  quantity?: number;
  unit?: string | null;
  unitPrice?: number | null;
  lineTotal?: number | null;
  productId?: string | null;
};
type ChatDraft = {
  warehouseId?: string | null;
  distributor?: string | null;
  invoiceNumber?: string | null;
  invoiceDate?: string | null;
  lines: ChatDraftLine[];
};
type ChatMsg = { role: "user" | "assistant"; content: string };

type ReviewLine = {
  key: string;
  descriptionRaw: string;
  quantity: number;
  unit: string;
  unitPrice: number | null;
  lineTotal: number | null;
  // productId, or "__new__" to create, or "" for unmatched (skipped)
  productId: string;
  newName: string;
  newUnit: string;
};

type Receipt = {
  warehouse: string;
  distributor: string;
  invoiceNumber: string;
  itemCount: number;
  lineCount: number;
};

let keySeq = 0;

// Distributors used for manual check-in (no invoice to read the name from).
const DISTRIBUTORS = ["Site One", "Helena", "Howards", "Other"];

export default function CheckInClient({
  mode,
  defaultWarehouseId,
  warehouses,
  products,
  initialDraft = null,
}: {
  mode: "mock" | "claude";
  defaultWarehouseId: string;
  warehouses: Warehouse[];
  products: Product[];
  initialDraft?: InitialDraft | null;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // When a hand-off draft is present it preloads the review state directly (no
  // effect needed) — same editable list the user would see after reading an
  // invoice. Confirm remains the only path that posts stock.
  const [warehouseId, setWarehouseId] = useState(() =>
    initialDraft?.warehouseId && warehouses.some((w) => w.id === initialDraft.warehouseId)
      ? initialDraft.warehouseId
      : defaultWarehouseId
  );
  const [distributor, setDistributor] = useState(initialDraft?.distributor ?? "");
  // Manual mode: dropdown selection ("Other" reveals the free-text `distributor`).
  const [distributorChoice, setDistributorChoice] = useState("");
  const [invoiceNumber, setInvoiceNumber] = useState(initialDraft?.invoiceNumber ?? "");
  const [invoiceDate, setInvoiceDate] = useState(() =>
    initialDraft ? initialDraft.invoiceDate || new Date().toISOString().slice(0, 10) : ""
  );
  const [subtotal, setSubtotal] = useState<number | null>(initialDraft?.subtotal ?? null);
  const [total, setTotal] = useState<number | null>(initialDraft?.total ?? null);
  const [filePath, setFilePath] = useState<string | null>(initialDraft?.filePath ?? null);
  const [lines, setLines] = useState<ReviewLine[] | null>(() =>
    initialDraft ? (initialDraft.lines.length ? initialDraft.lines.map((l) => toReviewLine(l)) : [blankLine()]) : null
  );
  const [manualMode, setManualMode] = useState(false);
  const [receipt, setReceipt] = useState<Receipt | null>(null);

  // ---- Check-In assistant (chat) --------------------------------------
  const [chatMessages, setChatMessages] = useState<ChatMsg[]>([]);
  const [chatInput, setChatInput] = useState("");
  const [chatSending, setChatSending] = useState(false);
  const [chatOpen, setChatOpen] = useState(!!initialDraft);

  // Fuzzy-match a description to a catalog product id for client-side re-matching
  // after a chat revision (candidates computed inline so lazy state init is safe).
  function matchFor(description: string): string {
    return matchProduct(
      description ?? "",
      null,
      products.map((p) => ({ id: p.id, name: p.name, distributorSku: p.distributorSku }))
    ) ?? "";
  }

  // Build a review line from a parsed/chat line, running product matching (an
  // explicit, still-valid productId wins; otherwise fuzzy-match the description).
  function toReviewLine(l: { descriptionRaw?: string; description?: string; quantity?: number; unit?: string | null; unitPrice?: number | null; lineTotal?: number | null; productId?: string | null }): ReviewLine {
    const desc = (l.descriptionRaw ?? l.description ?? "").trim();
    const unit = uomCode(l.unit) ?? "EA";
    const explicit = l.productId && products.some((p) => p.id === l.productId) ? l.productId : null;
    return {
      key: `l${keySeq++}`,
      descriptionRaw: desc,
      quantity: Number(l.quantity) || 0,
      unit,
      unitPrice: l.unitPrice ?? null,
      lineTotal: l.lineTotal ?? null,
      productId: explicit ?? matchFor(desc),
      newName: desc,
      newUnit: unit,
    };
  }

  function blankLine(preferNew = false): ReviewLine {
    return {
      key: `l${keySeq++}`,
      descriptionRaw: "",
      quantity: 1,
      unit: "EA",
      unitPrice: null,
      lineTotal: null,
      productId: preferNew ? "__new__" : "",
      newName: "",
      newUnit: "EA",
    };
  }

  // Start a manual check-in — no invoice, one blank line ready to add a product.
  function startManual() {
    setManualMode(true);
    setDistributor("");
    setDistributorChoice("");
    setInvoiceNumber("");
    setInvoiceDate(new Date().toISOString().slice(0, 10));
    setSubtotal(null);
    setTotal(null);
    setFilePath(null);
    setError(null);
    setLines([blankLine()]);
  }
  function addLine() {
    setLines((prev) => [...(prev ?? []), blankLine()]);
  }

  // Apply a chat-revised draft to the editable state, re-running product matching.
  function applyChatDraft(d: ChatDraft) {
    if (d.warehouseId && warehouses.some((w) => w.id === d.warehouseId)) setWarehouseId(d.warehouseId);
    if (typeof d.distributor === "string") setDistributor(d.distributor);
    if (typeof d.invoiceNumber === "string") setInvoiceNumber(d.invoiceNumber);
    if (typeof d.invoiceDate === "string" && d.invoiceDate) setInvoiceDate(d.invoiceDate);
    if (Array.isArray(d.lines)) {
      setLines(d.lines.map((l) => toReviewLine(l)));
    }
  }

  // Current editable state as a chat draft payload for the assistant.
  function currentDraftPayload(): ChatDraft {
    return {
      warehouseId,
      distributor,
      invoiceNumber,
      invoiceDate,
      lines: (lines ?? []).map((l) => ({
        descriptionRaw: l.productId === "__new__" ? l.newName : l.descriptionRaw,
        quantity: l.quantity,
        unit: l.unit,
        unitPrice: l.unitPrice,
        lineTotal: l.lineTotal,
        productId: l.productId && l.productId !== "__new__" ? l.productId : null,
      })),
    };
  }

  async function sendChat() {
    const text = chatInput.trim();
    if (!text || chatSending) return;
    const history = chatMessages;
    setChatMessages((m) => [...m, { role: "user", content: text }]);
    setChatInput("");
    setChatSending(true);
    try {
      const res = await fetch("/api/check-in/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ draft: currentDraftPayload(), history, message: text }),
      });
      const data = await res.json().catch(() => ({}));
      setChatSending(false);
      if (!res.ok) {
        setChatMessages((m) => [...m, { role: "assistant", content: data.error ?? "Something went wrong — try again." }]);
        return;
      }
      setChatMessages((m) => [...m, { role: "assistant", content: data.reply }]);
      if (data.draft) applyChatDraft(data.draft as ChatDraft);
    } catch {
      setChatSending(false);
      setChatMessages((m) => [...m, { role: "assistant", content: "Network error — try again." }]);
    }
  }

  async function readInvoice() {
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/api/check-in/parse", { method: "POST", body: fd });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? "Could not read the invoice.");
        setBusy(false);
        return;
      }
      const inv = data.invoice;
      setDistributor(inv.distributor ?? "");
      setInvoiceNumber(inv.invoiceNumber ?? "");
      setInvoiceDate(inv.invoiceDate ?? new Date().toISOString().slice(0, 10));
      setSubtotal(inv.subtotal ?? null);
      setTotal(inv.total ?? null);
      setFilePath(data.filePath ?? null);
      setLines(
        inv.lines.map((l: ReviewLine & { description: string }, i: number) => ({
          key: `l${keySeq++}`,
          descriptionRaw: l.description,
          quantity: l.quantity ?? 0,
          unit: uomCode(l.unit) ?? "EA",
          unitPrice: l.unitPrice ?? null,
          lineTotal: l.lineTotal ?? null,
          productId: data.matches[i] ?? "",
          newName: l.description,
          newUnit: uomCode(l.unit) ?? "EA",
        }))
      );
      setBusy(false);
    } catch {
      setError("Network error while reading the invoice.");
      setBusy(false);
    }
  }

  function updateLine(key: string, patch: Partial<ReviewLine>) {
    setLines((prev) =>
      prev ? prev.map((l) => (l.key === key ? { ...l, ...patch } : l)) : prev
    );
  }
  function removeLine(key: string) {
    setLines((prev) => (prev ? prev.filter((l) => l.key !== key) : prev));
  }
  // Selecting a product auto-fills the unit from that product's approved unit
  // (its unit of measure) and labels the line with the product name.
  function pickProduct(key: string, productId: string) {
    const patch: Partial<ReviewLine> = { productId };
    if (productId && productId !== "__new__") {
      const prod = products.find((p) => p.id === productId);
      if (prod) {
        patch.unit = uomCode(prod.unit) ?? "EA";
        patch.descriptionRaw = prod.name;
      }
    }
    updateLine(key, patch);
  }

  async function confirm() {
    if (!lines) return;
    setBusy(true);
    setError(null);
    try {
      // In manual mode the distributor comes from the dropdown (or the free-text
      // box when "Other" is chosen); invoice mode keeps the AI-read name.
      const effectiveDistributor = manualMode
        ? distributorChoice === "Other"
          ? distributor.trim()
          : distributorChoice
        : distributor;
      const payload = {
        warehouseId,
        filePath,
        distributor: effectiveDistributor,
        invoiceNumber,
        invoiceDate,
        subtotal,
        total,
        lines: lines.map((l) => ({
          productId: l.productId && l.productId !== "__new__" ? l.productId : null,
          newProduct:
            l.productId === "__new__"
              ? { name: l.newName, unitOfMeasure: l.newUnit }
              : null,
          descriptionRaw: l.descriptionRaw,
          quantity: l.quantity,
          unit: l.unit,
          unitPrice: l.unitPrice,
          lineTotal: l.lineTotal,
        })),
      };
      const res = await fetch("/api/check-in/confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? "Confirm failed.");
        setBusy(false);
        return;
      }
      setReceipt(data.receipt as Receipt);
      setBusy(false);
    } catch {
      setError("Network error. Try again.");
      setBusy(false);
    }
  }

  function reset() {
    setReceipt(null);
    setLines(null);
    setManualMode(false);
    setFile(null);
    setFilePath(null);
    setDistributor("");
    setDistributorChoice("");
    setInvoiceNumber("");
    setInvoiceDate("");
    setSubtotal(null);
    setTotal(null);
    setError(null);
    setChatMessages([]);
    setChatInput("");
    setChatOpen(false);
    if (fileRef.current) fileRef.current.value = "";
  }

  // ---- Receipt --------------------------------------------------------
  if (receipt) {
    return (
      <Card className="p-5">
        <div className="flex items-center gap-2 text-brand-700">
          <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth={2}>
            <path d="M20 6 9 17l-5-5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <h2 className="text-lg font-semibold">Invoice checked in</h2>
        </div>
        <dl className="mt-4 grid grid-cols-2 gap-y-2 text-sm">
          <dt className="text-muted">Warehouse</dt>
          <dd className="text-right font-medium">{receipt.warehouse}</dd>
          <dt className="text-muted">Distributor</dt>
          <dd className="text-right font-medium">{receipt.distributor}</dd>
          <dt className="text-muted">Invoice #</dt>
          <dd className="text-right font-medium">{receipt.invoiceNumber}</dd>
          <dt className="text-muted">Lines</dt>
          <dd className="text-right font-medium">{receipt.lineCount}</dd>
          <dt className="text-muted">Items added</dt>
          <dd className="text-right font-medium">{receipt.itemCount}</dd>
        </dl>
        <button onClick={reset} className={`${btn.primary} w-full mt-5`}>
          Check in another
        </button>
      </Card>
    );
  }

  // ---- Review ---------------------------------------------------------
  if (lines) {
    return (
      <div className="space-y-4">
        <div className="flex items-center gap-2">
          <h2 className="text-base font-semibold text-ink">{manualMode ? "Manual check-in" : "Review invoice"}</h2>
          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-600">{manualMode ? "no invoice" : "from invoice"}</span>
        </div>
        <Card className="p-4 grid gap-3 sm:grid-cols-2">
          <div>
            <label className="block text-sm font-medium mb-1">Warehouse</label>
            <select
              value={warehouseId}
              onChange={(e) => setWarehouseId(e.target.value)}
              className="w-full rounded-lg border border-line px-3 py-2.5 text-sm bg-surface"
            >
              {warehouses.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Distributor</label>
            {manualMode ? (
              <>
                <select
                  value={distributorChoice}
                  onChange={(e) => setDistributorChoice(e.target.value)}
                  className="w-full rounded-lg border border-line px-3 py-2.5 text-sm bg-surface"
                >
                  <option value="">— Select distributor —</option>
                  {DISTRIBUTORS.map((d) => (
                    <option key={d} value={d}>{d}</option>
                  ))}
                </select>
                {distributorChoice === "Other" ? (
                  <input
                    value={distributor}
                    onChange={(e) => setDistributor(e.target.value)}
                    placeholder="Distributor name"
                    className="mt-2 w-full rounded-lg border border-line px-3 py-2.5 text-sm"
                  />
                ) : null}
              </>
            ) : (
              <input
                value={distributor}
                onChange={(e) => setDistributor(e.target.value)}
                className="w-full rounded-lg border border-line px-3 py-2.5 text-sm"
              />
            )}
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Invoice #</label>
            <input
              value={invoiceNumber}
              onChange={(e) => setInvoiceNumber(e.target.value)}
              className="w-full rounded-lg border border-line px-3 py-2.5 text-sm"
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Invoice date</label>
            <DateInput value={invoiceDate} onChange={setInvoiceDate} />
          </div>
        </Card>

        <div className="space-y-2">
          {lines.map((l) => {
            const unmatched = l.productId === "";
            return (
              <Card key={l.key} className="p-3">
                {/* Product first — the identity of the line. */}
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1">
                    <label className="text-xs text-muted">Product</label>
                    <select
                      value={l.productId}
                      onChange={(e) => pickProduct(l.key, e.target.value)}
                      className={`mt-0.5 w-full rounded-lg border px-2 py-2 text-sm bg-surface ${
                        unmatched ? "border-amber-400" : "border-line"
                      }`}
                    >
                      <option value="">— Select a product —</option>
                      {products.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name}
                        </option>
                      ))}
                      <option value="__new__">+ Create new product…</option>
                    </select>
                  </div>
                  <button
                    onClick={() => removeLine(l.key)}
                    className="mt-5 text-muted hover:text-red-600 p-1"
                    aria-label="Remove line"
                  >
                    <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={1.8}>
                      <path d="M6 6l12 12M18 6L6 18" strokeLinecap="round" />
                    </svg>
                  </button>
                </div>

                {l.productId === "__new__" ? (
                  <div className="mt-2 grid grid-cols-3 gap-2">
                    <input
                      value={l.newName}
                      onChange={(e) => updateLine(l.key, { newName: e.target.value, descriptionRaw: e.target.value })}
                      placeholder="New product name"
                      className="col-span-2 rounded-lg border border-line px-2 py-1.5 text-sm"
                    />
                    <UnitSelect
                      value={l.newUnit}
                      onChange={(code) => updateLine(l.key, { newUnit: code, unit: code })}
                      className="w-full rounded-lg border border-line px-2 py-1.5 text-sm bg-surface"
                    />
                  </div>
                ) : null}
                {unmatched ? (
                  <p className="mt-1 text-xs text-amber-600">Pick a product or create one — otherwise this line is skipped.</p>
                ) : null}

                <div className="mt-2 grid grid-cols-3 gap-2">
                  <label className="text-xs text-muted">
                    Qty
                    <input
                      type="number"
                      inputMode="decimal"
                      value={l.quantity}
                      onChange={(e) =>
                        updateLine(l.key, { quantity: Number(e.target.value) })
                      }
                      className="mt-0.5 w-full rounded-lg border border-line px-2 py-1.5 text-sm"
                    />
                  </label>
                  <label className="text-xs text-muted">
                    Unit
                    <UnitSelect
                      value={l.unit}
                      onChange={(code) => updateLine(l.key, { unit: code })}
                      className="mt-0.5 w-full rounded-lg border border-line px-2 py-1.5 text-sm bg-surface"
                    />
                    <span className="mt-0.5 block text-[10px] text-muted/80">defaults to the product&rsquo;s approved unit</span>
                  </label>
                  <label className="text-xs text-muted">
                    Unit price
                    <input
                      type="number"
                      inputMode="decimal"
                      value={l.unitPrice ?? ""}
                      onChange={(e) =>
                        updateLine(l.key, {
                          unitPrice: e.target.value === "" ? null : Number(e.target.value),
                        })
                      }
                      className="mt-0.5 w-full rounded-lg border border-line px-2 py-1.5 text-sm"
                    />
                  </label>
                </div>

                {/* Invoice mode keeps the raw line text visible/editable. */}
                {!manualMode ? (
                  <label className="mt-2 block text-xs text-muted">
                    Invoice line text
                    <input
                      value={l.descriptionRaw}
                      onChange={(e) => updateLine(l.key, { descriptionRaw: e.target.value })}
                      className="mt-0.5 w-full rounded-lg border border-line px-2 py-1.5 text-sm"
                    />
                  </label>
                ) : null}
              </Card>
            );
          })}
        </div>

        <button
          onClick={addLine}
          className="w-full rounded-xl border border-brand-300 bg-surface py-3 text-sm font-semibold text-brand-700 shadow-sm hover:bg-brand-50 transition-colors flex items-center justify-center gap-2"
        >
          <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2}>
            <path d="M12 5v14M5 12h14" strokeLinecap="round" />
          </svg>
          Add {manualMode ? "another product" : "line"}
        </button>

        {/* ---- Check-In assistant ---------------------------------------- */}
        <Card className="p-0 overflow-hidden">
          <button
            onClick={() => setChatOpen((o) => !o)}
            className="flex w-full items-center gap-2 px-4 py-3 text-left"
            aria-expanded={chatOpen}
          >
            <span className="grid h-6 w-6 flex-none place-items-center rounded-full bg-emerald-grad text-white">
              <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="currentColor" aria-hidden="true">
                <path d="M12 3l1.7 5.6L19 10l-5.3 1.4L12 17l-1.7-5.6L5 10l5.3-1.4L12 3z" />
              </svg>
            </span>
            <span className="text-sm font-medium text-ink">Ask the assistant to fix this invoice</span>
            <span className="ml-auto text-xs text-muted">
              {mode === "claude" ? "AI live" : "AI off"}
            </span>
            <svg viewBox="0 0 24 24" className={`h-4 w-4 text-muted transition-transform ${chatOpen ? "rotate-180" : ""}`} fill="none" stroke="currentColor" strokeWidth={2} aria-hidden="true">
              <path d="M6 9l6 6 6-6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>

          {chatOpen ? (
            <div className="border-t border-line">
              <div className="max-h-72 space-y-3 overflow-y-auto p-4">
                {chatMessages.length === 0 ? (
                  <p className="text-[13px] leading-relaxed text-muted">
                    Tell me what to change in plain words and I&rsquo;ll revise the lines below for you to review &mdash; e.g. &ldquo;the 3rd line is Termidor SC, qty is 4 cases not 48 units,&rdquo; &ldquo;drop the freight line,&rdquo; or &ldquo;put this in the Stuart warehouse.&rdquo; I never check anything in &mdash; you still press Confirm.
                  </p>
                ) : null}
                {chatMessages.map((m, i) => (
                  <div key={i} className={`flex gap-2.5 ${m.role === "user" ? "flex-row-reverse" : ""}`}>
                    <span className={`grid h-7 w-7 flex-none place-items-center rounded-full ${m.role === "user" ? "bg-brand-100 text-brand-700 text-[11px] font-semibold" : "bg-emerald-grad text-white"}`}>
                      {m.role === "user" ? "You" : (
                        <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="currentColor" aria-hidden="true"><path d="M12 3l1.7 5.6L19 10l-5.3 1.4L12 17l-1.7-5.6L5 10l5.3-1.4L12 3z" /></svg>
                      )}
                    </span>
                    <div className={`max-w-[85%] rounded-2xl px-3 py-2 text-[13.5px] leading-relaxed ${m.role === "user" ? "bg-brand-700 text-white rounded-tr-sm" : "bg-canvas border border-line text-ink rounded-tl-sm"}`}>{m.content}</div>
                  </div>
                ))}
                {chatSending ? <div className="pl-10 text-xs text-muted">Thinking&hellip;</div> : null}
              </div>
              <div className="flex items-center gap-2 border-t border-line p-3">
                <input
                  value={chatInput}
                  onChange={(e) => setChatInput(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && sendChat()}
                  disabled={chatSending}
                  placeholder="Describe a correction…"
                  className="min-w-0 flex-1 rounded-xl border border-line bg-canvas px-3 py-2.5 text-sm disabled:opacity-60"
                />
                <button
                  onClick={sendChat}
                  disabled={chatSending || !chatInput.trim()}
                  aria-label="Send"
                  className="grid h-10 w-10 flex-none place-items-center rounded-xl bg-emerald-grad text-white disabled:opacity-50"
                >
                  <svg viewBox="0 0 24 24" className="h-[18px] w-[18px]" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M12 19V5" /><path d="M6 11l6-6 6 6" />
                  </svg>
                </button>
              </div>
            </div>
          ) : null}
        </Card>

        {error ? <p className="text-sm text-red-600">{error}</p> : null}

        <div className="flex gap-2">
          <button onClick={reset} className={btn.secondary}>
            {manualMode ? "Cancel" : "Start over"}
          </button>
          <button
            onClick={confirm}
            disabled={busy}
            className={`${btn.primary} flex-1`}
          >
            {busy ? "Posting…" : "Confirm check-in"}
          </button>
        </div>
      </div>
    );
  }

  // ---- Upload ---------------------------------------------------------
  return (
    <div className="space-y-4">
      <div
        className={`rounded-xl border-2 border-dashed p-6 text-center bg-surface ${
          file ? "border-brand-400" : "border-line"
        }`}
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          const f = e.dataTransfer.files?.[0];
          if (f) setFile(f);
        }}
      >
        <input
          ref={fileRef}
          type="file"
          accept="application/pdf,image/*"
          className="hidden"
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
        />
        <div className="mx-auto mb-2 grid h-12 w-12 place-items-center rounded-full bg-brand-50 text-brand-600">
          <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth={1.8}>
            <path d="M12 16V4m0 0L8 8m4-4l4 4M4 17v2a2 2 0 002 2h12a2 2 0 002-2v-2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </div>
        {file ? (
          <p className="text-sm font-medium">{file.name}</p>
        ) : (
          <p className="text-sm text-muted">
            Drag a PDF or photo here, or choose a file below.
          </p>
        )}
        <div className="mt-3 flex justify-center gap-2">
          <button onClick={() => fileRef.current?.click()} className={btn.secondary}>
            Choose file
          </button>
        </div>
      </div>

      <div className="rounded-lg bg-slate-100 px-3 py-2 text-xs text-muted">
        Invoice reader:{" "}
        <span className="font-medium">
          {mode === "claude" ? "Claude vision (live)" : "Mock parser (no API key set)"}
        </span>
        . Nothing is posted until you review and confirm.
      </div>

      {error ? <p className="text-sm text-red-600">{error}</p> : null}

      <button
        onClick={readInvoice}
        disabled={!file || busy}
        className={`${btn.primary} w-full`}
      >
        {busy ? "Reading invoice…" : "Read invoice"}
      </button>

      <div className="flex items-center gap-3 text-xs text-muted">
        <span className="h-px flex-1 bg-line" />
        or
        <span className="h-px flex-1 bg-line" />
      </div>

      <button onClick={startManual} disabled={busy} className={`${btn.secondary} w-full`}>
        Manual check-in (enter products by hand)
      </button>
      <p className="text-center text-xs text-muted">
        No invoice on hand? Add products and quantities manually — pick existing products or create new ones.
      </p>
    </div>
  );
}
