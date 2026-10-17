"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Card, btn } from "@/components/ui";

export default function PreHireActions({
  id,
  path,
  employeeId,
  canReview,
  showLink,
}: {
  id: string;
  path: string; // "/onboarding/<token>"
  employeeId: string | null;
  canReview: boolean;
  showLink: boolean;
}) {
  const router = useRouter();
  const [fullLink, setFullLink] = useState(path);
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Build an absolute link once mounted (APP_URL may be unset in dev).
  useEffect(() => {
    setFullLink(`${window.location.origin}${path}`);
  }, [path]);

  async function post(action: string, extra?: Record<string, unknown>) {
    setBusy(action); setError(null); setMsg(null);
    const res = await fetch("/api/prehire", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, id, ...extra }),
    });
    const data = await res.json().catch(() => ({}));
    setBusy(null);
    if (!res.ok) { setError(data.error ?? "Something went wrong."); return null; }
    return data;
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(fullLink);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      setError("Could not copy — select and copy the link manually.");
    }
  }

  async function resend() {
    const data = await post("resend");
    if (data) setMsg(data.emailStatus === "sent" ? "Link re-sent by email." : `Link ready (email ${String(data.emailStatus).replace(/_/g, " ")}).`);
  }

  async function approve() {
    if (!confirm("Approve this candidate and convert them into an active employee?")) return;
    const data = await post("approve");
    if (data?.employeeId) router.push(`/management/people/${data.employeeId}`);
  }

  async function reject() {
    if (!confirm("Reject this pre-hire? They will not be converted to an employee.")) return;
    const data = await post("reject");
    if (data) router.refresh();
  }

  const [grantLevel, setGrantLevel] = useState("technician");
  async function grantWelcome() {
    if (!employeeId) return;
    if (!confirm("Grant this new hire a portal login and send a welcome? This also (re)assigns the onboarding course set.")) return;
    const data = await post("grant_welcome", { employeeId, accessLevel: grantLevel });
    if (data) setMsg(`Login ready for ${data.email}${data.created ? "" : " (existing account)"} — welcome sent by email + Inbox.`);
  }

  if (!showLink && !canReview && !employeeId) return null;

  return (
    <Card className="p-4 space-y-3">
      {showLink ? (
        <div>
          <div className="text-sm font-medium text-ink mb-1.5">Candidate magic link</div>
          <div className="flex flex-wrap items-center gap-2">
            <input readOnly value={fullLink} onFocus={(e) => e.target.select()} className="flex-1 min-w-[12rem] rounded-lg border border-line px-3 py-2 text-xs text-ink bg-surface" />
            <button onClick={copy} className={btn.secondary}>{copied ? "Copied!" : "Copy link"}</button>
            <button onClick={resend} disabled={busy === "resend"} className={btn.secondary}>{busy === "resend" ? "Sending…" : "Resend email"}</button>
          </div>
          <p className="mt-1 text-[11px] text-muted">No login required — this link is the candidate&rsquo;s access to their onboarding packet.</p>
        </div>
      ) : null}

      {canReview ? (
        <div className="flex flex-wrap gap-2 border-t border-line pt-3">
          <button onClick={approve} disabled={busy === "approve"} className={`${btn.primary}`}>{busy === "approve" ? "Converting…" : "Approve & convert to employee"}</button>
          <button onClick={reject} disabled={busy === "reject"} className={btn.danger}>{busy === "reject" ? "…" : "Reject"}</button>
        </div>
      ) : null}

      {employeeId ? (
        <div className="border-t border-line pt-3">
          <div className="text-sm font-medium text-ink mb-1.5">New-hire handoff</div>
          <p className="text-xs text-muted mb-2">Give this hire a portal login and send a welcome. Onboarding courses are assigned on conversion; this re-checks them and emails sign-in details.</p>
          <div className="flex flex-wrap items-center gap-2">
            <select value={grantLevel} onChange={(e) => setGrantLevel(e.target.value)} className="rounded-lg border border-line px-2.5 py-2 text-sm bg-surface">
              <option value="technician">Technician</option>
              <option value="csr">CSR</option>
              <option value="sales">Service Advisor</option>
              <option value="manager">Manager</option>
            </select>
            <button onClick={grantWelcome} disabled={busy === "grant_welcome"} className={btn.secondary}>
              {busy === "grant_welcome" ? "Setting up…" : "Grant login & send welcome"}
            </button>
          </div>
        </div>
      ) : null}

      {msg ? <p className="text-sm text-emerald-700">{msg}</p> : null}
      {error ? <p className="text-sm text-red-600">{error}</p> : null}
    </Card>
  );
}
