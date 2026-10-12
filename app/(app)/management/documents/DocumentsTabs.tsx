"use client";

import { useState } from "react";

// Two-tab shell for the unified Documents page: "Add" is the agentic intake chat
// (the one way documents come IN), "Filed" is the vehicle-document library (what
// has been filed). Both panes stay mounted (toggled with `hidden`) so the chat
// keeps its state when switching tabs. Filed is only passed in for exec/HR.
export default function DocumentsTabs({
  initialTab, canSeeFiled, add, filed,
}: {
  initialTab?: string;
  canSeeFiled: boolean;
  add: React.ReactNode;
  filed: React.ReactNode;
}) {
  const [tab, setTab] = useState<"add" | "filed">(initialTab === "filed" && canSeeFiled ? "filed" : "add");

  return (
    <>
      <div className="mb-5 flex gap-1 border-b border-line">
        <TabBtn active={tab === "add"} onClick={() => setTab("add")}>Add a document</TabBtn>
        {canSeeFiled ? <TabBtn active={tab === "filed"} onClick={() => setTab("filed")}>Filed</TabBtn> : null}
      </div>
      <div hidden={tab !== "add"}>{add}</div>
      {canSeeFiled ? <div hidden={tab !== "filed"}>{filed}</div> : null}
    </>
  );
}

function TabBtn({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`-mb-px border-b-2 px-4 py-2 text-sm font-medium transition-colors ${
        active ? "border-brand-600 text-brand-700" : "border-transparent text-muted hover:text-ink"
      }`}
    >
      {children}
    </button>
  );
}
