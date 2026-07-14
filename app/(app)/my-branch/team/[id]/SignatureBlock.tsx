"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { signatureRoles } from "@/lib/personnel";

type Sig = { id: string; role: string; signerName: string; signedAt: string | Date };
type Reqs = { id: string; role: string; email: string };

export default function SignatureBlock({
  recordId, type, signatures, requests = [], employeeEmail = "",
}: {
  recordId: string; type: string; signatures: Sig[]; requests?: Reqs[]; employeeEmail?: string;
}) {
  const router = useRouter();
  const roles = signatureRoles(type);
  const [openSign, setOpenSign] = useState<string | null>(null);
  const [openSend, setOpenSend] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [ack, setAck] = useState(false);
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (roles.length === 0) return null;
  const signed = new Map(signatures.map((s) => [s.role, s]));
  const pending = new Map(requests.map((r) => [r.role, r]));

  async function sign(role: string) {
    if (!name.trim()) return setError("Type the signer's full name.");
    if (!ack) return setError("Confirm the acknowledgment to sign.");
    setBusy(true); setError(null);
    const res = await fetch("/api/personnel/sign", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ recordId, role, signerName: name }) });
    setBusy(false);
    if (!res.ok) { const d = await res.json().catch(() => ({})); return setError(d.error ?? "Sign failed."); }
    setOpenSign(null); setName(""); setAck(false); router.refresh();
  }

  async function sendLink(role: string) {
    if (!email.trim()) return setError("Enter the signer's email.");
    setBusy(true); setError(null);
    const res = await fetch("/api/personnel/sign/request", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ recordId, role, email }) });
    const data = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) return setError(data.error ?? "Could not send link.");
    setOpenSend(null); setEmail(""); router.refresh();
  }

  return (
    <div className="mt-2 rounded-lg border border-line p-2.5">
      <div className="text-[11px] font-semibold uppercase tracking-wide text-muted mb-1.5">Signatures</div>
      <div className="space-y-1.5">
        {roles.map((r) => {
          const s = signed.get(r.key);
          const req = pending.get(r.key);
          const signOpen = openSign === r.key;
          const sendOpen = openSend === r.key;
          return (
            <div key={r.key} className="text-sm">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="w-32 shrink-0 text-muted">{r.label}</span>
                {s ? (
                  <span className="flex-1 text-ink">✅ {s.signerName} <span className="text-xs text-muted">· {new Date(s.signedAt).toLocaleDateString()}</span></span>
                ) : (
                  <span className="flex-1 flex items-center gap-3">
                    <button onClick={() => { setOpenSign(signOpen ? null : r.key); setOpenSend(null); setError(null); }} className="text-xs font-medium text-brand-700 hover:underline">{signOpen ? "Cancel" : "Sign here"}</button>
                    <button onClick={() => { setOpenSend(sendOpen ? null : r.key); setOpenSign(null); setError(null); setEmail(r.key === "employee" ? employeeEmail : ""); }} className="text-xs font-medium text-brand-700 hover:underline">{sendOpen ? "Cancel" : "Email link"}</button>
                    {req ? <span className="text-[11px] text-amber-600">link sent → {req.email}</span> : null}
                  </span>
                )}
              </div>

              {signOpen ? (
                <div className="mt-1.5 ml-32 rounded-lg bg-black/[0.02] p-2 space-y-2">
                  <p className="text-[11px] text-muted italic">&ldquo;{r.statement}&rdquo;</p>
                  <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Type full name to sign" className="w-full rounded-lg border border-line px-2 py-1.5 text-sm" />
                  <label className="flex items-center gap-2 text-xs text-ink"><input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} />I have read and agree to the statement above.</label>
                  {error ? <p className="text-xs text-red-600">{error}</p> : null}
                  <button onClick={() => sign(r.key)} disabled={busy} className="rounded-lg bg-brand-600 px-3 py-1 text-xs font-medium text-white hover:bg-brand-700 disabled:opacity-50">{busy ? "Signing…" : "Apply signature"}</button>
                </div>
              ) : null}

              {sendOpen ? (
                <div className="mt-1.5 ml-32 rounded-lg bg-black/[0.02] p-2 space-y-2">
                  <p className="text-[11px] text-muted">Emails a secure link to review &amp; e-sign remotely. Daily reminders until signed.</p>
                  <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="signer@email.com" className="w-full rounded-lg border border-line px-2 py-1.5 text-sm" />
                  {error ? <p className="text-xs text-red-600">{error}</p> : null}
                  <button onClick={() => sendLink(r.key)} disabled={busy} className="rounded-lg bg-brand-600 px-3 py-1 text-xs font-medium text-white hover:bg-brand-700 disabled:opacity-50">{busy ? "Sending…" : req ? "Resend link" : "Send link"}</button>
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}
