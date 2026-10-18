"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Card } from "@/components/ui";
import { Modal, postProjects, fieldClass, labelClass, fmtDay, type ProjectDTO } from "./shared";

export default function ProjectsList({
  projects, refreshProjects, trigger,
}: {
  projects: ProjectDTO[];
  refreshProjects: () => Promise<void>;
  trigger: number;
}) {
  const [creating, setCreating] = useState(false);
  useEffect(() => { if (trigger > 0) setCreating(true); }, [trigger]);

  const active = projects.filter((p) => p.status === "active");
  const other = projects.filter((p) => p.status !== "active");

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-muted">Group work, add people, and track progress — lightweight, no Gantt.</p>
        <button onClick={() => setCreating(true)} className="inline-flex shrink-0 items-center gap-2 rounded-xl bg-emerald-grad px-3.5 py-2 text-sm font-medium text-white shadow-sm transition-[filter] hover:brightness-110">
          <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><path d="M12 5v14M5 12h14" /></svg>
          New project
        </button>
      </div>

      {projects.length === 0 ? (
        <Card className="p-8 text-center">
          <div className="mx-auto mb-3 grid h-12 w-12 place-items-center rounded-full bg-brand-50 text-brand-600">
            <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round"><path d="M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2z" /></svg>
          </div>
          <div className="font-medium text-ink">No projects yet</div>
          <div className="mt-1 text-sm text-muted">Start one when work is bigger than a single To-Do — then send it to people.</div>
          <button onClick={() => setCreating(true)} className="mt-4 inline-flex items-center gap-2 rounded-xl bg-emerald-grad px-4 py-2.5 text-sm font-medium text-white shadow-sm transition-[filter] hover:brightness-110">Create a project</button>
        </Card>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2">
            {active.map((p) => <ProjectCard key={p.id} p={p} />)}
          </div>
          {other.length ? (
            <section>
              <h2 className="mb-2 mt-2 px-1 text-xs font-semibold uppercase tracking-wide text-muted">On hold &amp; closed</h2>
              <div className="grid gap-3 sm:grid-cols-2">
                {other.map((p) => <ProjectCard key={p.id} p={p} />)}
              </div>
            </section>
          ) : null}
        </>
      )}

      {creating ? <CreateProject onClose={() => setCreating(false)} refreshProjects={refreshProjects} /> : null}
    </div>
  );
}

function ProjectCard({ p }: { p: ProjectDTO }) {
  const pct = p.progress?.pct ?? 0;
  return (
    <Link
      href={`/groundwork/projects/${p.id}`}
      className="block rounded-xl border border-line bg-card-grad p-4 shadow-[0_1px_2px_rgba(8,37,24,0.04)] transition-shadow hover:shadow-[0_6px_20px_-10px_rgba(8,37,24,0.4)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="truncate text-sm font-medium text-ink">{p.name}</div>
          <div className="mt-0.5 text-[12px] text-muted">
            {p.ownerName ? `${p.ownerName}` : "Owner"}{p.dueDate ? ` · due ${fmtDay(p.dueDate)}` : ""}
          </div>
        </div>
        {p.status !== "active" ? <span className="shrink-0 rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium capitalize text-slate-600">{p.status.replace("_", " ")}</span> : null}
      </div>
      {p.progress ? (
        <div className="mt-3">
          <div className="flex items-center justify-between text-[12px] text-muted">
            <span>{p.progress.done}/{p.progress.total} done</span>
            <span>{pct}%</span>
          </div>
          <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-black/[0.07]">
            <div className="h-full rounded-full bg-emerald-grad transition-all" style={{ width: `${pct}%` }} />
          </div>
        </div>
      ) : null}
    </Link>
  );
}

function CreateProject({ onClose, refreshProjects }: { onClose: () => void; refreshProjects: () => Promise<void> }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    const n = name.trim();
    if (!n) { setError("Give the project a name."); return; }
    setSaving(true); setError(null);
    try {
      const data = await postProjects({ action: "create", name: n, description: description || undefined, dueDate: dueDate || undefined });
      await refreshProjects();
      const proj = data.project as ProjectDTO | undefined;
      if (proj?.id) router.push(`/groundwork/projects/${proj.id}`);
      else onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't create the project.");
      setSaving(false);
    }
  }

  return (
    <Modal title="New project" onClose={onClose}>
      <div className="space-y-4">
        <div>
          <label className={labelClass} htmlFor="pc-name">Name</label>
          <input id="pc-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. New-vehicle onboarding" className={fieldClass} />
        </div>
        <div>
          <label className={labelClass} htmlFor="pc-desc">Description</label>
          <textarea id="pc-desc" value={description} onChange={(e) => setDescription(e.target.value)} rows={3} placeholder="What's this project about?" className={fieldClass} />
        </div>
        <div>
          <label className={labelClass} htmlFor="pc-due">Target date</label>
          <input id="pc-due" type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} className={fieldClass} />
        </div>
        {error ? <p className="text-sm text-red-600">{error}</p> : null}
        <div className="flex items-center justify-end gap-2">
          <button type="button" onClick={onClose} className="rounded-xl border border-[#cfe0d6] bg-white px-4 py-2.5 text-sm font-medium text-[#0e1b15] hover:bg-[#eef5f0]">Cancel</button>
          <button type="button" onClick={submit} disabled={saving || !name.trim()} className="rounded-xl bg-emerald-grad px-4 py-2.5 text-sm font-medium text-white shadow-sm transition-[filter] hover:brightness-110 disabled:opacity-50">{saving ? "Creating…" : "Create project"}</button>
        </div>
      </div>
    </Modal>
  );
}
