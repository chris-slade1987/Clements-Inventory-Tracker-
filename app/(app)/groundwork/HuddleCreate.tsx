"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Modal, postHuddle, getJson, suggestTimes, fieldClass, labelClass, fmtDateTime,
  type AssignablePerson, type SuggestResult, type MeetingDTO,
} from "./shared";

type TemplateDTO = { key: string; name: string; kind: string | null; itemCount: number };

const KINDS: { value: string; label: string }[] = [
  { value: "", label: "General" },
  { value: "sales", label: "Sales" },
  { value: "marketing", label: "Marketing" },
  { value: "ops", label: "Ops / Branch" },
  { value: "one_on_one", label: "1:1" },
  { value: "custom", label: "Custom" },
];

function nextWeekday(): string {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  while (d.getDay() === 0 || d.getDay() === 6) d.setDate(d.getDate() + 1);
  // Local YYYY-MM-DD (not UTC) so the date control shows the intended calendar day.
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Business-hour time options (7:00 AM – 6:00 PM, every 30 min) for the time picker. */
const TIME_OPTIONS: { value: string; label: string }[] = (() => {
  const out: { value: string; label: string }[] = [];
  for (let h = 7; h <= 18; h++) {
    for (const mm of [0, 30]) {
      const value = `${String(h).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
      const hour12 = ((h + 11) % 12) + 1;
      const ampm = h < 12 ? "AM" : "PM";
      out.push({ value, label: `${hour12}:${String(mm).padStart(2, "0")} ${ampm}` });
    }
  }
  return out;
})();

/** Build the start/end ISO pair from a local date + time + duration (minutes). */
function slotFrom(day: string, time: string, durationMins: number): { start: string; end: string } | null {
  if (!day || !time) return null;
  const start = new Date(`${day}T${time}:00`);
  if (Number.isNaN(start.getTime())) return null;
  const end = new Date(start.getTime() + durationMins * 60000);
  return { start: start.toISOString(), end: end.toISOString() };
}

/** The local YYYY-MM-DD for an ISO instant (for syncing the date control to a slot). */
function dayOf(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** The nearest half-hour "HH:MM" for an ISO instant (for syncing the time control). */
function timeOf(iso: string): string {
  const d = new Date(iso);
  const mm = d.getMinutes() < 15 ? 0 : d.getMinutes() < 45 ? 30 : 0;
  const h = d.getMinutes() >= 45 ? (d.getHours() + 1) % 24 : d.getHours();
  return `${String(h).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
}

function todayLocal(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export default function HuddleCreate({
  people, onClose, onCreated,
}: {
  people: AssignablePerson[];
  onClose: () => void;
  onCreated: () => Promise<void>;
}) {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [kind, setKind] = useState("");
  const [templateKey, setTemplateKey] = useState("");
  const [templates, setTemplates] = useState<TemplateDTO[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [extraEmail, setExtraEmail] = useState("");
  const [extraEmails, setExtraEmails] = useState<string[]>([]);
  const [durationMins, setDurationMins] = useState(30);
  const [day, setDay] = useState(nextWeekday());
  const [time, setTime] = useState("09:00");
  const [setTimeLater, setSetTimeLater] = useState(false);
  const [finding, setFinding] = useState(false);
  const [suggest, setSuggest] = useState<SuggestResult | null>(null);
  const [pickedSlot, setPickedSlot] = useState<{ start: string; end: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // The time the Huddle will be booked at: a suggested slot the user tapped wins,
  // otherwise the date + time they chose directly. Null only when "decide later".
  const effectiveSlot = setTimeLater ? null : (pickedSlot ?? slotFrom(day, time, durationMins));

  useEffect(() => {
    getJson<{ templates: TemplateDTO[] }>("/api/huddles?view=templates")
      .then((d) => setTemplates(d.templates))
      .catch(() => setTemplates([]));
  }, []);

  function toggle(id: string) {
    setSelected((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
    setSuggest(null); setPickedSlot(null);
  }

  function attendeeEmails(): string[] {
    const sel = people.filter((p) => selected.has(p.id)).map((p) => p.email);
    return [...sel, ...extraEmails].filter(Boolean);
  }

  async function findTimes() {
    setFinding(true); setError(null); setSuggest(null); setPickedSlot(null);
    try {
      const start = new Date(`${day}T00:00:00`);
      const earliest = new Date(Math.max(Date.now(), start.getTime()));
      const latest = new Date(start.getTime() + 6 * 864e5);
      const res = await suggestTimes({
        attendeeEmails: attendeeEmails(),
        durationMins,
        earliest: earliest.toISOString(),
        latest: latest.toISOString(),
      });
      setSuggest(res);
      if (res.slots[0]) setPickedSlot({ start: res.slots[0].start, end: res.slots[0].end });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't suggest times.");
    } finally {
      setFinding(false);
    }
  }

  function addEmail() {
    const e = extraEmail.trim().toLowerCase();
    if (e && /\S+@\S+\.\S+/.test(e) && !extraEmails.includes(e)) {
      setExtraEmails((x) => [...x, e]); setExtraEmail(""); setSuggest(null); setPickedSlot(null);
    }
  }

  async function create() {
    const t = title.trim();
    if (!t) { setError("Give the Huddle a name."); return; }
    setSaving(true); setError(null);
    try {
      const attendees = [
        ...people.filter((p) => selected.has(p.id)).map((p) => ({ userId: p.id, email: p.email, name: p.name })),
        ...extraEmails.map((email) => ({ email })),
      ];
      const data = await postHuddle({
        action: "create",
        title: t,
        kind: kind || null,
        agendaTemplateKey: templateKey || null,
        attendees,
        ...(effectiveSlot ? { scheduledStart: effectiveSlot.start, scheduledEnd: effectiveSlot.end } : {}),
      });
      await onCreated();
      const meeting = data.meeting as MeetingDTO | undefined;
      if (meeting?.id) router.push(`/groundwork/huddles/${meeting.id}`);
      else onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't create the Huddle.");
      setSaving(false);
    }
  }

  return (
    <Modal title="New Huddle" onClose={onClose} wide>
      <div className="space-y-4">
        <div>
          <label className={labelClass} htmlFor="hc-title">Name</label>
          <input id="hc-title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Vero sales weekly" className={fieldClass} />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={labelClass} htmlFor="hc-kind">Kind</label>
            <select id="hc-kind" value={kind} onChange={(e) => setKind(e.target.value)} className={fieldClass}>
              {KINDS.map((k) => <option key={k.value} value={k.value}>{k.label}</option>)}
            </select>
          </div>
          <div>
            <label className={labelClass} htmlFor="hc-tpl">Agenda template</label>
            <select id="hc-tpl" value={templateKey} onChange={(e) => setTemplateKey(e.target.value)} className={fieldClass}>
              <option value="">No agenda (add live)</option>
              {templates.map((t) => <option key={t.key} value={t.key}>{t.name} · {t.itemCount} items</option>)}
            </select>
          </div>
        </div>

        <div>
          <span className={labelClass}>Attendees</span>
          <div className="max-h-44 overflow-y-auto rounded-lg border border-line p-1">
            {people.map((p, i) => (
              <label key={p.id} className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 hover:bg-[#eef5f0]">
                <input type="checkbox" checked={selected.has(p.id)} onChange={() => toggle(p.id)} className="h-4 w-4 accent-brand-600" />
                <span className="text-sm text-ink">{p.name}{i === 0 ? " (you)" : ""}</span>
                {p.branchLabel ? <span className="ml-auto text-[11px] text-muted">{p.branchLabel}</span> : null}
              </label>
            ))}
          </div>
          <div className="mt-2 flex items-center gap-2">
            <input
              value={extraEmail}
              onChange={(e) => setExtraEmail(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addEmail(); } }}
              placeholder="Add someone by email…"
              className={fieldClass}
            />
            <button type="button" onClick={addEmail} className="shrink-0 rounded-lg border border-[#cfe0d6] bg-white px-3 py-2.5 text-sm font-medium text-brand-700 hover:bg-[#eef5f0]">Add</button>
          </div>
          {extraEmails.length ? (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {extraEmails.map((e) => (
                <span key={e} className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-[12px] text-slate-600">
                  {e}
                  <button onClick={() => setExtraEmails((x) => x.filter((y) => y !== e))} aria-label={`Remove ${e}`} className="text-slate-400 hover:text-slate-700">×</button>
                </span>
              ))}
            </div>
          ) : null}
        </div>

        <div className="rounded-xl border border-line bg-[#f7faf8] p-3">
          <div className="flex items-center justify-between gap-2">
            <span className={labelClass}>When</span>
            <label className="flex cursor-pointer items-center gap-1.5 text-[12px] text-muted">
              <input type="checkbox" checked={setTimeLater} onChange={(e) => { setSetTimeLater(e.target.checked); if (e.target.checked) { setSuggest(null); setPickedSlot(null); } }} className="h-4 w-4 accent-brand-600" />
              Decide the time later
            </label>
          </div>

          {!setTimeLater ? (
            <>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <div>
                  <label className={labelClass} htmlFor="hc-day">Date</label>
                  <input
                    id="hc-day"
                    type="date"
                    value={day}
                    min={todayLocal()}
                    onChange={(e) => { setDay(e.target.value); setSuggest(null); setPickedSlot(null); }}
                    className={fieldClass}
                  />
                </div>
                <div>
                  <label className={labelClass} htmlFor="hc-time">Start time</label>
                  <select id="hc-time" value={time} onChange={(e) => { setTime(e.target.value); setPickedSlot(null); }} className={fieldClass}>
                    {TIME_OPTIONS.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                  </select>
                </div>
                <div>
                  <label className={labelClass} htmlFor="hc-dur">Length</label>
                  <select id="hc-dur" value={durationMins} onChange={(e) => { setDurationMins(Number(e.target.value)); setSuggest(null); setPickedSlot(null); }} className={fieldClass}>
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
                  {finding ? "Finding…" : "Suggest conflict-free times"}
                </button>
              </div>
            </>
          ) : (
            <p className="mt-2 text-[12px] text-muted">You can create the Huddle now and set a time later from its page.</p>
          )}

          {!setTimeLater && suggest ? (
            <div className="mt-3">
              <p className={`mb-2 inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[12px] font-medium ${suggest.availabilityKnown ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700"}`}>
                <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round"><path d={suggest.availabilityKnown ? "M5 13l4 4L19 7" : "M12 8v5m0 3h.01M12 3a9 9 0 100 18 9 9 0 000-18z"} /></svg>
                {suggest.availabilityKnown ? "Live free/busy from Google Calendar — conflicts avoided" : "Calendar not connected — business-hour suggestions (we'll give you an .ics)"}
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
                        onClick={() => { setPickedSlot({ start: s.start, end: s.end }); setDay(dayOf(s.start)); setTime(timeOf(s.start)); }}
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
          ) : !setTimeLater ? (
            <p className="mt-2 text-[12px] text-muted">Set a date and start time above, or tap <span className="font-medium text-brand-700">Suggest conflict-free times</span> to let Canopy find an opening for everyone.</p>
          ) : null}
        </div>

        {error ? <p className="text-sm text-red-600">{error}</p> : null}

        <div className="flex items-center justify-end gap-2">
          <button type="button" onClick={onClose} className="rounded-xl border border-[#cfe0d6] bg-white px-4 py-2.5 text-sm font-medium text-[#0e1b15] hover:bg-[#eef5f0]">Cancel</button>
          <button type="button" onClick={create} disabled={saving || !title.trim()} className="rounded-xl bg-emerald-grad px-4 py-2.5 text-sm font-medium text-white shadow-sm transition-[filter] hover:brightness-110 disabled:opacity-50">
            {saving ? "Creating…" : effectiveSlot ? "Create Huddle" : "Create (set time later)"}
          </button>
        </div>
      </div>
    </Modal>
  );
}
