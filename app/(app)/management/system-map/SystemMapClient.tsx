"use client";

import { useState } from "react";
import { Card, EmptyState } from "@/components/ui";
import {
  STATUS_META,
  type Domain,
  type ProcessFlow,
  type WorkflowStatus,
} from "@/lib/system-map-shared";
import Mermaid from "./Mermaid";

const ROLE_CHIP: Record<string, string> = {
  Employee: "bg-slate-100 text-slate-700",
  "Branch Manager": "bg-emerald-100 text-emerald-800",
  HR: "bg-violet-100 text-violet-800",
  Leadership: "bg-amber-100 text-amber-800",
  "Board Observer": "bg-sky-100 text-sky-800",
  Admin: "bg-rose-100 text-rose-800",
};

function StatusChip({ status }: { status: WorkflowStatus }) {
  const m = STATUS_META[status];
  return (
    <span className={`inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold ${m.chip}`}>
      <span aria-hidden>{m.emoji}</span>
      {m.label}
    </span>
  );
}

const STATUS_ORDER: WorkflowStatus[] = ["contradicts", "stale", "missing", "aligned"];

export default function SystemMapClient({
  domains,
  interconnection,
  flows,
}: {
  domains: Domain[];
  interconnection: string;
  flows: ProcessFlow[];
}) {
  const [flowKey, setFlowKey] = useState(flows[0]?.key ?? "");
  const activeFlow = flows.find((f) => f.key === flowKey) ?? flows[0];

  const totals = domains
    .flatMap((d) => d.workflows)
    .reduce<Record<WorkflowStatus, number>>(
      (acc, w) => {
        acc[w.status] += 1;
        return acc;
      },
      { aligned: 0, stale: 0, contradicts: 0, missing: 0 },
    );
  const totalCount = Object.values(totals).reduce((a, b) => a + b, 0);

  return (
    <div className="space-y-8">
      {/* Status summary strip */}
      <div className="flex flex-wrap gap-2">
        <span className="inline-flex items-center rounded-full bg-black/5 px-3 py-1 text-xs font-medium text-ink">
          {totalCount} workflows · {domains.length} domains
        </span>
        {STATUS_ORDER.map((s) =>
          totals[s] > 0 ? (
            <span key={s} className={`inline-flex items-center gap-1 rounded-full px-3 py-1 text-xs font-semibold ${STATUS_META[s].chip}`}>
              <span aria-hidden>{STATUS_META[s].emoji}</span>
              {totals[s]} {STATUS_META[s].label.toLowerCase()}
            </span>
          ) : null,
        )}
      </div>

      {/* Interconnection map */}
      <section>
        <div className="mb-3">
          <h2 className="text-lg font-medium text-ink">Interconnection map</h2>
          <p className="text-sm text-muted">How the operating centers connect. Dashed edges are the key cross-center handoffs.</p>
        </div>
        <Card className="p-3">
          <Mermaid chart={interconnection} />
        </Card>
      </section>

      {/* Role-by-role process flows */}
      <section>
        <div className="mb-3">
          <h2 className="text-lg font-medium text-ink">Role-by-role process flows</h2>
          <p className="text-sm text-muted">Step-by-step handoffs between the people involved in a workflow.</p>
        </div>
        <div className="mb-3 flex flex-wrap gap-2">
          {flows.map((f) => (
            <button
              key={f.key}
              type="button"
              onClick={() => setFlowKey(f.key)}
              className={`rounded-xl px-3 py-2 text-left text-xs font-medium transition-colors ${
                f.key === activeFlow?.key
                  ? "bg-emerald-grad text-[#05271c] shadow-sm"
                  : "border border-line bg-white text-ink hover:bg-black/[0.03]"
              }`}
            >
              {f.title}
            </button>
          ))}
        </div>
        {activeFlow ? (
          <Card className="p-3">
            <p className="px-1 pb-2 text-xs text-muted">{activeFlow.description}</p>
            <Mermaid key={activeFlow.key} chart={activeFlow.mermaid} />
          </Card>
        ) : null}
      </section>

      {/* Workflow directory */}
      <section>
        <div className="mb-3">
          <h2 className="text-lg font-medium text-ink">Workflow directory</h2>
          <p className="text-sm text-muted">The parsed registry, grouped by domain. Status, routes, and the roles each workflow involves.</p>
        </div>
        {domains.length === 0 ? (
          <EmptyState title="No workflows parsed" hint="Could not read docs/WORKFLOWS.md — check the registry file." />
        ) : (
          <div className="grid gap-5 lg:grid-cols-2">
            {domains.map((d) => (
              <Card key={d.name} className="p-0 overflow-hidden">
                <div className="flex items-center justify-between border-b border-line px-4 py-3">
                  <div className="text-sm font-semibold text-ink">{d.name}</div>
                  <span className="text-[11px] text-muted">{d.workflows.length} workflow{d.workflows.length === 1 ? "" : "s"}</span>
                </div>
                <ul className="divide-y divide-line">
                  {d.workflows.map((w, i) => (
                    <li key={i} className="px-4 py-3">
                      <div className="flex items-start justify-between gap-3">
                        <div className="text-sm font-medium text-ink">{w.name}</div>
                        <StatusChip status={w.status} />
                      </div>
                      {w.routes.length > 0 ? (
                        <div className="mt-1.5 flex flex-wrap gap-1">
                          {w.routes.map((r) => (
                            <code key={r} className="rounded bg-black/[0.05] px-1.5 py-0.5 text-[10px] text-ink/80">
                              {r}
                            </code>
                          ))}
                        </div>
                      ) : null}
                      {w.roles.length > 0 ? (
                        <div className="mt-1.5 flex flex-wrap gap-1">
                          {w.roles.map((role) => (
                            <span key={role} className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium ${ROLE_CHIP[role] ?? "bg-black/5 text-ink"}`}>
                              {role}
                            </span>
                          ))}
                        </div>
                      ) : null}
                    </li>
                  ))}
                </ul>
              </Card>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
