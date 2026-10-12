"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Card, btn } from "@/components/ui";

// The Document Intake workbench: upload any file on the left, converse with
// Claude on the right. Claude reads the file and proposes where it routes; the
// manager approves (or edits) before anything is filed. No emoji — SVG icons.

type VehicleOpt = { id: string; label: string };
type BranchOpt = { key: string; label: string };
type PlanLine = { label: string; value: string; warn?: boolean };
type Params = Record<string, string | boolean | null>;
type Proposal = { destination: string; params: Params; plan: PlanLine[]; handoff: boolean };
type Analysis = { kind: string; title: string; summary: string; fields: Record<string, string>; source: "claude" | "mock" };
type Draft = { doc: { id: string; filePath: string | null; fileName: string; fileSize: number }; analysis: Analysis; mode: string };
type Msg = { role: "user" | "assistant"; content: string };

const DESTINATIONS = [
  { key: "vehicle_document", label: "Fleet · vehicle document" },
  { key: "branch_document", label: "Branch document" },
  { key: "mbr_handoff", label: "MBR review (hand-off)" },
  { key: "inventory_checkin", label: "Inventory check-in (receive stock)" },
  { key: "general_file", label: "Filed in intake (with tags)" },
];
const VEHICLE_CATS = ["insurance", "registration", "title", "inspection", "other"];
const BRANCH_CATS = ["licensing", "lease", "other"];
const FIELD_LABELS: Record<string, string> = {
  vendor: "Vendor / insurer", doc_number: "Document #", amount: "Amount", effective_date: "Effective",
  expiration_date: "Expires", period: "Period", vehicle_hint: "Vehicle", driver_hint: "Driver", branch_hint: "Branch",
};

function Icon({ d, className = "h-4 w-4", fill = false }: { d: string; className?: string; fill?: boolean }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill={fill ? "currentColor" : "none"} stroke={fill ? "none" : "currentColor"} strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {d.split("|").map((p, i) => <path key={i} d={p} />)}
    </svg>
  );
}
const I = {
  upload: "M12 15V4|M8 8l4-4 4 4|M4 14v5a1 1 0 001 1h14a1 1 0 001-1v-5",
  spark: "M12 3l1.7 5.6L19 10l-5.3 1.4L12 17l-1.7-5.6L5 10l5.3-1.4L12 3z",
  check: "M5 12.5l4.5 4.5L19 7",
  send: "M12 19V5|M6 11l6-6 6 6",
  arrow: "M5 12h13|M13 6l6 6-6 6",
  file: "M7 3h7l5 5v13H5V5a2 2 0 012-2z|M14 3v5h5",
};

function bytes(n: number) {
  return n < 1024 ? `${n} B` : n < 1048576 ? `${Math.round(n / 1024)} KB` : `${(n / 1048576).toFixed(1)} MB`;
}

export default function IntakeWorkbench({ vehicles, branches }: { vehicles: VehicleOpt[]; branches: BranchOpt[]; readerMode: string }) {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [proposal, setProposal] = useState<Proposal | null>(null);
  const [params, setParams] = useState<Params>({});
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [filing, setFiling] = useState(false);
  const [filed, setFiled] = useState<{ label: string; redirect: string | null; handoff: boolean } | null>(null);

  async function onFile(file: File) {
    setBusy(true); setError(null); reset();
    const fd = new FormData(); fd.append("file", file);
    const res = await fetch("/api/intake", { method: "POST", body: fd });
    const data = await res.json().catch(() => ({}));
    setBusy(false);
    if (fileRef.current) fileRef.current.value = "";
    if (!res.ok) return setError(data.error ?? "Upload failed.");
    setDraft({ doc: data.doc, analysis: data.analysis, mode: data.mode });
    const opening = data.opening as { reply: string; proposal: Proposal | null };
    setMessages([{ role: "assistant", content: opening.reply }]);
    applyProposal(opening.proposal);
  }

  function reset() {
    setDraft(null); setMessages([]); setProposal(null); setParams({}); setFiled(null); setInput("");
  }
  function applyProposal(p: Proposal | null) {
    setProposal(p);
    setParams(p ? { ...p.params } : {});
  }

  async function send() {
    const text = input.trim();
    if (!text || !draft || sending) return;
    const history = messages;
    setMessages((m) => [...m, { role: "user", content: text }]);
    setInput(""); setSending(true); setError(null);
    const res = await fetch("/api/intake/chat", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ docId: draft.doc.id, history, message: text }),
    });
    const data = await res.json().catch(() => ({}));
    setSending(false);
    if (!res.ok) { setMessages((m) => [...m, { role: "assistant", content: data.error ?? "Something went wrong — try again." }]); return; }
    setMessages((m) => [...m, { role: "assistant", content: data.reply }]);
    if (data.proposal) applyProposal(data.proposal);
  }

  async function approve() {
    if (!draft || !proposal || filing) return;
    setFiling(true); setError(null);
    const res = await fetch("/api/intake/file", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ docId: draft.doc.id, destination: proposal.destination, params }),
    });
    const data = await res.json().catch(() => ({}));
    setFiling(false);
    if (!res.ok) return setError(data.error ?? "Could not file this document.");
    setFiled({ label: data.label, redirect: data.redirect, handoff: data.handoff });
    setProposal(null);
    router.refresh();
  }

  const setP = (k: string, v: string | boolean | null) => setParams((p) => ({ ...p, [k]: v }));
  const pv = (k: string) => (params[k] == null ? "" : String(params[k]));

  return (
    <Card className="p-0 overflow-hidden">
      <div className="grid md:grid-cols-[0.92fr_1.08fr] md:divide-x divide-line">
        {/* ---- File pane ---- */}
        <div className="border-b md:border-b-0 border-line">
          <div className="flex items-center gap-2 px-4 py-3 border-b border-line text-[13px] font-medium text-ink">
            <Icon d={I.upload} className="h-4 w-4 text-brand-600" /> Uploaded file
          </div>

          {!draft ? (
            <div className="p-4">
              <button onClick={() => fileRef.current?.click()} disabled={busy}
                className="w-full rounded-xl border border-dashed border-brand-300 bg-brand-50 px-4 py-8 text-center hover:bg-brand-100/60 disabled:opacity-60 transition-colors">
                <Icon d={I.upload} className="mx-auto h-6 w-6 text-brand-600" />
                <div className="mt-2 text-sm font-medium text-ink">{busy ? "Reading…" : "Choose a file"}</div>
                <div className="mt-0.5 text-xs text-muted">PDF, image, or another document — the AI reads it and suggests where it goes</div>
              </button>
              <input ref={fileRef} type="file" className="hidden" onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])} />
              {error ? <p className="mt-3 text-sm text-red-600">{error}</p> : null}
            </div>
          ) : (
            <div className="p-4 space-y-3">
              <div className="flex gap-3">
                <div className="grid h-12 w-12 flex-none place-items-center rounded-lg border border-line bg-surface text-brand-600"><Icon d={I.file} className="h-6 w-6" /></div>
                <div className="min-w-0">
                  <div className="text-sm font-medium text-ink break-words">{draft.doc.fileName}</div>
                  <div className="text-xs text-muted">{bytes(draft.doc.fileSize)}</div>
                  <span className={`mt-2 inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium ${draft.mode === "mock" ? "bg-amber-100 text-amber-700" : "bg-brand-100 text-brand-700"}`}>
                    <Icon d={I.spark} className="h-3 w-3" fill /> {draft.mode === "mock" ? "Reader off — tell me about it" : "Read by Claude"}
                  </span>
                </div>
              </div>
              {Object.keys(draft.analysis.fields).length > 0 ? (
                <div className="rounded-xl border border-line bg-surface p-3">
                  <div className="mb-2 text-[10.5px] font-medium uppercase tracking-wide text-muted">What Claude pulled out</div>
                  <dl className="grid grid-cols-[110px_1fr] gap-x-2.5 gap-y-1 text-[13px]">
                    {Object.entries(draft.analysis.fields).map(([k, v]) => (
                      <div key={k} className="contents"><dt className="text-muted">{FIELD_LABELS[k] ?? k}</dt><dd className="text-ink break-words">{v}</dd></div>
                    ))}
                  </dl>
                </div>
              ) : null}
              <button onClick={reset} className="text-xs font-medium text-brand-700 hover:underline">Upload a different file</button>
            </div>
          )}
        </div>

        {/* ---- Chat pane ---- */}
        <div className="flex flex-col min-h-[460px]">
          <div className="flex items-center gap-2 px-4 py-3 border-b border-line text-[13px] font-medium text-ink">
            <span className="grid h-5 w-5 place-items-center rounded-full bg-emerald-grad text-white"><Icon d={I.spark} className="h-3 w-3" fill /></span>
            Claude
            <span className="ml-auto text-xs font-normal text-muted">reads · proposes · you approve</span>
          </div>

          <div className="flex-1 space-y-3.5 overflow-y-auto p-4">
            {!draft ? (
              <p className="text-sm text-muted">Upload a file and I&rsquo;ll tell you what it is and where it should go. You can also just tell me in your own words — &ldquo;this is the renewal for truck 12, remind HR before it expires.&rdquo;</p>
            ) : null}

            {messages.map((m, i) => (
              <div key={i} className={`flex gap-2.5 ${m.role === "user" ? "flex-row-reverse" : ""}`}>
                <span className={`grid h-7 w-7 flex-none place-items-center rounded-full ${m.role === "user" ? "bg-brand-100 text-brand-700 text-[11px] font-semibold" : "bg-emerald-grad text-white"}`}>
                  {m.role === "user" ? "You" : <Icon d={I.spark} className="h-3.5 w-3.5" fill />}
                </span>
                <div className={`max-w-[85%] rounded-2xl px-3 py-2 text-[13.5px] leading-relaxed ${m.role === "user" ? "bg-brand-700 text-white rounded-tr-sm" : "bg-canvas border border-line text-ink rounded-tl-sm"}`}>{m.content}</div>
              </div>
            ))}

            {sending ? <div className="pl-10 text-xs text-muted">Claude is thinking…</div> : null}

            {/* Action card */}
            {proposal && !filed ? (
              <div className="ml-10 overflow-hidden rounded-2xl border border-brand-600 bg-surface">
                <div className="flex items-center gap-2 border-b border-brand-100 bg-brand-50 px-3.5 py-2.5">
                  <Icon d={I.spark} className="h-3.5 w-3.5 text-brand-600" fill />
                  <span className="text-[12.5px] font-medium text-brand-700">Claude wants to route this</span>
                  <span className="ml-auto rounded-full border border-brand-100 bg-white px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-brand-600">{proposal.handoff ? "Hand-off" : "Agentic"}</span>
                </div>
                <div className="space-y-2.5 p-3.5">
                  <label className="block text-xs font-medium text-ink">Destination
                    <select value={proposal.destination} onChange={(e) => applyProposal({ ...proposal, destination: e.target.value, params })}
                      className="mt-1 w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm">
                      {DESTINATIONS.map((d) => <option key={d.key} value={d.key}>{d.label}</option>)}
                    </select>
                  </label>

                  {proposal.destination === "vehicle_document" ? (
                    <>
                      <Field label="Vehicle" warn={!pv("vehicleId")}>
                        <select value={pv("vehicleId")} onChange={(e) => setP("vehicleId", e.target.value || null)} className="sel">
                          <option value="">— Select vehicle —</option>
                          {vehicles.map((v) => <option key={v.id} value={v.id}>{v.label}</option>)}
                        </select>
                      </Field>
                      <Row>
                        <Field label="Category"><select value={pv("category") || "other"} onChange={(e) => setP("category", e.target.value)} className="sel">{VEHICLE_CATS.map((c) => <option key={c} value={c}>{cap(c)}</option>)}</select></Field>
                        <Field label="Expires"><input type="date" value={pv("expirationDate")} onChange={(e) => setP("expirationDate", e.target.value || null)} className="sel" /></Field>
                      </Row>
                      <Field label="Title"><input value={pv("title")} onChange={(e) => setP("title", e.target.value)} className="sel" /></Field>
                      <label className="flex items-center gap-2 text-[13px] text-ink"><input type="checkbox" checked={params.remindHr !== false} onChange={(e) => setP("remindHr", e.target.checked)} /> Remind HR before it expires</label>
                    </>
                  ) : proposal.destination === "branch_document" ? (
                    <>
                      <Row>
                        <Field label="Branch" warn={!pv("branch")}><select value={pv("branch")} onChange={(e) => setP("branch", e.target.value || null)} className="sel"><option value="">— Select —</option>{branches.map((b) => <option key={b.key} value={b.key}>{b.label}</option>)}</select></Field>
                        <Field label="Category"><select value={pv("category") || "other"} onChange={(e) => setP("category", e.target.value)} className="sel">{BRANCH_CATS.map((c) => <option key={c} value={c}>{cap(c)}</option>)}</select></Field>
                      </Row>
                      <Field label="Title"><input value={pv("title")} onChange={(e) => setP("title", e.target.value)} className="sel" /></Field>
                      <Field label="Expires"><input type="date" value={pv("expirationDate")} onChange={(e) => setP("expirationDate", e.target.value || null)} className="sel" /></Field>
                    </>
                  ) : proposal.destination === "general_file" ? (
                    <>
                      <Row>
                        <Field label="Branch (optional)"><select value={pv("branch")} onChange={(e) => setP("branch", e.target.value || null)} className="sel"><option value="">Company-wide</option>{branches.map((b) => <option key={b.key} value={b.key}>{b.label}</option>)}</select></Field>
                        <Field label="Title"><input value={pv("title")} onChange={(e) => setP("title", e.target.value)} className="sel" /></Field>
                      </Row>
                      <Field label="Tags"><input value={pv("tags")} onChange={(e) => setP("tags", e.target.value || null)} placeholder="e.g. chemical, Univar" className="sel" /></Field>
                      <p className="text-[11px] text-amber-700">Filed as a record only — nothing is pushed into inventory or other modules.</p>
                    </>
                  ) : (
                    <div className="space-y-1.5">
                      {proposal.plan.map((l, i) => (
                        <div key={i} className="flex gap-2 text-[13px]"><span className="w-28 flex-none text-muted">{l.label}</span><span className={l.warn ? "text-amber-700" : "text-ink"}>{l.value}</span></div>
                      ))}
                    </div>
                  )}
                </div>
                <div className="flex flex-wrap gap-2 px-3.5 pb-3.5">
                  <button onClick={approve} disabled={filing} className={`${btn.primary} flex-1 min-w-[150px]`}>
                    <Icon d={I.check} className="h-4 w-4" /> {filing ? "Filing…" : proposal.handoff ? "Approve & open" : "Approve & file"}
                  </button>
                  <button onClick={() => applyProposal(null)} className={btn.secondary}>Not now</button>
                </div>
              </div>
            ) : null}

            {/* Filed confirmation */}
            {filed ? (
              <div className="ml-10 flex items-center gap-2.5 rounded-xl border border-emerald-200 bg-emerald-50 px-3.5 py-3 text-[13px] text-emerald-800">
                <span className="grid h-5 w-5 flex-none place-items-center rounded-full bg-emerald-600 text-white"><Icon d={I.check} className="h-3 w-3" /></span>
                <span className="flex-1">{filed.handoff ? `Ready in ${filed.label}.` : `Filed to ${filed.label}.`}</span>
                {filed.redirect ? <a href={filed.redirect} className="font-medium text-brand-700 hover:underline whitespace-nowrap">{filed.handoff ? "Open" : "View"} →</a> : null}
              </div>
            ) : null}

            {error && draft ? <p className="pl-10 text-sm text-red-600">{error}</p> : null}
          </div>

          {/* Composer */}
          <div className="flex items-center gap-2 border-t border-line p-3">
            <input value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={(e) => e.key === "Enter" && send()}
              disabled={!draft || sending} placeholder={draft ? "Explain what this is or where it should go…" : "Upload a file to start"}
              className="min-w-0 flex-1 rounded-xl border border-line bg-canvas px-3 py-2.5 text-sm disabled:opacity-60" />
            <button onClick={send} disabled={!draft || sending || !input.trim()} aria-label="Send"
              className="grid h-10 w-10 flex-none place-items-center rounded-xl bg-emerald-grad text-white disabled:opacity-50"><Icon d={I.send} className="h-[18px] w-[18px]" /></button>
          </div>
        </div>
      </div>
      <style>{`.sel{margin-top:4px;width:100%;border-radius:8px;border:1px solid var(--color-line);background:#fff;padding:8px 10px;font-size:13px}`}</style>
    </Card>
  );
}

function Field({ label, warn, children }: { label: string; warn?: boolean; children: React.ReactNode }) {
  return <label className={`block text-xs font-medium ${warn ? "text-amber-700" : "text-ink"}`}>{label}{children}</label>;
}
function Row({ children }: { children: React.ReactNode }) {
  return <div className="grid grid-cols-2 gap-2.5">{children}</div>;
}
function cap(s: string) { return s ? s[0].toUpperCase() + s.slice(1) : s; }
