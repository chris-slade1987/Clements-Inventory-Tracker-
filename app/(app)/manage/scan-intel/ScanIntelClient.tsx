"use client";

import { useState } from "react";
import { Card, EmptyState, btn } from "@/components/ui";
import { dateShort } from "@/lib/format";

type Stats = {
  totalScans: number;
  scored: number;
  correct: number;
  corrections: number;
  top1Accuracy: number | null;
  correctionRate: number | null;
  recentAccuracy: number | null;
  priorAccuracy: number | null;
  recentScored: number;
};
type Miss = {
  lineId: string;
  photoUrl: string | null;
  suggestedName: string;
  confirmedName: string;
  confidence: number | null;
  at: string;
  by: string | null;
  branch: string | null;
};
type Candidate = {
  lineId: string;
  productId: string;
  productName: string;
  photoUrl: string;
  existingPhotos: number;
  confidence: number | null;
  identifiedBy: string;
  at: string;
  by: string | null;
  branch: string | null;
};

const pct = (n: number | null) => (n == null ? "—" : `${Math.round(n * 100)}%`);
const conf = (n: number | null) => (n == null ? null : `${Math.round(n * 100)}%`);

export default function ScanIntelClient({
  stats,
  misses,
  queue,
}: {
  stats: Stats;
  misses: Miss[];
  queue: Candidate[];
}) {
  const [tab, setTab] = useState<"accuracy" | "promote">("accuracy");
  // Local copy so promote/dismiss removes a card without a full reload.
  const [candidates, setCandidates] = useState<Candidate[]>(queue);
  const [note, setNote] = useState<string | null>(null);

  function flash(msg: string) {
    setNote(msg);
    setTimeout(() => setNote(null), 3500);
  }

  return (
    <div className="space-y-5">
      <p className="text-sm text-muted">
        Check-Out&apos;s photo-identify compares a snapped photo against each product&apos;s curated reference
        photos. This page closes the loop: it scores how often the AI&apos;s top pick was right, shows where it
        struggles, and lets you turn good confirmed scans into new reference photos so identify keeps improving.
      </p>

      <div className="flex items-center gap-1 border-b border-line">
        <TabButton active={tab === "accuracy"} onClick={() => setTab("accuracy")}>
          Accuracy
        </TabButton>
        <TabButton active={tab === "promote"} onClick={() => setTab("promote")}>
          Promote scans
          {candidates.length > 0 ? (
            <span className="rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-700">
              {candidates.length}
            </span>
          ) : null}
        </TabButton>
      </div>

      {note ? <p className="text-sm font-medium text-brand-700">{note}</p> : null}

      {tab === "accuracy" ? (
        <AccuracyTab stats={stats} misses={misses} />
      ) : (
        <PromoteTab candidates={candidates} setCandidates={setCandidates} flash={flash} />
      )}
    </div>
  );
}

function TabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex items-center gap-1.5 whitespace-nowrap px-4 py-2 text-sm font-medium border-b-2 -mb-px ${
        active ? "border-ink text-ink" : "border-transparent text-muted hover:text-ink"
      }`}
    >
      {children}
    </button>
  );
}

function AccuracyTab({ stats, misses }: { stats: Stats; misses: Miss[] }) {
  if (stats.scored === 0) {
    return (
      <EmptyState
        title="No scored scans yet"
        hint="Once managers identify products by photo at Check-Out, each outcome is scored here — whether the AI's top pick matched the product they confirmed."
      />
    );
  }

  // Trend: recent 30-day accuracy vs the prior 30 days (only when both have data).
  const trend =
    stats.recentAccuracy != null && stats.priorAccuracy != null
      ? stats.recentAccuracy - stats.priorAccuracy
      : null;

  return (
    <div className="space-y-5">
      {/* Hero: top-1 accuracy as a single headline + a brand-green magnitude meter. */}
      <Card className="p-5">
        <div className="flex items-baseline justify-between gap-3">
          <div>
            <div className="text-xs font-medium uppercase tracking-wide text-muted">Top-1 accuracy</div>
            <div className="mt-1 text-4xl font-light tracking-tight text-ink">{pct(stats.top1Accuracy)}</div>
            <div className="mt-1 text-xs text-muted">
              {stats.correct} of {stats.scored} scored scans the AI&apos;s #1 pick was confirmed
            </div>
          </div>
          {trend != null ? (
            <div className="text-right">
              <div className="text-xs text-muted">Last 30 days</div>
              <div className={`text-sm font-medium ${trend >= 0 ? "text-brand-700" : "text-red-600"}`}>
                {trend >= 0 ? "▲" : "▼"} {pct(stats.recentAccuracy)}
                <span className="ml-1 text-xs font-normal text-muted">
                  ({trend >= 0 ? "+" : ""}
                  {Math.round(trend * 100)} pts vs prior)
                </span>
              </div>
            </div>
          ) : null}
        </div>
        <div
          className="mt-4 h-2 w-full overflow-hidden rounded-full bg-black/[0.06]"
          role="meter"
          aria-valuenow={stats.top1Accuracy == null ? 0 : Math.round(stats.top1Accuracy * 100)}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label="Top-1 accuracy"
        >
          <div
            className="h-full rounded-full bg-emerald-grad"
            style={{ width: `${stats.top1Accuracy == null ? 0 : Math.round(stats.top1Accuracy * 100)}%` }}
          />
        </div>
      </Card>

      {/* Supporting stat tiles. */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatTile label="AI photo scans" value={stats.totalScans.toLocaleString()} hint="all time" />
        <StatTile label="Scored scans" value={stats.scored.toLocaleString()} hint="carry an AI suggestion" />
        <StatTile label="Corrections" value={stats.corrections.toLocaleString()} hint="manager picked another product" />
        <StatTile label="Correction rate" value={pct(stats.correctionRate)} hint="of scored scans" />
      </div>

      {/* Recent misses — where the AI's top pick was corrected. */}
      <section>
        <h2 className="mb-2 text-sm font-semibold text-ink">
          Recent misses {misses.length > 0 ? `(${misses.length})` : ""}
        </h2>
        {misses.length === 0 ? (
          <EmptyState title="No misses on record" hint="Every scored scan so far had the AI's top pick confirmed." />
        ) : (
          <Card className="divide-y divide-line p-0">
            {misses.map((m) => (
              <div key={m.lineId} className="flex items-start gap-3 p-3">
                {m.photoUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={m.photoUrl} alt="" className="h-14 w-14 shrink-0 rounded-md border border-line object-cover" />
                ) : (
                  <div className="h-14 w-14 shrink-0 rounded-md border border-line bg-black/[0.03]" />
                )}
                <div className="min-w-0 flex-1 text-sm">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                    <span className="text-muted">AI said</span>
                    <span className="font-medium text-ink">{m.suggestedName}</span>
                    <svg viewBox="0 0 24 24" className="h-3.5 w-3.5 text-muted" fill="none" stroke="currentColor" strokeWidth={1.8} aria-hidden="true">
                      <path d="M5 12h14M13 6l6 6-6 6" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                    <span className="text-muted">confirmed</span>
                    <span className="font-medium text-brand-700">{m.confirmedName}</span>
                  </div>
                  <div className="mt-1 text-xs text-muted">
                    {conf(m.confidence) ? `${conf(m.confidence)} confidence · ` : ""}
                    {dateShort(m.at)}
                    {m.by ? ` · ${m.by}` : ""}
                    {m.branch ? ` · ${m.branch}` : ""}
                  </div>
                </div>
              </div>
            ))}
          </Card>
        )}
      </section>
    </div>
  );
}

function StatTile({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <Card className="p-4">
      <div className="text-xs font-medium uppercase tracking-wide text-muted">{label}</div>
      <div className="mt-2 text-2xl font-light tracking-tight text-ink">{value}</div>
      {hint ? <div className="mt-0.5 text-[11px] text-muted">{hint}</div> : null}
    </Card>
  );
}

function PromoteTab({
  candidates,
  setCandidates,
  flash,
}: {
  candidates: Candidate[];
  setCandidates: React.Dispatch<React.SetStateAction<Candidate[]>>;
  flash: (msg: string) => void;
}) {
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function act(lineId: string, action: "promoteScan" | "dismissScan", label: string) {
    setBusyId(lineId);
    setError(null);
    try {
      const res = await fetch("/api/inventory/photo", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, lineId }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? "Something went wrong. Try again.");
        setBusyId(null);
        return;
      }
      setCandidates((prev) => prev.filter((c) => c.lineId !== lineId));
      flash(label);
    } catch {
      setError("Network error. Try again.");
    }
    setBusyId(null);
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted">
        These confirmed check-out scans belong to products that still have room for reference photos. Adding one
        copies the scan into the product&apos;s reference set (up to 3) so photo-identify compares against it next
        time. Products with no reference photos yet are shown first — they gain the most.
      </p>

      {error ? <p className="text-sm text-red-600" role="alert">{error}</p> : null}

      {candidates.length === 0 ? (
        <EmptyState
          title="Nothing to review"
          hint="Confirmed scans for products that need reference photos will appear here. Promote or dismiss them to keep the queue clear."
        />
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {candidates.map((c) => (
            <Card key={c.lineId} className="flex flex-col overflow-hidden p-0">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={c.photoUrl} alt={c.productName} className="aspect-square w-full border-b border-line object-cover" />
              <div className="flex flex-1 flex-col p-3">
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium text-ink">{c.productName}</div>
                  <div className="mt-0.5">
                    {c.existingPhotos === 0 ? (
                      <span className="inline-flex items-center rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-700">
                        No reference photos yet
                      </span>
                    ) : (
                      <span className="text-[11px] text-muted">{c.existingPhotos} of 3 reference photos</span>
                    )}
                  </div>
                  <div className="mt-1 text-[11px] text-muted">
                    {conf(c.confidence) ? `${conf(c.confidence)} confidence · ` : ""}
                    {dateShort(c.at)}
                    {c.branch ? ` · ${c.branch}` : ""}
                  </div>
                </div>
                <div className="mt-3 grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    className={btn.secondary}
                    disabled={busyId === c.lineId}
                    onClick={() => act(c.lineId, "dismissScan", "Dismissed")}
                  >
                    Dismiss
                  </button>
                  <button
                    type="button"
                    className={btn.primary}
                    disabled={busyId === c.lineId}
                    onClick={() => act(c.lineId, "promoteScan", `Added reference photo for ${c.productName}`)}
                  >
                    {busyId === c.lineId ? "Working…" : "Add as reference"}
                  </button>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
