"use client";

import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import { Card, BackLink, useToast } from "@/components/ui";
import AskCanopy from "@/components/AskCanopy";
import {
  postHuddle, getJson, suggestTimes, Modal, CheckOff, PriorityChip, DueChip, BuzzCelebration,
  fieldClass, labelClass, fmtDateTime, fmtTime, fmtDay,
  type MeetingDTO, type AgendaItemDTO, type MeetingNoteDTO, type WorkItemDTO, type AssignablePerson, type SuggestResult,
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
  const router = useRouter();
  const [m, setM] = useState<MeetingDTO>(initialMeeting);
  const [celebrate, setCelebrate] = useState(false);
  const [rescheduling, setRescheduling] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

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

  async function del() {
    setDeleting(true);
    try {
      await postHuddle({ action: "delete", id: m.id });
      toast({ message: "Huddle deleted — the calendar invite was cancelled.", tone: "success" });
      router.push("/groundwork?tab=huddles");
    } catch (err) {
      toast({ message: err instanceof Error ? err.message : "Couldn't delete the Huddle.", tone: "error" });
      setDeleting(false);
      setConfirmDelete(false);
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

      {rescheduling ? (
        <RescheduleModal
          meeting={m}
          onClose={() => setRescheduling(false)}
          onSaved={async (slot) => {
            await act({ action: "update", scheduledStart: slot.start, scheduledEnd: slot.end }, () =>
              toast({ message: "Huddle moved — attendees were re-notified.", tone: "success" }),
            );
            setRescheduling(false);
          }}
        />
      ) : null}

      {confirmDelete ? (
        <Modal title="Delete this Huddle?" onClose={() => (deleting ? undefined : setConfirmDelete(false))}>
          <div className="space-y-4">
            <p className="text-sm text-ink">This removes the Huddle and cancels the calendar invite for everyone. This can&apos;t be undone.</p>
            <p className="text-[12px] text-muted">If the Huddle actually happened, use <span className="font-medium">Cancel</span> instead so its notes and follow-ups are kept.</p>
            <div className="flex items-center justify-end gap-2">
              <button type="button" onClick={() => setConfirmDelete(false)} disabled={deleting} className="rounded-xl border border-[#cfe0d6] bg-white px-4 py-2.5 text-sm font-medium text-[#0e1b15] hover:bg-[#eef5f0] disabled:opacity-50">Keep it</button>
              <button type="button" onClick={del} disabled={deleting} className="rounded-xl bg-red-600 px-4 py-2.5 text-sm font-medium text-white shadow-sm hover:bg-red-700 disabled:opacity-50">
                {deleting ? "Deleting…" : "Delete Huddle"}
              </button>
            </div>
          </div>
        </Modal>
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
              {m.status === "cancelled" ? <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-500">Cancelled</span> : null}
            </div>
            <div className="mt-1 text-sm text-muted">
              {m.scheduledStart ? `${fmtDateTime(m.scheduledStart)}${m.scheduledEnd ? ` – ${fmtTime(m.scheduledEnd)}` : ""}` : "No set time yet"}
              {m.branchLabel ? ` · ${m.branchLabel}` : ""}
            </div>
          </div>
          {canManage && !completed && m.status !== "cancelled" ? (
            <div className="flex flex-wrap items-center gap-2">
              <button onClick={() => setRescheduling(true)} className="rounded-xl border border-[#cfe0d6] bg-white px-4 py-2.5 text-sm font-medium text-brand-700 hover:bg-[#eef5f0]">
                Reschedule
              </button>
              <button onClick={() => act({ action: "complete" }, () => toast({ message: "Huddle completed.", tone: "success" }))} className="rounded-xl bg-emerald-grad px-4 py-2.5 text-sm font-medium text-white shadow-sm transition-[filter] hover:brightness-110">
                Complete
              </button>
              <button onClick={() => act({ action: "cancel" }, () => toast({ message: "Huddle cancelled — the calendar invite was withdrawn.", tone: "success" }))} className="rounded-xl border border-[#cfe0d6] bg-white px-4 py-2.5 text-sm font-medium text-slate-600 hover:bg-[#eef5f0]">
                Cancel
              </button>
              <button onClick={() => setConfirmDelete(true)} className="rounded-xl border border-red-200 bg-white px-4 py-2.5 text-sm font-medium text-red-600 hover:bg-red-50">
                Delete
              </button>
            </div>
          ) : null}
        </div>

        {/* Calendar sync — honest live vs. fallback */}
        <div className="mt-3 border-t border-line pt-3">
          {m.calendarEventId ? (
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[12px]">
              <span className="inline-flex items-center gap-1.5 text-brand-700">
                <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="17" rx="2" /><path d="M3 9h18M8 2v4M16 2v4M9 15l2 2 4-4" /></svg>
                Synced to Google Calendar — invites sent automatically.
              </span>
              {m.calendarMeetLink ? (
                <a href={m.calendarMeetLink} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 rounded-lg border border-[#cfe0d6] bg-white px-2.5 py-1 font-medium text-brand-700 hover:bg-[#eef5f0]">
                  <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round"><path d="M15 10l4.5-2.5v9L15 14M4 6h9a2 2 0 012 2v8a2 2 0 01-2 2H4a2 2 0 01-2-2V8a2 2 0 012-2z" /></svg>
                  Join Meet
                </a>
              ) : null}
              {m.calendarHtmlLink ? (
                <a href={m.calendarHtmlLink} target="_blank" rel="noopener noreferrer" className="font-medium text-brand-700 hover:underline">
                  View in Google Calendar
                </a>
              ) : null}
            </div>
          ) : m.scheduledStart ? (
            <div className="flex flex-wrap items-center gap-2 text-[12px]">
              <span className="text-muted">{calendarLive ? "Not synced to Google (organizer isn't a company mailbox) —" : "Calendar not connected —"}</span>
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

// ── Reschedule modal — reuses the Suggest Times flow + a direct date/time picker ──

/** Business-hour time options (7:00 AM – 6:00 PM, every 30 min). */
const TIME_OPTIONS: { value: string; label: string }[] = (() => {
  const out: { value: string; label: string }[] = [];
  for (let h = 7; h <= 18; h++) {
    for (const mm of [0, 30]) {
      const value = `${String(h).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
      const hour12 = ((h + 11) % 12) + 1;
      out.push({ value, label: `${hour12}:${String(mm).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}` });
    }
  }
  return out;
})();

const pad = (n: number) => String(n).padStart(2, "0");
const localDay = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
function nextWeekdayDay(): string {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  while (d.getDay() === 0 || d.getDay() === 6) d.setDate(d.getDate() + 1);
  return localDay(d);
}
function slotFrom(day: string, time: string, durationMins: number): { start: string; end: string } | null {
  if (!day || !time) return null;
  const start = new Date(`${day}T${time}:00`);
  if (Number.isNaN(start.getTime())) return null;
  return { start: start.toISOString(), end: new Date(start.getTime() + durationMins * 60000).toISOString() };
}
function halfHour(d: Date): string {
  const mm = d.getMinutes() < 15 ? 0 : d.getMinutes() < 45 ? 30 : 0;
  const h = d.getMinutes() >= 45 ? (d.getHours() + 1) % 24 : d.getHours();
  return `${pad(h)}:${pad(mm)}`;
}

function RescheduleModal({
  meeting, onClose, onSaved,
}: { meeting: MeetingDTO; onClose: () => void; onSaved: (slot: { start: string; end: string }) => Promise<void> }) {
  const existingStart = meeting.scheduledStart ? new Date(meeting.scheduledStart) : null;
  const existingMins =
    meeting.scheduledStart && meeting.scheduledEnd
      ? Math.max(15, Math.round((new Date(meeting.scheduledEnd).getTime() - new Date(meeting.scheduledStart).getTime()) / 60000))
      : 30;

  const [durationMins, setDurationMins] = useState(existingMins);
  const [day, setDay] = useState(existingStart ? localDay(existingStart) : nextWeekdayDay());
  const [time, setTime] = useState(existingStart ? halfHour(existingStart) : "09:00");
  const [finding, setFinding] = useState(false);
  const [suggest, setSuggest] = useState<SuggestResult | null>(null);
  const [pickedSlot, setPickedSlot] = useState<{ start: string; end: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const effectiveSlot = pickedSlot ?? slotFrom(day, time, durationMins);
  const attendeeEmails = (meeting.attendees ?? []).map((a) => a.email).filter(Boolean);

  async function findTimes() {
    setFinding(true); setError(null); setSuggest(null); setPickedSlot(null);
    try {
      const start = new Date(`${day}T00:00:00`);
      const earliest = new Date(Math.max(Date.now(), start.getTime()));
      const latest = new Date(start.getTime() + 6 * 864e5);
      const res = await suggestTimes({ attendeeEmails, durationMins, earliest: earliest.toISOString(), latest: latest.toISOString() });
      setSuggest(res);
      if (res.slots[0]) setPickedSlot({ start: res.slots[0].start, end: res.slots[0].end });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't suggest times.");
    } finally {
      setFinding(false);
    }
  }

  async function save() {
    if (!effectiveSlot) { setError("Pick a date and time."); return; }
    setSaving(true); setError(null);
    try {
      await onSaved(effectiveSlot);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't reschedule.");
      setSaving(false);
    }
  }

  return (
    <Modal title="Reschedule Huddle" onClose={onClose} wide>
      <div className="space-y-4">
        <p className="text-sm text-muted">Pick a new time for <span className="font-medium text-ink">{meeting.title}</span>. The calendar event and everyone&apos;s invite update automatically, and attendees are re-notified.</p>

        <div className="rounded-xl border border-line bg-[#f7faf8] p-3">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div>
              <label className={labelClass} htmlFor="rs-day">Date</label>
              <input id="rs-day" type="date" value={day} min={localDay(new Date())} onChange={(e) => { setDay(e.target.value); setSuggest(null); setPickedSlot(null); }} className={fieldClass} />
            </div>
            <div>
              <label className={labelClass} htmlFor="rs-time">Start time</label>
              <select id="rs-time" value={time} onChange={(e) => { setTime(e.target.value); setPickedSlot(null); }} className={fieldClass}>
                {TIME_OPTIONS.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
            </div>
            <div>
              <label className={labelClass} htmlFor="rs-dur">Length</label>
              <select id="rs-dur" value={durationMins} onChange={(e) => { setDurationMins(Number(e.target.value)); setSuggest(null); setPickedSlot(null); }} className={fieldClass}>
                <option value={15}>15 min</option><option value={30}>30 min</option><option value={45}>45 min</option><option value={60}>1 hour</option>
              </select>
            </div>
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-2">
            {effectiveSlot ? (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-brand-50 px-2.5 py-1 text-[12px] font-medium text-brand-800">
                <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="17" rx="2" /><path d="M3 9h18M8 2v4M16 2v4" /></svg>
                {fmtDateTime(effectiveSlot.start)}
              </span>
            ) : null}
            <button type="button" onClick={findTimes} disabled={finding} className="rounded-lg border border-[#cfe0d6] bg-white px-4 py-2 text-sm font-medium text-brand-700 shadow-sm hover:bg-[#eef5f0] disabled:opacity-50">
              {finding ? "Finding…" : "Find a new time"}
            </button>
          </div>

          {suggest ? (
            <div className="mt-3">
              <p className={`mb-2 inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[12px] font-medium ${suggest.availabilityKnown ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700"}`}>
                <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round"><path d={suggest.availabilityKnown ? "M5 13l4 4L19 7" : "M12 8v5m0 3h.01M12 3a9 9 0 100 18 9 9 0 000-18z"} /></svg>
                {suggest.availabilityKnown ? "Live free/busy from Google Calendar — conflicts avoided" : "Calendar not connected — business-hour suggestions"}
              </p>
              {suggest.slots.length === 0 ? (
                <p className="text-sm text-muted">No open slots in that window — try another day or a shorter length.</p>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {suggest.slots.map((s) => {
                    const picked = pickedSlot?.start === s.start;
                    return (
                      <button
                        key={s.start}
                        type="button"
                        onClick={() => { setPickedSlot({ start: s.start, end: s.end }); setDay(localDay(new Date(s.start))); setTime(halfHour(new Date(s.start))); }}
                        title={s.conflicts.length ? `Busy: ${s.conflicts.join(", ")}` : "Everyone free"}
                        className={`rounded-lg border px-3 py-1.5 text-[13px] transition-colors ${
                          picked ? "border-brand-600 bg-brand-50 text-brand-800" : s.available ? "border-[#cfe0d6] bg-white text-ink hover:bg-[#eef5f0]" : "border-amber-200 bg-amber-50/50 text-amber-800 hover:bg-amber-50"
                        }`}
                      >
                        {fmtDateTime(s.start)}
                        {suggest.availabilityKnown && !s.available ? <span className="ml-1 text-[11px]">({s.conflicts.length} busy)</span> : null}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          ) : null}
        </div>

        {error ? <p className="text-sm text-red-600">{error}</p> : null}

        <div className="flex items-center justify-end gap-2">
          <button type="button" onClick={onClose} disabled={saving} className="rounded-xl border border-[#cfe0d6] bg-white px-4 py-2.5 text-sm font-medium text-[#0e1b15] hover:bg-[#eef5f0] disabled:opacity-50">Cancel</button>
          <button type="button" onClick={save} disabled={saving || !effectiveSlot} className="rounded-xl bg-emerald-grad px-4 py-2.5 text-sm font-medium text-white shadow-sm transition-[filter] hover:brightness-110 disabled:opacity-50">
            {saving ? "Saving…" : "Save new time"}
          </button>
        </div>
      </div>
    </Modal>
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
