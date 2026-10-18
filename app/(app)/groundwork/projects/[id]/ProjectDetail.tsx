"use client";

import { useCallback, useState } from "react";
import { Card, BackLink, useToast } from "@/components/ui";
import {
  postGroundwork, postProjects, getJson, CheckOff, PriorityChip, DueChip,
  fieldClass, labelClass, fmtDay, PRIORITIES,
  type ProjectDTO, type WorkItemDTO, type AssignablePerson,
} from "../../shared";

const STATUSES = [
  { value: "active", label: "Active" },
  { value: "on_hold", label: "On hold" },
  { value: "done", label: "Done" },
  { value: "cancelled", label: "Cancelled" },
];

export default function ProjectDetail({
  initialProject, initialItems, people, meId, canManage,
}: {
  initialProject: ProjectDTO;
  initialItems: WorkItemDTO[];
  people: AssignablePerson[];
  meId: string;
  canManage: boolean;
}) {
  const { toast } = useToast();
  const [project, setProject] = useState<ProjectDTO>(initialProject);
  const [items, setItems] = useState<WorkItemDTO[]>(initialItems);
  const [busyId, setBusyId] = useState<string | null>(null);

  const nameFor = useCallback((userId: string): string => {
    if (userId === meId) return "You";
    if (userId === project.ownerId && project.ownerName) return project.ownerName;
    return people.find((p) => p.id === userId)?.name ?? "Team member";
  }, [people, project.ownerId, project.ownerName, meId]);

  const refresh = useCallback(async () => {
    const data = await getJson<{ project: ProjectDTO; items: WorkItemDTO[] }>(`/api/groundwork/projects?id=${project.id}`);
    setProject(data.project); setItems(data.items);
  }, [project.id]);

  const open = items.filter((i) => i.status !== "done" && i.status !== "cancelled");
  const done = items.filter((i) => i.status === "done");
  const pct = project.progress?.pct ?? 0;

  async function toggle(item: WorkItemDTO) {
    setBusyId(item.id);
    const nowDone = item.status !== "done";
    setItems((list) => list.map((x) => x.id === item.id ? { ...x, status: nowDone ? "done" : "todo" } : x));
    try {
      await postGroundwork({ action: "complete", id: item.id, done: nowDone });
      await refresh();
    } catch (err) {
      toast({ message: err instanceof Error ? err.message : "Couldn't update.", tone: "error" });
      await refresh();
    } finally { setBusyId(null); }
  }

  async function setStatus(status: string) {
    try {
      await postProjects({ action: "update", id: project.id, status });
      await refresh();
    } catch (err) {
      toast({ message: err instanceof Error ? err.message : "Couldn't update status.", tone: "error" });
    }
  }

  return (
    <div className="space-y-5">
      <BackLink href="/groundwork?tab=projects">Projects</BackLink>

      <Card className="p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-xl font-light tracking-tight text-ink md:text-2xl">{project.name}</h1>
            <div className="mt-1 text-sm text-muted">
              {project.ownerName ? `Owned by ${project.ownerName}` : null}
              {project.dueDate ? ` · due ${fmtDay(project.dueDate)}` : ""}
              {project.branchLabel ? ` · ${project.branchLabel}` : ""}
            </div>
            {project.description ? <p className="mt-2 max-w-prose text-sm text-ink/80">{project.description}</p> : null}
          </div>
          {canManage ? (
            <div>
              <label className={labelClass} htmlFor="pd-status">Status</label>
              <select id="pd-status" value={project.status} onChange={(e) => setStatus(e.target.value)} className={fieldClass}>
                {STATUSES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
              </select>
            </div>
          ) : (
            <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium capitalize text-slate-600">{project.status.replace("_", " ")}</span>
          )}
        </div>
        {project.progress ? (
          <div className="mt-4">
            <div className="flex items-center justify-between text-[12px] text-muted">
              <span>{project.progress.done}/{project.progress.total} tasks done</span>
              <span>{pct}%</span>
            </div>
            <div className="mt-1 h-2 w-full overflow-hidden rounded-full bg-black/[0.07]">
              <div className="h-full rounded-full bg-emerald-grad transition-all" style={{ width: `${pct}%` }} />
            </div>
          </div>
        ) : null}
      </Card>

      <div className="grid gap-5 lg:grid-cols-3">
        {/* Tasks */}
        <section className="lg:col-span-2">
          <h2 className="mb-2 px-1 text-xs font-semibold uppercase tracking-wide text-ink">Tasks</h2>
          {canManage ? <AddTask projectId={project.id} people={people} onAdded={refresh} toast={toast} /> : null}
          {open.length === 0 && done.length === 0 ? (
            <Card className="mt-3 p-6 text-center text-sm text-muted">No tasks yet. {canManage ? "Add the first one above." : ""}</Card>
          ) : (
            <Card className="mt-3 divide-y divide-line p-0">
              {open.map((item) => (
                <TaskRow key={item.id} item={item} busy={busyId === item.id} onToggle={() => toggle(item)} nameFor={nameFor} />
              ))}
              {done.map((item) => (
                <TaskRow key={item.id} item={item} busy={busyId === item.id} onToggle={() => toggle(item)} nameFor={nameFor} doneLook />
              ))}
            </Card>
          )}
        </section>

        {/* Members */}
        <section>
          <h2 className="mb-2 px-1 text-xs font-semibold uppercase tracking-wide text-ink">People</h2>
          <Card className="p-4">
            <ul className="space-y-2">
              {(project.members ?? []).map((m) => (
                <li key={m.id} className="flex items-center gap-2">
                  <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-brand-50 text-[12px] font-semibold text-brand-700">
                    {nameFor(m.userId).split(" ").map((w) => w[0]).slice(0, 2).join("").toUpperCase() || "?"}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-sm text-ink">{nameFor(m.userId)}</span>
                  <span className="shrink-0 text-[11px] capitalize text-muted">{m.role}</span>
                </li>
              ))}
            </ul>
            {canManage ? <SendToPeople project={project} people={people} onAdded={refresh} toast={toast} /> : null}
          </Card>
        </section>
      </div>
    </div>
  );
}

function TaskRow({
  item, busy, onToggle, nameFor, doneLook = false,
}: { item: WorkItemDTO; busy: boolean; onToggle: () => void; nameFor: (id: string) => string; doneLook?: boolean }) {
  return (
    <div className="flex items-start gap-3 px-4 py-3">
      <div className="pt-0.5"><CheckOff done={item.status === "done"} busy={busy} onToggle={onToggle} label={item.title} /></div>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className={`text-sm ${doneLook ? "text-muted line-through" : "text-ink"}`}>{item.title}</span>
          {!doneLook ? <PriorityChip priority={item.priority} /> : null}
        </div>
        <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5">
          {!doneLook ? <DueChip item={item} /> : null}
          {item.assigneeType === "person" && item.assigneeId ? <span className="text-[12px] text-muted">{nameFor(item.assigneeId)}</span> : null}
        </div>
      </div>
    </div>
  );
}

function AddTask({
  projectId, people, onAdded, toast,
}: { projectId: string; people: AssignablePerson[]; onAdded: () => Promise<void>; toast: (t: { message: string; tone?: "success" | "error" | "info" }) => void }) {
  const [title, setTitle] = useState("");
  const [assigneeId, setAssigneeId] = useState("");
  const [due, setDue] = useState("");
  const [priority, setPriority] = useState("normal");
  const [saving, setSaving] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const t = title.trim();
    if (!t) return;
    setSaving(true);
    try {
      await postGroundwork({
        action: "create", title: t, projectId, priority,
        dueDate: due || undefined,
        ...(assigneeId ? { assigneeType: "person", assigneeId } : {}),
      });
      setTitle(""); setAssigneeId(""); setDue(""); setPriority("normal");
      await onAdded();
    } catch (err) {
      toast({ message: err instanceof Error ? err.message : "Couldn't add task.", tone: "error" });
    } finally { setSaving(false); }
  }

  return (
    <Card className="p-3">
      <form onSubmit={submit} className="space-y-2">
        <div className="flex items-center gap-2">
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Add a task…" aria-label="New task" className="min-w-0 flex-1 bg-transparent text-sm text-ink placeholder:text-muted focus:outline-none" />
          <button type="submit" disabled={saving || !title.trim()} className="shrink-0 rounded-lg bg-emerald-grad px-3 py-1.5 text-sm font-medium text-white shadow-sm transition-[filter] hover:brightness-110 disabled:opacity-40">Add</button>
        </div>
        <div className="grid grid-cols-3 gap-2">
          <select value={assigneeId} onChange={(e) => setAssigneeId(e.target.value)} aria-label="Assign to" className={fieldClass}>
            <option value="">Assign: me</option>
            {people.slice(1).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
          <input type="date" value={due} onChange={(e) => setDue(e.target.value)} aria-label="Due date" className={fieldClass} />
          <select value={priority} onChange={(e) => setPriority(e.target.value)} aria-label="Priority" className={fieldClass}>
            {PRIORITIES.map((p) => <option key={p} value={p}>{p[0].toUpperCase() + p.slice(1)}</option>)}
          </select>
        </div>
      </form>
    </Card>
  );
}

function SendToPeople({
  project, people, onAdded, toast,
}: { project: ProjectDTO; people: AssignablePerson[]; onAdded: () => Promise<void>; toast: (t: { message: string; tone?: "success" | "error" | "info" }) => void }) {
  const [userId, setUserId] = useState("");
  const [role, setRole] = useState("member");
  const [saving, setSaving] = useState(false);
  const memberIds = new Set((project.members ?? []).map((m) => m.userId));
  const addable = people.filter((p) => !memberIds.has(p.id));

  async function add() {
    if (!userId) return;
    setSaving(true);
    try {
      await postProjects({ action: "add_member", projectId: project.id, userId, role });
      setUserId("");
      await onAdded();
      toast({ message: "Added and notified.", tone: "success" });
    } catch (err) {
      toast({ message: err instanceof Error ? err.message : "Couldn't add them.", tone: "error" });
    } finally { setSaving(false); }
  }

  if (addable.length === 0) return null;

  return (
    <div className="mt-4 border-t border-line pt-3">
      <div className={labelClass}>Send to people</div>
      <div className="flex items-center gap-2">
        <select value={userId} onChange={(e) => setUserId(e.target.value)} aria-label="Add a person" className={fieldClass}>
          <option value="">Choose a person…</option>
          {addable.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
        <select value={role} onChange={(e) => setRole(e.target.value)} aria-label="Role" className="w-28 rounded-lg border border-line bg-surface px-2 py-2.5 text-sm text-ink">
          <option value="member">Member</option>
          <option value="viewer">Viewer</option>
        </select>
        <button type="button" onClick={add} disabled={saving || !userId} className="shrink-0 rounded-lg bg-emerald-grad px-3 py-2.5 text-sm font-medium text-white shadow-sm transition-[filter] hover:brightness-110 disabled:opacity-40">Add</button>
      </div>
      <p className="mt-1.5 text-[12px] text-muted">They&apos;re notified in their Inbox and see the project here.</p>
    </div>
  );
}
