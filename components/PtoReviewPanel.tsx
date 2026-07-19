"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Card } from "@/components/ui";
import Glyph from "@/components/Glyph";

type Overlap = {
  others: { name: string; status: "approved" | "pending"; type: string }[];
  offCount: number;
  headcount: number;
};

type Pending = {
  id: string;
  employeeName: string;
  branchLabel: string | null;
  days: number;
  type: string;
  startDate: string;
  endDate: string;
  note: string | null;
  /** Decide-in-context: who else on the branch is off during this range. */
  overlap?: Overlap;
  /** Link to the calendar for this request's start month (built by the page). */
  calendarHref?: string;
};

function fmt(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
}

export default function PtoReviewPanel({ pending, showBranch = false }: { pending: Pending[]; showBranch?: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [noteFor, setNoteFor] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function decide(id: string, approve: boolean) {
    setBusy(id); setError(null);
    const res = await fetch("/api/pto", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "decide", id, approve, note: noteFor === id ? note : undefined }) });
    const data = await res.json().catch(() => ({}));
    setBusy(null);
    if (!res.ok) return setError(data.error ?? "Could not save.");
    setNoteFor(null); setNote("");
    router.refresh();
  }

  return (
    <Card className={`p-0 overflow-hidden mb-5 ${pending.length ? "ring-1 ring-amber-200" : ""}`}>
      <div className="px-4 py-3 border-b border-line flex items-center gap-2">
        <span className="grid h-7 w-7 place-items-center rounded-lg bg-amber-50 text-amber-600"><Glyph name="calendar" className="h-4 w-4" /></span>
        <div className="text-sm font-medium text-ink">PTO requests{pending.length ? ` · ${pending.length} to review` : ""}</div>
      </div>
      {pending.length === 0 ? (
        <p className="px-4 py-8 text-center text-sm text-muted">No PTO requests waiting for review.</p>
      ) : (
        <ul className="divide-y divide-line">
          {pending.map((r) => (
            <li key={r.id} className="px-4 py-3">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="text-sm font-medium text-ink">
                    {r.employeeName}
                    {showBranch && r.branchLabel ? <span className="ml-2 text-[11px] font-normal text-muted">{r.branchLabel}</span> : null}
                  </div>
                  <div className="text-xs text-muted mt-0.5">
                    {r.days} {r.type} day{r.days === 1 ? "" : "s"} · {fmt(r.startDate)}{r.days > 1 ? ` – ${fmt(r.endDate)}` : ""}
                    {r.note ? ` · “${r.note}”` : ""}
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <button onClick={() => decide(r.id, true)} disabled={busy === r.id} className="rounded-lg bg-emerald-grad px-3 py-1.5 text-xs font-medium text-[#05271c] disabled:opacity-50">Approve</button>
                  <button onClick={() => decide(r.id, false)} disabled={busy === r.id} className="rounded-lg border border-red-200 bg-white px-3 py-1.5 text-xs font-medium text-red-600 hover:bg-red-50 disabled:opacity-50">Deny</button>
                  <button onClick={() => { setNoteFor(noteFor === r.id ? null : r.id); setNote(""); }} className="text-xs text-muted hover:text-ink">Note</button>
                </div>
              </div>
              <OverlapReadout r={r} />
              {noteFor === r.id ? (
                <input
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder="Optional note to the employee (sent with the decision)"
                  className="mt-2 w-full rounded-lg border border-line px-3 py-2 text-sm"
                />
              ) : null}
            </li>
          ))}
        </ul>
      )}
      {error ? <p className="px-4 pb-3 text-sm text-red-600">{error}</p> : null}
    </Card>
  );
}

/** Decide-in-context: shows who else on the branch is off during this range,
 *  plus a coverage count and a jump to the calendar. Purely presentational. */
function OverlapReadout({ r }: { r: Pending }) {
  const o = r.overlap;
  const staff = r.branchLabel ?? "branch";
  const heavy = !!o && o.headcount > 0 && o.offCount * 2 >= o.headcount;
  return (
    <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1">
      {o ? (
        o.others.length === 0 ? (
          <span className="text-xs text-emerald-600">No overlap — no one else off in this range.</span>
        ) : (
          <span className={`text-xs ${heavy ? "text-amber-600 font-medium" : "text-muted"}`}>
            Overlap:{" "}
            {o.others.map((p, i) => (
              <span key={p.name + i}>
                {i > 0 ? ", " : ""}
                {p.name} <span className="opacity-70">({p.status})</span>
              </span>
            ))}
            {o.headcount > 0 ? <> · {o.offCount} of {o.headcount} {staff} staff out that week.</> : null}
          </span>
        )
      ) : null}
      {r.calendarHref ? (
        <Link href={r.calendarHref} className="text-xs font-medium text-brand-700 hover:underline">View on calendar →</Link>
      ) : null}
    </div>
  );
}
