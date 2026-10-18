"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Card } from "@/components/ui";
import AskCanopy from "@/components/AskCanopy";
import type { MyWorkData } from "./GroundworkHome";
import {
  postGroundwork, CheckOff, PriorityChip, DueChip, BuzzCelebration, PRIORITIES,
  fieldClass, labelClass, type WorkItemDTO, type AssignablePerson,
} from "./shared";

type GroupKey = "overdue" | "today" | "week" | "upcoming";
const GROUPS: { key: GroupKey; label: string; accent: string }[] = [
  { key: "overdue", label: "Overdue", accent: "text-red-600" },
  { key: "today", label: "Today", accent: "text-brand-700" },
  { key: "week", label: "This week", accent: "text-ink" },
  { key: "upcoming", label: "Upcoming", accent: "text-muted" },
];

export default function MyWork({
  firstName, work, setWork, refreshWork, people, trigger, onPeek,
}: {
  firstName: string;
  work: MyWorkData;
  setWork: React.Dispatch<React.SetStateAction<MyWorkData>>;
  refreshWork: () => Promise<void>;
  people: AssignablePerson[];
  trigger: number;
  onPeek: () => void;
}) {
  const [busyId, setBusyId] = useState<string | null>(null);
  const [celebrate, setCelebrate] = useState(false);
  const quickRef = useRef<HTMLInputElement | null>(null);

  // "+ New › To-Do" (or the inline button) focuses the quick-add.
  useEffect(() => { if (trigger > 0) quickRef.current?.focus(); }, [trigger]);

  const activeTotal = work.counts.overdue + work.counts.today + work.counts.week + work.counts.upcoming;

  async function toggleDone(item: WorkItemDTO) {
    setBusyId(item.id);
    // Earned Buzz only when the Today column empties: this was its last open item.
    const wasLastToday = work.today.length === 1 && work.today[0].id === item.id;
    // Optimistic: drop it from every active group.
    setWork((w) => stripItem(w, item.id));
    try {
      await postGroundwork({ action: "complete", id: item.id, done: true });
      // Earned Buzz: the Today column just hit zero.
      if (wasLastToday) setCelebrate(true);
      await refreshWork();
    } catch {
      await refreshWork(); // reconcile on failure
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="space-y-4">
      {celebrate ? (
        <BuzzCelebration
          headline={`Today's clear, ${firstName}!`}
          sub="Every To-Do due today is done. Nice work."
          onDone={() => setCelebrate(false)}
        />
      ) : null}

      <QuickAdd inputRef={quickRef} people={people} onCreated={refreshWork} />

      {activeTotal === 0 ? (
        <Card className="p-8 text-center">
          <div className="mx-auto mb-3 grid h-12 w-12 place-items-center rounded-full bg-brand-50 text-brand-600">
            <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round"><path d="M5 13l4 4L19 7" /></svg>
          </div>
          <div className="font-medium text-ink">Your day is clear</div>
          <div className="mt-1 text-sm text-muted">Nothing due right now. Capture the next thing above, or <button onClick={onPeek} className="text-brand-700 underline underline-offset-2 hover:text-brand-800">plant an idea in The Greenhouse</button>.</div>
        </Card>
      ) : (
        GROUPS.map((g) => {
          const items = work[g.key];
          if (!items.length) return null;
          return (
            <section key={g.key} aria-label={g.label}>
              <h2 className={`mb-2 flex items-center gap-2 px-1 text-xs font-semibold uppercase tracking-wide ${g.accent}`}>
                {g.label}
                <span className="rounded-full bg-black/5 px-1.5 text-[11px] font-medium text-muted">{items.length}</span>
              </h2>
              <Card className="divide-y divide-line p-0">
                {items.map((item) => (
                  <WorkRow key={item.id} item={item} busy={busyId === item.id} onToggle={() => toggleDone(item)} />
                ))}
              </Card>
            </section>
          );
        })
      )}

      <div className="flex flex-wrap items-center justify-between gap-2 px-1 pt-1">
        <button onClick={onPeek} className="inline-flex items-center gap-1.5 text-sm text-muted hover:text-ink">
          <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round"><path d="M12 22V12m0-2c0-2.8-2.2-5-5-5H4v1.5A4.5 4.5 0 008.5 13H12z" /></svg>
          {work.counts.someday > 0 ? `${work.counts.someday} idea${work.counts.someday === 1 ? "" : "s"} in The Greenhouse` : "Peek at The Greenhouse"}
        </button>
        <AskCanopy task="Add a To-Do to my Groundwork: " label="Ask Canopy to add work" variant="button" />
      </div>
    </div>
  );
}

function WorkRow({ item, busy, onToggle }: { item: WorkItemDTO; busy: boolean; onToggle: () => void }) {
  const assignedToOther = item.assigneeType === "person" && item.assigneeName && item.assigneeId !== item.creatorId;
  const fromHuddle = !!item.meetingId;
  return (
    <div className="flex items-start gap-3 px-4 py-3">
      <div className="pt-0.5"><CheckOff done={false} busy={busy} onToggle={onToggle} label={item.title} /></div>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="text-sm text-ink">{item.title}</span>
          <PriorityChip priority={item.priority} />
          {fromHuddle ? (
            <span className="inline-flex items-center gap-1 rounded-full bg-brand-50 px-2 py-0.5 text-[11px] font-medium text-brand-700">
              <svg viewBox="0 0 24 24" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round"><path d="M17 20v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2M9 7a4 4 0 108 0 4 4 0 00-8 0z" /></svg>
              Follow-up
            </span>
          ) : null}
        </div>
        <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5">
          <DueChip item={item} />
          {item.projectId ? (
            <Link href={`/groundwork/projects/${item.projectId}`} className="text-[12px] text-muted hover:text-ink">In a project</Link>
          ) : null}
          {assignedToOther ? <span className="text-[12px] text-muted">for {item.assigneeName}</span> : null}
        </div>
      </div>
    </div>
  );
}

function QuickAdd({
  inputRef, people, onCreated,
}: { inputRef: React.RefObject<HTMLInputElement | null>; people: AssignablePerson[]; onCreated: () => Promise<void>; }) {
  const [title, setTitle] = useState("");
  const [due, setDue] = useState("");
  const [priority, setPriority] = useState("normal");
  const [horizon, setHorizon] = useState("now");
  const [assigneeId, setAssigneeId] = useState("");
  const [expanded, setExpanded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const canAssign = people.length > 1;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const t = title.trim();
    if (!t) { inputRef.current?.focus(); return; }
    setSaving(true); setError(null);
    try {
      await postGroundwork({
        action: "create", title: t,
        dueDate: due || undefined, priority, horizon,
        ...(assigneeId ? { assigneeType: "person", assigneeId } : {}),
      });
      setTitle(""); setDue(""); setPriority("normal"); setHorizon("now"); setAssigneeId(""); setExpanded(false);
      await onCreated();
      inputRef.current?.focus();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't add that.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card className="p-3">
      <form onSubmit={submit}>
        <div className="flex items-center gap-2">
          <svg viewBox="0 0 24 24" className="h-5 w-5 shrink-0 text-brand-500" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round"><path d="M12 5v14M5 12h14" /></svg>
          <input
            ref={inputRef}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onFocus={() => setExpanded(true)}
            placeholder="Add a To-Do…"
            aria-label="New To-Do title"
            className="min-w-0 flex-1 bg-transparent text-sm text-ink placeholder:text-muted focus:outline-none"
          />
          <button type="submit" disabled={saving || !title.trim()} className="shrink-0 rounded-lg bg-emerald-grad px-3 py-1.5 text-sm font-medium text-white shadow-sm transition-[filter] hover:brightness-110 disabled:opacity-40">
            Add
          </button>
        </div>
        {expanded ? (
          <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
            <div>
              <label className={labelClass} htmlFor="qa-due">Due</label>
              <input id="qa-due" type="date" value={due} onChange={(e) => setDue(e.target.value)} className={fieldClass} />
            </div>
            <div>
              <label className={labelClass} htmlFor="qa-pri">Priority</label>
              <select id="qa-pri" value={priority} onChange={(e) => setPriority(e.target.value)} className={fieldClass}>
                {PRIORITIES.map((p) => <option key={p} value={p} className="capitalize">{p[0].toUpperCase() + p.slice(1)}</option>)}
              </select>
            </div>
            <div>
              <label className={labelClass} htmlFor="qa-hor">Horizon</label>
              <select id="qa-hor" value={horizon} onChange={(e) => setHorizon(e.target.value)} className={fieldClass}>
                <option value="now">Now</option>
                <option value="week">This week</option>
                <option value="someday">Someday (Greenhouse)</option>
              </select>
            </div>
            {canAssign ? (
              <div>
                <label className={labelClass} htmlFor="qa-asg">Assign to</label>
                <select id="qa-asg" value={assigneeId} onChange={(e) => setAssigneeId(e.target.value)} className={fieldClass}>
                  <option value="">Me</option>
                  {people.slice(1).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              </div>
            ) : null}
          </div>
        ) : null}
        {error ? <p className="mt-2 text-sm text-red-600">{error}</p> : null}
      </form>
    </Card>
  );
}

// Remove an item from every active group (optimistic check-off).
function stripItem(w: MyWorkData, id: string): MyWorkData {
  const drop = (arr: WorkItemDTO[]) => arr.filter((x) => x.id !== id);
  const next = { ...w, overdue: drop(w.overdue), today: drop(w.today), week: drop(w.week), upcoming: drop(w.upcoming) };
  next.counts = { ...w.counts, overdue: next.overdue.length, today: next.today.length, week: next.week.length, upcoming: next.upcoming.length };
  return next;
}
