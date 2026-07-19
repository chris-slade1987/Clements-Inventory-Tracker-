"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Card, btn } from "@/components/ui";
import DateInput from "@/components/DateInput";
import Glyph from "@/components/Glyph";

type Req = {
  id: string;
  startDate: string;
  endDate: string;
  days: number;
  type: string;
  status: string;
  note: string | null;
  decisionNote: string | null;
  reviewedByName: string | null;
};
type Balance = { allowance: number; used: number; remaining: number; pending: number };
type Opt = { key: string; label: string };

const STATUS_CHIP: Record<string, string> = {
  pending: "bg-amber-100 text-amber-700",
  approved: "bg-emerald-100 text-emerald-700",
  denied: "bg-red-100 text-red-700",
  cancelled: "bg-slate-100 text-slate-500",
};

// Business-day preview (Mon–Fri, inclusive) — mirrors lib/pto.countPtoDays.
function businessDays(startISO: string, endISO: string): number {
  if (!startISO || !endISO) return 0;
  const s = new Date(startISO + "T00:00:00Z");
  const e = new Date(endISO + "T00:00:00Z");
  if (isNaN(s.getTime()) || isNaN(e.getTime()) || e < s) return 0;
  let n = 0;
  for (const d = new Date(s); d <= e; d.setUTCDate(d.getUTCDate() + 1)) {
    const day = d.getUTCDay();
    if (day >= 1 && day <= 5) n++;
  }
  return n;
}

function fmt(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
}

export default function MyPtoPanel({ balance, requests, types }: { balance: Balance; requests: Req[]; types: Opt[] }) {
  const router = useRouter();
  const today = new Date().toISOString().slice(0, 10);
  const [f, setF] = useState({ start: "", end: "", type: "vacation", note: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const preview = useMemo(() => businessDays(f.start, f.end), [f.start, f.end]);

  async function submit() {
    if (!f.start || !f.end) return setError("Choose a start and end date.");
    if (preview < 1) return setError("That range has no working (Mon–Fri) days.");
    setBusy(true); setError(null);
    const res = await fetch("/api/pto", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "request", ...f }) });
    const data = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) return setError(data.error ?? "Could not submit.");
    setF({ start: "", end: "", type: "vacation", note: "" });
    router.refresh();
  }

  async function cancel(id: string) {
    await fetch("/api/pto", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "cancel", id }) });
    router.refresh();
  }

  const upcoming = requests.filter((r) => r.status === "approved" && new Date(r.endDate) >= new Date(today));

  return (
    <>
      {/* Balance tiles */}
      <div className="grid gap-3 grid-cols-2 lg:grid-cols-4 mb-5">
        <BalTile label="Allotted" value={balance.allowance} />
        <BalTile label="Used" value={balance.used} tone="warn" />
        <BalTile label="Remaining" value={balance.remaining} tone={balance.remaining <= 0 ? "bad" : "good"} />
        <BalTile label="Pending" value={balance.pending} sub={balance.pending ? "awaiting review" : undefined} />
      </div>

      {/* Request form */}
      <Card className="p-0 overflow-hidden mb-5">
        <div className="px-4 py-3 border-b border-line flex items-center gap-2">
          <span className="grid h-7 w-7 place-items-center rounded-lg bg-brand-50 text-brand-600"><Glyph name="calendar" className="h-4 w-4" /></span>
          <div className="text-sm font-medium text-ink">Request PTO</div>
        </div>
        <div className="p-4 space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <label className="block text-sm font-medium">Start date
              <DateInput className="mt-1" min={today} value={f.start} onChange={(v) => setF({ ...f, start: v, end: f.end && f.end < v ? v : f.end })} />
            </label>
            <label className="block text-sm font-medium">End date
              <DateInput className="mt-1" min={f.start || today} value={f.end} onChange={(v) => setF({ ...f, end: v })} />
            </label>
          </div>
          <label className="block text-sm font-medium">Type
            <select value={f.type} onChange={(e) => setF({ ...f, type: e.target.value })} className="mt-1 w-full rounded-lg border border-line px-3 py-2 text-sm bg-surface">
              {types.map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}
            </select>
          </label>
          <label className="block text-sm font-medium">Note (optional)
            <textarea value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} rows={2} placeholder="e.g. family trip" className="mt-1 w-full rounded-lg border border-line px-3 py-2 text-sm" />
          </label>
          <div className="flex items-center justify-between gap-3">
            <p className="text-sm text-muted">
              {preview > 0 ? <>This request is <span className="font-semibold text-ink">{preview}</span> working day{preview === 1 ? "" : "s"}.</> : "Pick a date range to see the day count."}
            </p>
            <button onClick={submit} disabled={busy} className={btn.primary}>{busy ? "Submitting…" : "Submit request"}</button>
          </div>
          {error ? <p className="text-sm text-red-600">{error}</p> : null}
        </div>
      </Card>

      {/* Upcoming approved */}
      {upcoming.length > 0 ? (
        <Card className="p-0 overflow-hidden mb-5 ring-1 ring-emerald-200">
          <div className="px-4 py-3 border-b border-line text-sm font-medium text-ink">Upcoming approved time off</div>
          <ul className="divide-y divide-line">
            {upcoming.map((r) => (
              <li key={r.id} className="flex items-center gap-3 px-4 py-2.5">
                <span className="h-2 w-2 shrink-0 rounded-full bg-emerald-500" />
                <span className="flex-1 text-sm text-ink">{fmt(r.startDate)}{r.days > 1 ? ` – ${fmt(r.endDate)}` : ""}</span>
                <span className="text-xs text-muted tabular-nums">{r.days} day{r.days === 1 ? "" : "s"}</span>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      {/* All requests */}
      <Card className="p-0 overflow-hidden">
        <div className="px-4 py-3 border-b border-line text-sm font-medium text-ink">My requests</div>
        {requests.length === 0 ? (
          <p className="px-4 py-8 text-center text-sm text-muted">No PTO requests yet. Submit one above.</p>
        ) : (
          <ul className="divide-y divide-line">
            {requests.map((r) => (
              <li key={r.id} className="flex items-start gap-3 px-4 py-3">
                <span className="flex-1">
                  <span className="flex items-center gap-2">
                    <span className="text-sm font-medium text-ink">{fmt(r.startDate)}{r.days > 1 ? ` – ${fmt(r.endDate)}` : ""}</span>
                    <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium capitalize ${STATUS_CHIP[r.status] ?? "bg-slate-100 text-slate-600"}`}>{r.status}</span>
                  </span>
                  <span className="block text-xs text-muted mt-0.5">
                    {r.days} {r.type} day{r.days === 1 ? "" : "s"}
                    {r.note ? ` · ${r.note}` : ""}
                    {r.status !== "pending" && r.reviewedByName ? ` · by ${r.reviewedByName}` : ""}
                    {r.decisionNote ? ` · “${r.decisionNote}”` : ""}
                  </span>
                </span>
                {r.status === "pending" ? (
                  <button onClick={() => cancel(r.id)} className="shrink-0 text-xs font-medium text-muted hover:text-red-600">Cancel</button>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </>
  );
}

function BalTile({ label, value, sub, tone }: { label: string; value: number; sub?: string; tone?: "good" | "warn" | "bad" }) {
  const color = tone === "bad" ? "text-red-600" : tone === "warn" ? "text-amber-600" : tone === "good" ? "text-brand-600" : "";
  return (
    <Card className="p-4">
      <div className="text-xs uppercase tracking-wider text-muted">{label}</div>
      <div className={`mt-1 text-2xl font-light tabular-nums ${color}`}>{value}</div>
      {sub ? <div className="text-xs text-muted mt-0.5">{sub}</div> : null}
    </Card>
  );
}
