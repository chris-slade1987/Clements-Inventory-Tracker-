"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { signatureRoles } from "@/lib/personnel";

type Sig = { id: string; role: string; signerName: string; signedAt: string | Date };

export default function SignatureBlock({ recordId, type, signatures }: { recordId: string; type: string; signatures: Sig[] }) {
  const router = useRouter();
  const roles = signatureRoles(type);
  const [open, setOpen] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [ack, setAck] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (roles.length === 0) return null;
  const signed = new Map(signatures.map((s) => [s.role, s]));

  async function sign(role: string) {
    if (!name.trim()) return setError("Type the signer's full name.");
    if (!ack) return setError("Confirm the acknowledgment to sign.");
    setBusy(true); setError(null);
    const res = await fetch("/api/personnel/sign", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ recordId, role, signerName: name }),
    });
    setBusy(false);
    if (!res.ok) { const d = await res.json().catch(() => ({})); return setError(d.error ?? "Sign failed."); }
    setOpen(null); setName(""); setAck(false);
    router.refresh();
  }

  return (
    <div className="mt-2 rounded-lg border border-line p-2.5">
      <div className="text-[11px] font-semibold uppercase tracking-wide text-muted mb-1.5">Signatures</div>
      <div className="space-y-1.5">
        {roles.map((r) => {
          const s = signed.get(r.key);
          const isOpen = open === r.key;
          return (
            <div key={r.key} className="text-sm">
              <div className="flex items-center gap-2">
                <span className="w-32 shrink-0 text-muted">{r.label}</span>
                {s ? (
                  <span className="flex-1 text-ink">✅ {s.signerName} <span className="text-xs text-muted">· {new Date(s.signedAt).toLocaleDateString()}</span></span>
                ) : (
                  <span className="flex-1">
                    <button onClick={() => { setOpen(isOpen ? null : r.key); setError(null); }} className="text-xs font-medium text-brand-700 hover:underline">{isOpen ? "Cancel" : "Sign →"}</button>
                  </span>
                )}
              </div>
              {isOpen ? (
                <div className="mt-1.5 ml-32 rounded-lg bg-black/[0.02] p-2 space-y-2">
                  <p className="text-[11px] text-muted italic">&ldquo;{r.statement}&rdquo;</p>
                  <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Type full name to sign" className="w-full rounded-lg border border-line px-2 py-1.5 text-sm" />
                  <label className="flex items-center gap-2 text-xs text-ink"><input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} />I have read and agree to the statement above.</label>
                  {error ? <p className="text-xs text-red-600">{error}</p> : null}
                  <button onClick={() => sign(r.key)} disabled={busy} className="rounded-lg bg-brand-600 px-3 py-1 text-xs font-medium text-white hover:bg-brand-700 disabled:opacity-50">{busy ? "Signing…" : "Apply signature"}</button>
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}
