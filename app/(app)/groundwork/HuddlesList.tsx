"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Card } from "@/components/ui";
import HuddleCreate from "./HuddleCreate";
import { fmtDateTime, type MeetingDTO, type AssignablePerson } from "./shared";

const KIND_LABEL: Record<string, string> = {
  sales: "Sales", marketing: "Marketing", ops: "Ops", one_on_one: "1:1", custom: "Custom",
};

export default function HuddlesList({
  huddles, refreshHuddles, people, trigger,
}: {
  huddles: MeetingDTO[];
  refreshHuddles: () => Promise<void>;
  people: AssignablePerson[];
  trigger: number;
}) {
  const [creating, setCreating] = useState(false);
  useEffect(() => { if (trigger > 0) setCreating(true); }, [trigger]);

  const now = Date.now();
  const upcoming = huddles.filter((h) => h.status === "scheduled" || h.status === "in_progress");
  const past = huddles.filter((h) => h.status === "completed");

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-muted">Meetings with an agenda, live notes, and follow-ups that land on people&apos;s plates.</p>
        <button onClick={() => setCreating(true)} className="inline-flex shrink-0 items-center gap-2 rounded-xl bg-emerald-grad px-3.5 py-2 text-sm font-medium text-white shadow-sm transition-[filter] hover:brightness-110">
          <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><path d="M12 5v14M5 12h14" /></svg>
          New Huddle
        </button>
      </div>

      {huddles.length === 0 ? (
        <Card className="p-8 text-center">
          <div className="mx-auto mb-3 grid h-12 w-12 place-items-center rounded-full bg-brand-50 text-brand-600">
            <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round"><path d="M17 20v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2M9 7a4 4 0 108 0 4 4 0 00-8 0z" /></svg>
          </div>
          <div className="font-medium text-ink">No Huddles yet</div>
          <div className="mt-1 text-sm text-muted">Start one, draw down an agenda template, and invite your team.</div>
          <button onClick={() => setCreating(true)} className="mt-4 inline-flex items-center gap-2 rounded-xl bg-emerald-grad px-4 py-2.5 text-sm font-medium text-white shadow-sm transition-[filter] hover:brightness-110">Create your first Huddle</button>
        </Card>
      ) : (
        <>
          {upcoming.length ? (
            <section aria-label="Upcoming Huddles">
              <h2 className="mb-2 px-1 text-xs font-semibold uppercase tracking-wide text-brand-700">Upcoming &amp; in progress</h2>
              <div className="grid gap-3 sm:grid-cols-2">
                {upcoming.map((h) => <HuddleCard key={h.id} h={h} now={now} />)}
              </div>
            </section>
          ) : null}
          {past.length ? (
            <section aria-label="Past Huddles">
              <h2 className="mb-2 mt-2 px-1 text-xs font-semibold uppercase tracking-wide text-muted">Completed</h2>
              <div className="grid gap-3 sm:grid-cols-2">
                {past.map((h) => <HuddleCard key={h.id} h={h} now={now} />)}
              </div>
            </section>
          ) : null}
        </>
      )}

      {creating ? (
        <HuddleCreate people={people} onClose={() => setCreating(false)} onCreated={refreshHuddles} />
      ) : null}
    </div>
  );
}

function HuddleCard({ h, now }: { h: MeetingDTO; now: number }) {
  const attendeeCount = h.attendees?.length ?? 0;
  const live = h.status === "in_progress" || (h.scheduledStart && Math.abs(new Date(h.scheduledStart).getTime() - now) < 36e5);
  return (
    <Link
      href={`/groundwork/huddles/${h.id}`}
      className="block rounded-xl border border-line bg-card-grad p-4 shadow-[0_1px_2px_rgba(8,37,24,0.04)] transition-shadow hover:shadow-[0_6px_20px_-10px_rgba(8,37,24,0.4)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="truncate text-sm font-medium text-ink">{h.title}</div>
          <div className="mt-0.5 text-[12px] text-muted">
            {h.scheduledStart ? fmtDateTime(h.scheduledStart) : "No set time yet"}
          </div>
        </div>
        {h.kind ? <span className="shrink-0 rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-600">{KIND_LABEL[h.kind] ?? h.kind}</span> : null}
      </div>
      <div className="mt-3 flex items-center gap-3 text-[12px] text-muted">
        <span className="inline-flex items-center gap-1">
          <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round"><path d="M17 20v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2M9 7a4 4 0 108 0 4 4 0 00-8 0z" /></svg>
          {attendeeCount}
        </span>
        {live && h.status !== "completed" ? <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 font-medium text-emerald-700"><span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />Live</span> : null}
        {h.status === "completed" ? <span className="text-brand-700">Completed</span> : null}
        {h.branchLabel ? <span className="ml-auto">{h.branchLabel}</span> : null}
      </div>
    </Link>
  );
}
