"use client";

import { useEffect, useRef, useState } from "react";
import { Card } from "@/components/ui";
import { useToast } from "@/components/ui";
import AskCanopy from "@/components/AskCanopy";
import {
  postGroundwork, postProjects, fieldClass, labelClass, fmtDay,
  type WorkItemDTO,
} from "./shared";

export default function Greenhouse({
  ideas, refreshWork, refreshProjects, trigger, onGrewProject,
}: {
  ideas: WorkItemDTO[];
  refreshWork: () => Promise<void>;
  refreshProjects: () => Promise<void>;
  trigger: number;
  onGrewProject: () => void;
}) {
  const { toast } = useToast();
  const [title, setTitle] = useState("");
  const [saving, setSaving] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const captureRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => { if (trigger > 0) captureRef.current?.focus(); }, [trigger]);

  async function plant(e: React.FormEvent) {
    e.preventDefault();
    const t = title.trim();
    if (!t) return;
    setSaving(true);
    try {
      await postGroundwork({ action: "create", title: t, horizon: "someday" });
      setTitle("");
      await refreshWork();
      captureRef.current?.focus();
    } catch (err) {
      toast({ message: err instanceof Error ? err.message : "Couldn't save that idea.", tone: "error" });
    } finally {
      setSaving(false);
    }
  }

  async function archive(idea: WorkItemDTO) {
    try {
      await postGroundwork({ action: "cancel", id: idea.id, cancelled: true });
      await refreshWork();
    } catch (err) {
      toast({ message: err instanceof Error ? err.message : "Couldn't archive.", tone: "error" });
    }
  }

  return (
    <div className="space-y-4">
      <Card className="p-4">
        <div className="flex items-start gap-3">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-brand-50 text-brand-600">
            <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round"><path d="M12 22V12m0-2c0-2.8-2.2-5-5-5H4v1.5A4.5 4.5 0 008.5 13H12zm0 2c0-3 2.5-5.5 5.5-5.5H20v1A5 5 0 0115 10.5h-3" /></svg>
          </span>
          <div className="min-w-0">
            <h2 className="text-base font-medium text-ink">The Greenhouse</h2>
            <p className="text-sm text-muted">Where good ideas wait so they don&apos;t get lost. Capture one now; when it&apos;s ready, let it grow into a To-Do or a project.</p>
          </div>
        </div>
        <form onSubmit={plant} className="mt-3 flex items-center gap-2">
          <input
            ref={captureRef}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Plant an idea…"
            aria-label="New idea"
            className="min-w-0 flex-1 rounded-lg border border-line bg-surface px-3 py-2.5 text-sm text-ink placeholder:text-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
          />
          <button type="submit" disabled={saving || !title.trim()} className="shrink-0 rounded-lg bg-emerald-grad px-3 py-2.5 text-sm font-medium text-white shadow-sm transition-[filter] hover:brightness-110 disabled:opacity-40">
            Plant
          </button>
        </form>
      </Card>

      {ideas.length === 0 ? (
        <Card className="p-8 text-center">
          <div className="font-medium text-ink">Nothing planted yet</div>
          <div className="mt-1 text-sm text-muted">Ideas you capture here stay out of your daily work until you&apos;re ready for them.</div>
          <div className="mt-3"><AskCanopy task="Add this idea to my Greenhouse: " label="Ask Canopy to capture an idea" variant="button" /></div>
        </Card>
      ) : (
        <Card className="divide-y divide-line p-0">
          {ideas.map((idea) => (
            <div key={idea.id} className="px-4 py-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-sm text-ink">{idea.title}</div>
                  <div className="mt-0.5 text-[12px] text-muted">Planted {fmtDay(idea.createdAt)}</div>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <button
                    onClick={() => setOpenId(openId === idea.id ? null : idea.id)}
                    aria-expanded={openId === idea.id}
                    className="rounded-lg border border-[#cfe0d6] bg-white px-2.5 py-1.5 text-[12px] font-medium text-brand-700 hover:bg-[#eef5f0] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
                  >
                    Grow →
                  </button>
                  <button onClick={() => archive(idea)} aria-label="Archive idea" className="rounded-lg p-1.5 text-muted hover:bg-black/5 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500">
                    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round"><path d="M6 6l12 12M18 6L6 18" /></svg>
                  </button>
                </div>
              </div>
              {openId === idea.id ? (
                <GrowPanel
                  idea={idea}
                  onClose={() => setOpenId(null)}
                  refreshWork={refreshWork}
                  refreshProjects={refreshProjects}
                  onGrewProject={onGrewProject}
                  toast={toast}
                />
              ) : null}
            </div>
          ))}
        </Card>
      )}
    </div>
  );
}

function GrowPanel({
  idea, onClose, refreshWork, refreshProjects, onGrewProject, toast,
}: {
  idea: WorkItemDTO;
  onClose: () => void;
  refreshWork: () => Promise<void>;
  refreshProjects: () => Promise<void>;
  onGrewProject: () => void;
  toast: (t: { message: string; tone?: "success" | "error" | "info" }) => void;
}) {
  const [due, setDue] = useState("");
  const [horizon, setHorizon] = useState("now");
  const [busy, setBusy] = useState(false);

  async function toTodo() {
    setBusy(true);
    try {
      await postGroundwork({ action: "update", id: idea.id, horizon, dueDate: due || undefined });
      await refreshWork();
      onClose();
      toast({ message: `"${idea.title}" is now on your To-Dos.`, tone: "success" });
    } catch (err) {
      toast({ message: err instanceof Error ? err.message : "Couldn't promote.", tone: "error" });
    } finally { setBusy(false); }
  }

  async function toProject() {
    setBusy(true);
    try {
      await postProjects({ action: "create", name: idea.title, description: idea.notes || undefined });
      // The idea has grown into a project — archive the Greenhouse card.
      await postGroundwork({ action: "cancel", id: idea.id, cancelled: true });
      await Promise.all([refreshWork(), refreshProjects()]);
      onClose();
      onGrewProject();
      toast({ message: `"${idea.title}" grew into a project.`, tone: "success" });
    } catch (err) {
      toast({ message: err instanceof Error ? err.message : "Couldn't grow a project.", tone: "error" });
    } finally { setBusy(false); }
  }

  return (
    <div className="mt-3 rounded-xl border border-line bg-[#f7faf8] p-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="rounded-lg bg-white p-3 ring-1 ring-line">
          <div className="text-sm font-medium text-ink">Make it a To-Do</div>
          <p className="text-[12px] text-muted">Bring it into your daily work.</p>
          <div className="mt-2 grid grid-cols-2 gap-2">
            <div>
              <label className={labelClass} htmlFor={`g-h-${idea.id}`}>Horizon</label>
              <select id={`g-h-${idea.id}`} value={horizon} onChange={(e) => setHorizon(e.target.value)} className={fieldClass}>
                <option value="now">Now</option>
                <option value="week">This week</option>
              </select>
            </div>
            <div>
              <label className={labelClass} htmlFor={`g-d-${idea.id}`}>Due</label>
              <input id={`g-d-${idea.id}`} type="date" value={due} onChange={(e) => setDue(e.target.value)} className={fieldClass} />
            </div>
          </div>
          <button onClick={toTodo} disabled={busy} className="mt-3 w-full rounded-lg bg-emerald-grad px-3 py-2 text-sm font-medium text-white shadow-sm transition-[filter] hover:brightness-110 disabled:opacity-50">Add to To-Dos</button>
        </div>
        <div className="rounded-lg bg-white p-3 ring-1 ring-line">
          <div className="text-sm font-medium text-ink">Grow a project</div>
          <p className="text-[12px] text-muted">When it&apos;s bigger than one task — group work and send it to people.</p>
          <button onClick={toProject} disabled={busy} className="mt-3 w-full rounded-lg border border-[#cfe0d6] bg-white px-3 py-2 text-sm font-medium text-brand-700 hover:bg-[#eef5f0] disabled:opacity-50">Create a project</button>
        </div>
      </div>
    </div>
  );
}
