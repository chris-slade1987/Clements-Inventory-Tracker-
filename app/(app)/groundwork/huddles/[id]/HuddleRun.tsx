"use client";

import { useCallback, useState } from "react";
import { Card, BackLink, useToast } from "@/components/ui";
import AskCanopy from "@/components/AskCanopy";
import {
  postHuddle, getJson, CheckOff, PriorityChip, DueChip, BuzzCelebration,
  fieldClass, labelClass, fmtDateTime, fmtTime, fmtDay,
  type MeetingDTO, type AgendaItemDTO, type MeetingNoteDTO, type WorkItemDTO, type AssignablePerson,
} from "../../shared";

export default function HuddleRun({
  initialMeeting, people, meId, canManage, calendarLive, googleUrl,
}: {
  initialMeeting: MeetingDTO;
  people: AssignablePerson[];
  meId: string;
  canManage: boolean;
  calendarLive: boolean;
  googleUrl: string | null;
}) {
  const { toast } = useToast();
  const [m, setM] = useState<MeetingDTO>(initialMeeting);
  const [celebrate, setCelebrate] = useState(false);

  const refresh = useCallback(async () => {
    const data = await getJson<{ meeting: MeetingDTO }>(`/api/huddles?id=${m.id}`);
    setM(data.meeting);
  }, [m.id]);

  const agenda = m.agendaItems ?? [];
  const agendaDone = agenda.filter((a) => a.done).length;
  const followUps = m.followUps ?? [];
  const openFollowUps = followUps.filter((f) => f.status !== "done" && f.status !== "cancelled");
  const completed = m.status === "completed";

  async function act(body: Record<string, unknown>, onOk?: () => void) {
    try {
      await postHuddle({ ...body, id: m.id });
      await refresh();
      onOk?.();
    } catch (err) {
      toast({ message: err instanceof Error ? err.message : "Something went wrong.", tone: "error" });
      await refresh();
    }
  }

  async function toggleAgenda(item: AgendaItemDTO) {
    setM((prev) => ({ ...prev, agendaItems: (prev.agendaItems ?? []).map((a) => a.id === item.id ? { ...a, done: !a.done } : a) }));
    try {
      await postHuddle({ action: "update_agenda_item", agendaItemId: item.id, done: !item.done });
      await refresh();
    } catch (err) {
      toast({ message: err instanceof Error ? err.message : "Couldn't update.", tone: "error" });
      await refresh();
    }
  }

  async function completeFollowUp(f: WorkItemDTO) {
    const wasLastOpen = openFollowUps.length === 1 && openFollowUps[0].id === f.id;
    setM((prev) => ({ ...prev, followUps: (prev.followUps ?? []).map((x) => x.id === f.id ? { ...x, status: "done" } : x) }));
    try {
      await postJsonGroundwork({ action: "complete", id: f.id, done: true });
      if (wasLastOpen) setCelebrate(true);
      await refresh();
    } catch (err) {
      toast({ message: err instanceof Error ? err.message : "Couldn't complete.", tone: "error" });
      await refresh();
    }
  }

  return (
    <div className="space-y-5">
      {celebrate ? (
        <BuzzCelebration headline="Follow-ups closed out!" sub="Every action item from this Huddle is done." onDone={() => setCelebrate(false)} />
      ) : null}

      <BackLink href="/groundwork?tab=huddles">Huddles</BackLink>

      {/* Header */}
      <Card className="p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-xl font-light tracking-tight text-ink md:text-2xl">{m.title}</h1>
              {m.kind ? <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium capitalize text-slate-600">{m.kind.replace("_", " ")}</span> : null}
              {completed ? <span className="rounded-full bg-brand-50 px-2 py-0.5 text-[11px] font-medium text-brand-700">Completed</span> : null}
            </div>
            <div className="mt-1 text-sm text-muted">
              {m.scheduledStart ? `${fmtDateTime(m.scheduledStart)}${m.scheduledEnd ? ` – ${fmtTime(m.scheduledEnd)}` : ""}` : "No set time yet"}
              {m.branchLabel ? ` · ${m.branchLabel}` : ""}
            </div>
          </div>
          {canManage && !completed ? (
            <button onClick={() => act({ action: "complete" }, () => toast({ message: "Huddle completed.", tone: "success" }))} className="rounded-xl border border-[#cfe0d6] bg-white px-4 py-2.5 text-sm font-medium text-brand-700 hover:bg-[#eef5f0]">
              Complete Huddle
            </button>
          ) : null}
        </div>

        {/* Calendar sync — honest live vs. fallback */}
        <div className="mt-3 border-t border-line pt-3">
          {calendarLive ? (
            <p className="inline-flex items-center gap-1.5 text-[12px] text-brand-700">
              <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="17" rx="2" /><path d="M3 9h18M8 2v4M16 2v4M9 15l2 2 4-4" /></svg>
              Synced with Google Calendar — invites go out automatically.
            </p>
          ) : m.scheduledStart ? (
            <div className="flex flex-wrap items-center gap-2 text-[12px]">
              <span className="text-muted">Calendar not connected —</span>
              <a href={`/api/huddles/ics?id=${m.id}`} className="inline-flex items-center gap-1 rounded-lg border border-[#cfe0d6] bg-white px-2.5 py-1 font-medium text-brand-700 hover:bg-[#eef5f0]">
                <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round"><path d="M12 15V4M8 8l4-4 4 4M4 14v5a1 1 0 001 1h14a1 1 0 001-1v-5" /></svg>
                Download .ics
              </a>
              {googleUrl ? (
                <a href={googleUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 rounded-lg border border-[#cfe0d6] bg-white px-2.5 py-1 font-medium text-brand-700 hover:bg-[#eef5f0]">
                  Add to Google Calendar
                </a>
              ) : null}
            </div>
          ) : (
            <p className="text-[12px] text-muted">Set a time to enable calendar invites.</p>
          )}
        </div>
      </Card>

      <div className="grid gap-5 lg:grid-cols-3">
        {/* Left column: agenda + notes */}
        <div className="space-y-5 lg:col-span-2">
          {/* Agenda */}
          <section>
            <h2 className="mb-2 flex items-center justify-between px-1">
              <span className="text-xs font-semibold uppercase tracking-wide text-ink">Agenda</span>
              {agenda.length ? <span className="text-[12px] text-muted">{agendaDone}/{agenda.length} covered</span> : null}
            </h2>
            <Card className="p-0">
              {agenda.length === 0 ? (
                <p className="px-4 py-5 text-center text-sm text-muted">No agenda items. Add one below or apply a template when creating.</p>
              ) : (
                <ul className="divide-y divide-line">
                  {agenda.map((a) => (
                    <li key={a.id} className="flex items-start gap-3 px-4 py-3">
                      <div className="pt-0.5"><CheckOff done={a.done} onToggle={() => toggleAgenda(a)} label={a.title} /></div>
                      <div className="min-w-0">
                        <div className={`text-sm ${a.done ? "text-muted line-through" : "text-ink"}`}>{a.title}</div>
                        {a.prompt ? <div className="mt-0.5 text-[12px] text-muted">{a.prompt}</div> : null}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
              {!completed ? <AddAgendaItem onAdd={(title) => act({ action: "add_agenda_item", title })} /> : null}
            </Card>
          </section>

          {/* Live notes */}
          <section>
            <h2 className="mb-2 px-1 text-xs font-semibold uppercase tracking-wide text-ink">Live notes</h2>
            <Card className="p-4">
              <NotesLog notes={m.notes ?? []} />
              {!completed ? <AddNote onAdd={(body) => act({ action: "add_note", body })} /> : null}
            </Card>
          </section>
        </div>

        {/* Right column: follow-ups + attendees */}
        <div className="space-y-5">
          <section>
            <h2 className="mb-2 flex items-center justify-between px-1">
              <span className="text-xs font-semibold uppercase tracking-wide text-ink">Follow-ups</span>
              {followUps.length ? <span className="text-[12px] text-muted">{openFollowUps.length} open</span> : null}
            </h2>
            <Card className="p-0">
              {followUps.length === 0 ? (
                <p className="px-4 py-4 text-center text-sm text-muted">No follow-ups yet. Assign one below — it lands on that person&apos;s My Work right away.</p>
              ) : (
                <ul className="divide-y divide-line">
                  {followUps.map((f) => (
                    <li key={f.id} className="flex items-start gap-3 px-4 py-3">
                      <div className="pt-0.5"><CheckOff done={f.status === "done"} onToggle={() => f.status === "done" ? undefined : completeFollowUp(f)} label={f.title} /></div>
                      <div className="min-w-0 flex-1">
                        <div className={`text-sm ${f.status === "done" ? "text-muted line-through" : "text-ink"}`}>{f.title}</div>
                        <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5">
                          {f.status !== "done" ? <DueChip item={f} /> : null}
                          <span className="text-[12px] text-muted">for {f.assigneeName ?? "someone"}</span>
                          {f.status !== "done" ? <PriorityChip priority={f.priority} /> : null}
                        </div>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
              {!completed ? (
                <AddFollowUp
                  attendees={m.attendees ?? []}
                  meId={meId}
                  onAdd={(body) => act(body, () => toast({ message: "Follow-up assigned — it's on their My Work now.", tone: "success" }))}
                />
              ) : null}
            </Card>
            {!completed ? (
              <div className="mt-2 px-1">
                <AskCanopy task={`Add a follow-up from the Huddle "${m.title}" for `} label="Ask Canopy to assign a follow-up" variant="button" />
              </div>
            ) : null}
          </section>

          {/* Attendees */}
          <section>
            <h2 className="mb-2 px-1 text-xs font-semibold uppercase tracking-wide text-ink">Attendees</h2>
            <Card className="p-4">
              <ul className="space-y-2">
                {(m.attendees ?? []).map((a) => (
                  <li key={a.id} className="flex items-center gap-2">
                    <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-brand-50 text-[12px] font-semibold text-brand-700">
                      {(a.name ?? a.email).split(/[ @.]/).map((w) => w[0]).slice(0, 2).join("").toUpperCase() || "?"}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-sm text-ink">{a.name ?? a.email}</span>
                    {a.role === "organizer" ? <span className="shrink-0 text-[11px] text-muted">Organizer</span> : null}
                  </li>
                ))}
              </ul>
              {canManage && !completed ? (
                <AddAttendee people={people} attendees={m.attendees ?? []} onAdd={(attendees) => act({ action: "add_attendees", attendees })} />
              ) : null}
            </Card>
          </section>
        </div>
      </div>
    </div>
  );
}

// Follow-ups complete via the Groundwork API (they're WorkItems), not the Huddle API.
async function postJsonGroundwork(body: unknown) {
  const res = await fetch("/api/groundwork", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data?.error as string) || "Something went wrong.");
  return data;
}

function AddAgendaItem({ onAdd }: { onAdd: (title: string) => void }) {
  const [v, setV] = useState("");
  return (
    <form
      onSubmit={(e) => { e.preventDefault(); const t = v.trim(); if (t) { onAdd(t); setV(""); } }}
      className="flex items-center gap-2 border-t border-line px-4 py-2.5"
    >
      <svg viewBox="0 0 24 24" className="h-4 w-4 shrink-0 text-brand-500" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round"><path d="M12 5v14M5 12h14" /></svg>
      <input value={v} onChange={(e) => setV(e.target.value)} placeholder="Add an agenda item…" aria-label="New agenda item" className="min-w-0 flex-1 bg-transparent text-sm text-ink placeholder:text-muted focus:outline-none" />
      <button type="submit" disabled={!v.trim()} className="shrink-0 text-sm font-medium text-brand-700 disabled:opacity-40">Add</button>
    </form>
  );
}

function NotesLog({ notes }: { notes: MeetingNoteDTO[] }) {
  if (notes.length === 0) return <p className="pb-3 text-sm text-muted">No notes yet — capture decisions and discussion as they happen.</p>;
  return (
    <ul className="mb-3 space-y-3">
      {notes.map((n) => (
        <li key={n.id} className="text-sm">
          <div className="flex items-baseline gap-2">
            <span className="font-medium text-ink">{n.authorName ?? "Someone"}</span>
            <span className="text-[11px] text-muted">{fmtTime(n.createdAt)} · {fmtDay(n.createdAt)}</span>
          </div>
          <p className="mt-0.5 whitespace-pre-wrap text-ink/85">{n.body}</p>
        </li>
      ))}
    </ul>
  );
}

function AddNote({ onAdd }: { onAdd: (body: string) => void }) {
  const [v, setV] = useState("");
  return (
    <form onSubmit={(e) => { e.preventDefault(); const t = v.trim(); if (t) { onAdd(t); setV(""); } }} className="border-t border-line pt-3">
      <textarea value={v} onChange={(e) => setV(e.target.value)} rows={2} placeholder="Add a note…" aria-label="New note" className={fieldClass} />
      <div className="mt-2 flex justify-end">
        <button type="submit" disabled={!v.trim()} className="rounded-lg bg-emerald-grad px-3 py-1.5 text-sm font-medium text-white shadow-sm transition-[filter] hover:brightness-110 disabled:opacity-40">Add note</button>
      </div>
    </form>
  );
}

function AddFollowUp({
  attendees, meId, onAdd,
}: { attendees: MeetingDTO["attendees"]; meId: string; onAdd: (body: Record<string, unknown>) => void }) {
  const [title, setTitle] = useState("");
  const [assigneeId, setAssigneeId] = useState(meId);
  const [due, setDue] = useState("");
  const [horizon, setHorizon] = useState("week");
  // Only attendees with a login can own a follow-up.
  const options = (attendees ?? []).filter((a) => a.userId);

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        const t = title.trim();
        if (!t) return;
        onAdd({ action: "follow_up", title: t, assigneeId, dueDate: due || undefined, horizon });
        setTitle(""); setDue("");
      }}
      className="space-y-2 border-t border-line px-4 py-3"
    >
      <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="New follow-up…" aria-label="Follow-up title" className="w-full bg-transparent text-sm text-ink placeholder:text-muted focus:outline-none" />
      <div className="grid grid-cols-2 gap-2">
        <select value={assigneeId} onChange={(e) => setAssigneeId(e.target.value)} aria-label="Assign to" className={fieldClass}>
          <option value={meId}>Me</option>
          {options.filter((a) => a.userId !== meId).map((a) => <option key={a.id} value={a.userId!}>{a.name ?? a.email}</option>)}
        </select>
        <input type="date" value={due} onChange={(e) => setDue(e.target.value)} aria-label="Due date" className={fieldClass} />
      </div>
      <div className="flex items-center gap-2">
        <select value={horizon} onChange={(e) => setHorizon(e.target.value)} aria-label="Horizon" className={fieldClass}>
          <option value="now">Now</option>
          <option value="week">This week</option>
        </select>
        <button type="submit" disabled={!title.trim()} className="shrink-0 rounded-lg bg-emerald-grad px-3 py-2.5 text-sm font-medium text-white shadow-sm transition-[filter] hover:brightness-110 disabled:opacity-40">Assign</button>
      </div>
    </form>
  );
}

function AddAttendee({
  people, attendees, onAdd,
}: { people: AssignablePerson[]; attendees: MeetingDTO["attendees"]; onAdd: (attendees: { userId?: string; email?: string; name?: string }[]) => void }) {
  const [userId, setUserId] = useState("");
  const present = new Set((attendees ?? []).map((a) => a.userId).filter(Boolean) as string[]);
  const addable = people.filter((p) => !present.has(p.id));
  if (addable.length === 0) return null;
  return (
    <div className="mt-3 border-t border-line pt-3">
      <label className={labelClass} htmlFor="add-att">Add someone</label>
      <div className="flex items-center gap-2">
        <select id="add-att" value={userId} onChange={(e) => setUserId(e.target.value)} className={fieldClass}>
          <option value="">Choose a person…</option>
          {addable.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
        <button
          type="button"
          onClick={() => { const p = people.find((x) => x.id === userId); if (p) { onAdd([{ userId: p.id, email: p.email, name: p.name }]); setUserId(""); } }}
          disabled={!userId}
          className="shrink-0 rounded-lg bg-emerald-grad px-3 py-2.5 text-sm font-medium text-white shadow-sm transition-[filter] hover:brightness-110 disabled:opacity-40"
        >
          Add
        </button>
      </div>
    </div>
  );
}
