"use client";

import { useCallback, useEffect, useState } from "react";
import { PageHeader } from "@/components/ui";
import { getJson, type WorkItemDTO, type ProjectDTO, type MeetingDTO, type AssignablePerson } from "./shared";
import MyWork from "./MyWork";
import Greenhouse from "./Greenhouse";
import HuddlesList from "./HuddlesList";
import ProjectsList from "./ProjectsList";

export type MyWorkData = {
  overdue: WorkItemDTO[]; today: WorkItemDTO[]; week: WorkItemDTO[]; upcoming: WorkItemDTO[]; someday: WorkItemDTO[];
  counts: Record<string, number>; total: number;
};

type Tab = "my-work" | "huddles" | "greenhouse" | "projects";
const TABS: { key: Tab; label: string; icon: string }[] = [
  { key: "my-work", label: "My Work", icon: "M9 11l3 3L22 4M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11" },
  { key: "huddles", label: "Huddles", icon: "M17 20v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2M9 7a4 4 0 108 0 4 4 0 00-8 0zm14 13v-2a4 4 0 00-3-3.9" },
  { key: "greenhouse", label: "The Greenhouse", icon: "M12 22V12m0 0c0-2.8-2.2-5-5-5H4v1.5A4.5 4.5 0 008.5 13H12zm0-2c0-3 2.5-5.5 5.5-5.5H20v1A5 5 0 0115 10.5h-3" },
  { key: "projects", label: "Projects", icon: "M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2z" },
];

export default function GroundworkHome({
  initialTab, firstName, myWork, huddles, projects, people,
}: {
  initialTab: string;
  firstName: string;
  myWork: MyWorkData;
  huddles: MeetingDTO[];
  projects: ProjectDTO[];
  people: AssignablePerson[];
}) {
  const [tab, setTab] = useState<Tab>((["my-work", "huddles", "greenhouse", "projects"].includes(initialTab) ? initialTab : "my-work") as Tab);
  const [work, setWork] = useState<MyWorkData>(myWork);
  const [huddleList, setHuddleList] = useState<MeetingDTO[]>(huddles);
  const [projectList, setProjectList] = useState<ProjectDTO[]>(projects);
  const [newOpen, setNewOpen] = useState(false);
  // A per-kind trigger: bumping it tells the matching section to open its create form.
  const [trigger, setTrigger] = useState<{ kind: string; n: number }>({ kind: "", n: 0 });

  const refreshWork = useCallback(async () => {
    const data = await getJson<{ myWork: MyWorkData }>("/api/groundwork");
    setWork(data.myWork);
  }, []);
  const refreshHuddles = useCallback(async () => {
    const data = await getJson<{ meetings: MeetingDTO[] }>("/api/huddles");
    setHuddleList(data.meetings);
  }, []);
  const refreshProjects = useCallback(async () => {
    const data = await getJson<{ projects: ProjectDTO[] }>("/api/groundwork/projects");
    setProjectList(data.projects);
  }, []);

  // Keep the URL's ?tab in sync (deep-linkable) without a full navigation.
  useEffect(() => {
    try {
      const u = new URL(window.location.href);
      if (u.searchParams.get("tab") !== tab) {
        u.searchParams.set("tab", tab);
        window.history.replaceState(null, "", u.toString());
      }
    } catch { /* ignore */ }
  }, [tab]);

  const fire = (kind: string, target: Tab) => {
    setTab(target);
    setTrigger((t) => ({ kind, n: t.n + 1 }));
    setNewOpen(false);
  };

  const activeOpen = work.counts.overdue + work.counts.today + work.counts.week + work.counts.upcoming;

  return (
    <>
      <PageHeader
        title="Groundwork"
        subtitle="Your work home — To-Dos, Huddles, ideas, and projects, all in one calm place."
        actions={<NewMenu open={newOpen} setOpen={setNewOpen} onPick={fire} />}
      />

      {/* Segmented sections — exactly four, no deeper nesting. */}
      <div className="mb-5 flex gap-1 overflow-x-auto rounded-xl bg-black/[0.04] p-1" role="tablist" aria-label="Groundwork sections">
        {TABS.map((t) => {
          const active = tab === t.key;
          const count = t.key === "my-work" ? activeOpen : t.key === "greenhouse" ? work.counts.someday : t.key === "huddles" ? huddleList.filter((h) => h.status !== "cancelled").length : projectList.filter((p) => p.status === "active").length;
          return (
            <button
              key={t.key}
              role="tab"
              aria-selected={active}
              onClick={() => setTab(t.key)}
              className={`flex min-w-fit flex-1 items-center justify-center gap-2 whitespace-nowrap rounded-lg px-3 py-2 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 ${
                active ? "bg-white text-ink shadow-sm" : "text-muted hover:text-ink"
              }`}
            >
              <svg viewBox="0 0 24 24" className="h-4 w-4 shrink-0" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={t.icon} /></svg>
              <span>{t.label}</span>
              {count > 0 ? <span className={`rounded-full px-1.5 text-[11px] ${active ? "bg-brand-50 text-brand-700" : "bg-black/5 text-muted"}`}>{count}</span> : null}
            </button>
          );
        })}
      </div>

      {tab === "my-work" ? (
        <MyWork
          firstName={firstName}
          work={work}
          setWork={setWork}
          refreshWork={refreshWork}
          people={people}
          trigger={trigger.kind === "todo" ? trigger.n : 0}
          onPeek={() => setTab("greenhouse")}
        />
      ) : null}
      {tab === "greenhouse" ? (
        <Greenhouse
          ideas={work.someday}
          refreshWork={refreshWork}
          refreshProjects={refreshProjects}
          trigger={trigger.kind === "idea" ? trigger.n : 0}
          onGrewProject={() => setTab("projects")}
        />
      ) : null}
      {tab === "huddles" ? (
        <HuddlesList
          huddles={huddleList}
          refreshHuddles={refreshHuddles}
          people={people}
          trigger={trigger.kind === "huddle" ? trigger.n : 0}
        />
      ) : null}
      {tab === "projects" ? (
        <ProjectsList
          projects={projectList}
          refreshProjects={refreshProjects}
          trigger={trigger.kind === "project" ? trigger.n : 0}
        />
      ) : null}
    </>
  );
}

function NewMenu({
  open, setOpen, onPick,
}: { open: boolean; setOpen: (v: boolean) => void; onPick: (kind: string, tab: "my-work" | "huddles" | "greenhouse" | "projects") => void }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    const onClick = () => setOpen(false);
    document.addEventListener("keydown", onKey);
    // Defer so the opening click doesn't immediately close it.
    const t = setTimeout(() => document.addEventListener("click", onClick), 0);
    return () => { document.removeEventListener("keydown", onKey); document.removeEventListener("click", onClick); clearTimeout(t); };
  }, [open, setOpen]);

  const items: { kind: string; tab: "my-work" | "huddles" | "greenhouse" | "projects"; label: string; hint: string; icon: string }[] = [
    { kind: "todo", tab: "my-work", label: "To-Do", hint: "Something to do", icon: "M9 11l3 3L22 4M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11" },
    { kind: "huddle", tab: "huddles", label: "Huddle", hint: "A meeting with an agenda", icon: "M17 20v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2M9 7a4 4 0 108 0 4 4 0 00-8 0z" },
    { kind: "idea", tab: "greenhouse", label: "Idea", hint: "Plant it in The Greenhouse", icon: "M12 22V12m0-2c0-2.8-2.2-5-5-5H4v1.5A4.5 4.5 0 008.5 13H12z" },
    { kind: "project", tab: "projects", label: "Project", hint: "Group work + send to people", icon: "M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2z" },
  ];

  return (
    <div className="relative" onClick={(e) => e.stopPropagation()}>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-haspopup="menu"
        aria-expanded={open}
        className="inline-flex items-center justify-center gap-2 rounded-xl bg-emerald-grad px-4 py-2.5 text-sm font-medium text-white shadow-sm shadow-black/10 transition-[filter] hover:brightness-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2 focus-visible:ring-offset-[#f4f6f5]"
      >
        <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><path d="M12 5v14M5 12h14" /></svg>
        New
      </button>
      {open ? (
        <div role="menu" className="absolute right-0 z-20 mt-2 w-60 overflow-hidden rounded-xl border border-line bg-white p-1 shadow-xl">
          {items.map((it) => (
            <button
              key={it.kind}
              role="menuitem"
              onClick={() => onPick(it.kind, it.tab)}
              className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left hover:bg-[#eef5f0] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
            >
              <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-brand-50 text-brand-600">
                <svg viewBox="0 0 24 24" className="h-4.5 w-4.5" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round"><path d={it.icon} /></svg>
              </span>
              <span className="min-w-0">
                <span className="block text-sm font-medium text-ink">{it.label}</span>
                <span className="block text-[12px] text-muted">{it.hint}</span>
              </span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
