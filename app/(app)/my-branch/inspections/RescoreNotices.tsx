"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Card } from "@/components/ui";

export type NoticeRow = { who: string; email: string | null; detail: string; alreadySent: boolean };

// Super-admin card: preview + send the one-time "inspection scoring revised"
// notices. Lists every technician (before -> after) and branch manager who will
// get one, flags anyone with no email on file, and shows the exact email copy.
export default function RescoreNotices({
  techs,
  managers,
  sampleTech,
  sampleManager,
}: {
  techs: NoticeRow[];
  managers: NoticeRow[];
  sampleTech: { subject: string; text: string } | null;
  sampleManager: { subject: string; text: string } | null;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<{ who: string; email: string | null; kind: string; status: string }[] | null>(null);

  const pending = [...techs, ...managers].filter((r) => !r.alreadySent);
  const noEmail = pending.filter((r) => !r.email).length;
  const allSent = pending.length === 0;

  async function send() {
    if (!window.confirm(`Email ${pending.length - noEmail} people now (${techs.filter((t) => !t.alreadySent).length} technicians, ${managers.filter((m) => !m.alreadySent).length} managers)? Anyone already sent a notice is skipped.`)) return;
    setBusy(true);
    setError(null);
    const res = await fetch("/api/fleet/inspection/rescore-notices", { method: "POST" });
    const out = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) return setError(out.error ?? "Send failed.");
    setResults(out.results ?? []);
    router.refresh();
  }

  const statusLabel = (s: string) =>
    s === "sent" ? "Sent" : s === "already_sent" ? "Already sent" : s === "skipped_no_address" ? "No email on file" : s === "skipped_no_provider" ? "Email not configured" : "Failed";

  return (
    <Card className="p-0 overflow-hidden mb-5">
      <div className="px-4 py-3 border-b border-line flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="text-sm font-medium text-ink">Scoring revised · notify technicians &amp; managers</div>
          <div className="text-xs text-muted">Super admins only. Meets now earns full points — {techs.length} technician{techs.length === 1 ? "" : "s"} had a grade change.</div>
        </div>
        {allSent ? (
          <span className="rounded-full bg-emerald-100 px-2.5 py-1 text-[11px] font-medium text-emerald-700">All notices sent</span>
        ) : (
          <button type="button" onClick={send} disabled={busy} className="rounded-xl bg-emerald-grad px-4 py-2.5 text-sm font-medium text-white shadow-sm disabled:opacity-50">
            {busy ? "Sending…" : `Send ${pending.length - noEmail} notice${pending.length - noEmail === 1 ? "" : "s"}`}
          </button>
        )}
      </div>

      <div className="grid gap-0 md:grid-cols-2">
        <RecipientList title={`Technicians (${techs.length})`} rows={techs} />
        <RecipientList title={`Branch managers (${managers.length})`} rows={managers} />
      </div>

      {noEmail > 0 ? (
        <p className="px-4 py-2 text-xs text-amber-700 border-t border-line">{noEmail} recipient{noEmail === 1 ? " has" : "s have"} no email on file and will be skipped — add the address on their profile, then press Send again.</p>
      ) : null}

      {sampleTech || sampleManager ? (
        <details className="border-t border-line px-4 py-3">
          <summary className="cursor-pointer text-xs font-medium text-brand-700">Preview the emails</summary>
          {sampleTech ? <Sample label="Technician email (example)" s={sampleTech} /> : null}
          {sampleManager ? <Sample label="Manager email (example)" s={sampleManager} /> : null}
        </details>
      ) : null}

      {error ? <p className="px-4 py-2 text-sm text-red-600 border-t border-line">{error}</p> : null}
      {results ? (
        <div className="border-t border-line px-4 py-3">
          <div className="text-xs font-medium text-ink">Send results</div>
          <ul className="mt-1 space-y-0.5 text-xs">
            {results.map((r, i) => (
              <li key={i} className="flex justify-between gap-2">
                <span className="text-ink">{r.who} <span className="text-muted">· {r.kind}</span></span>
                <span className={r.status === "sent" || r.status === "already_sent" ? "text-emerald-700" : "text-red-600"}>{statusLabel(r.status)}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </Card>
  );
}

function RecipientList({ title, rows }: { title: string; rows: NoticeRow[] }) {
  return (
    <div className="px-4 py-3 md:border-r border-line last:border-r-0">
      <div className="text-[11px] uppercase tracking-wider text-muted">{title}</div>
      <ul className="mt-1.5 space-y-1.5">
        {rows.map((r, i) => (
          <li key={i} className="text-sm">
            <div className="flex items-center justify-between gap-2">
              <span className="font-medium text-ink">{r.who}</span>
              {r.alreadySent ? (
                <span className="text-[11px] text-emerald-700">Sent</span>
              ) : !r.email ? (
                <span className="text-[11px] text-amber-700">No email</span>
              ) : null}
            </div>
            <div className="text-xs text-muted">{r.detail}</div>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Sample({ label, s }: { label: string; s: { subject: string; text: string } }) {
  return (
    <div className="mt-3">
      <div className="text-[11px] uppercase tracking-wider text-muted">{label}</div>
      <div className="mt-1 text-sm font-medium text-ink">{s.subject}</div>
      <pre className="mt-1 whitespace-pre-wrap rounded-lg bg-black/[0.03] p-3 font-sans text-xs text-ink">{s.text}</pre>
    </div>
  );
}
