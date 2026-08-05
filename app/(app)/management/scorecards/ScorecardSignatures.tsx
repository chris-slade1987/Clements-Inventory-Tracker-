"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export type SigLite = { id: string; role: string; typedName: string; title: string | null; signedAt: string };

// Attestation statements agreed to at signing (E-SIGN / UETA in-person capture).
const STATEMENT: Record<string, string> = {
  reviewer:
    "I certify that I reviewed this manager's quarterly performance, that the scorecard and comments accurately reflect that review, and that I discussed it with the manager.",
  manager:
    "I acknowledge that I have received and reviewed this quarterly scorecard with my supervisor. My signature indicates receipt and discussion — not necessarily agreement — of the ratings and comments above.",
};

// Two signers complete a review: the supervisor and the manager.
const SLOTS: { key: string; role: string; label: string }[] = [
  { key: "reviewer", role: "reviewer", label: "Supervisor" },
  { key: "manager", role: "manager", label: "Manager" },
];

export default function ScorecardSignatures({
  year, quarter, branch, signatures, canSign, locked,
}: {
  year: number; quarter: number; branch: string;
  signatures: SigLite[]; canSign: boolean; locked: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [title, setTitle] = useState("");
  const [ack, setAck] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const supervisor = signatures.find((s) => s.role === "reviewer");
  const manager = signatures.find((s) => s.role === "manager");
  const filled = (slotKey: string): SigLite | undefined =>
    slotKey === "reviewer" ? supervisor : manager;

  async function sign(role: string) {
    if (!name.trim()) return setError("Type the signer's full name.");
    if (!ack) return setError("Confirm the acknowledgment to sign.");
    setBusy(true); setError(null);
    const res = await fetch("/api/management/scorecard/review", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "sign", year, quarter, branch, role, typedName: name, title }),
    });
    setBusy(false);
    if (!res.ok) { const d = await res.json().catch(() => ({})); return setError(d.error ?? "Sign failed."); }
    setOpen(null); setName(""); setTitle(""); setAck(false); router.refresh();
  }

  return (
    <div className="mt-4 rounded-xl border border-line p-4">
      <div className="text-[11px] font-semibold uppercase tracking-wide text-muted mb-3">Signatures — supervisor &amp; manager</div>
      <div className="grid gap-3 sm:grid-cols-2">
        {SLOTS.map((slot) => {
          const s = filled(slot.key);
          const isOpen = open === slot.key;
          return (
            <div key={slot.key} className="rounded-lg border border-line p-3 break-inside-avoid">
              <div className="text-xs font-medium text-muted">{slot.label}</div>
              {s ? (
                <div className="mt-1">
                  <div className="font-medium text-ink" style={{ fontFamily: "cursive" }}>{s.typedName}</div>
                  {s.title ? <div className="text-[11px] text-muted">{s.title}</div> : null}
                  <div className="text-[11px] text-muted mt-1">✅ Signed {new Date(s.signedAt).toLocaleDateString()}</div>
                </div>
              ) : locked ? (
                <div className="mt-2 text-[11px] text-muted italic">Not signed</div>
              ) : canSign ? (
                <div className="mt-2">
                  {isOpen ? (
                    <div className="space-y-2 print:hidden">
                      <p className="text-[11px] text-muted italic">&ldquo;{STATEMENT[slot.role]}&rdquo;</p>
                      <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Type full name to sign" className="w-full rounded-lg border border-line px-2 py-1.5 text-sm" />
                      <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Title (optional)" className="w-full rounded-lg border border-line px-2 py-1.5 text-sm" />
                      <label className="flex items-start gap-2 text-[11px] text-ink"><input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} className="mt-0.5" />I have read and agree to the statement above.</label>
                      {error ? <p className="text-xs text-red-600">{error}</p> : null}
                      <div className="flex gap-2">
                        <button onClick={() => sign(slot.role)} disabled={busy} className="rounded-lg bg-brand-600 px-3 py-1 text-xs font-medium text-white hover:bg-brand-700 disabled:opacity-50">{busy ? "Signing…" : "Apply signature"}</button>
                        <button onClick={() => { setOpen(null); setError(null); }} className="rounded-lg px-2 py-1 text-xs text-muted hover:underline">Cancel</button>
                      </div>
                    </div>
                  ) : (
                    <button onClick={() => { setOpen(slot.key); setName(""); setTitle(""); setAck(false); setError(null); }} className="print:hidden text-xs font-medium text-brand-700 hover:underline">Sign here</button>
                  )}
                </div>
              ) : (
                <div className="mt-2 text-[11px] text-muted italic">Awaiting signature</div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
