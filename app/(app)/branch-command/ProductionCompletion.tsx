"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Card, btn } from "@/components/ui";
import { rampColor } from "@/components/motivation";

// Branch Command — Production & Completion. Managers upload the six PestPac exports in
// one drop; Canopy compares them to the monthly schedule and shows per-route completion,
// pacing, and the jobs-left-behind gameplan. Data is computed server-side (the engine);
// this renders it + the upload flow + the per-job "addressed + plan" accountability.

export type RouteRow = {
  route: string; techName: string | null;
  scheduledCount: number; scheduledDollars: number; completedCount: number; completionPct: number;
  expectedPct: number; status: string; leftBehindCount: number; leftBehindDollars: number;
  remainingCount: number; projectedPct: number; callbacks: number;
  netRouteChange: number; netRouteChangeDollars: number;
};
export type LeftBehindJob = { id: string; route: string; account: string; customer: string | null; service: string | null; scheduledDate: string | null; dollars: number; status: string; managerNote: string | null };
export type Totals = { scheduled: number; completed: number; completionPct: number; leftBehind: number; leftBehindDollars: number; remaining: number; callbacks: number; netChange: number; netChangeDollars: number };

const money = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;
const STATUS: Record<string, string> = { ahead: "text-brand-700 bg-brand-50 border-brand-200", on_pace: "text-brand-700 bg-brand-50 border-brand-200", behind: "text-amber-700 bg-amber-50 border-amber-200", critical: "text-red-700 bg-red-50 border-red-200" };
const STATUS_LABEL: Record<string, string> = { ahead: "Ahead", on_pace: "On pace", behind: "Behind", critical: "Critical" };

function IconChevron({ className = "" }: { className?: string }) {
  return <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth={1.6}><path d="m6 9 6 6 6-6" strokeLinecap="round" strokeLinejoin="round" /></svg>;
}
function IconCheck({ className = "" }: { className?: string }) {
  return <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth={1.8}><path d="M20 6 9 17l-5-5" strokeLinecap="round" strokeLinejoin="round" /></svg>;
}

export default function ProductionCompletion({
  branch, periodKey, routes, totals, leftBehind, uploads, canUpload,
}: {
  branch: string; periodKey: string | null; routes: RouteRow[]; totals: Totals;
  leftBehind: LeftBehindJob[]; uploads: { type: string; fileName: string; rows: number }[]; canUpload: boolean;
}) {
  // Group left-behind jobs by route for a collapsible, per-route gameplan (one or all routes).
  const techByRoute = new Map(routes.map((r) => [r.route, r.techName] as const));
  const groups = (() => {
    const m = new Map<string, LeftBehindJob[]>();
    for (const j of leftBehind) { const a = m.get(j.route) ?? []; a.push(j); m.set(j.route, a); }
    return [...m.entries()]
      .sort((a, b) => a[0].localeCompare(b[0], undefined, { numeric: true }))
      .map(([route, jobs]) => ({ route, techName: techByRoute.get(route) ?? null, jobs, open: jobs.filter((j) => j.status !== "addressed").length, dollars: jobs.reduce((s, j) => s + j.dollars, 0) }));
  })();
  // Default: open the routes that still have unaddressed jobs.
  const [openRoutes, setOpenRoutes] = useState<Set<string>>(() => new Set(leftBehind.filter((j) => j.status !== "addressed").map((j) => j.route)));
  const toggleRoute = (r: string) => setOpenRoutes((s) => { const n = new Set(s); if (n.has(r)) n.delete(r); else n.add(r); return n; });
  const allOpen = groups.length > 0 && groups.every((g) => openRoutes.has(g.route));
  const setAllRoutes = (open: boolean) => setOpenRoutes(open ? new Set(groups.map((g) => g.route)) : new Set());
  const focusRoute = (r: string) => { setOpenRoutes(new Set([r])); requestAnimationFrame(() => setTimeout(() => document.getElementById(`lb-${r}`)?.scrollIntoView({ behavior: "smooth", block: "center" }), 100)); };

  return (
    <Card className="p-0 overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-3">
        <div>
          <div className="text-sm font-medium text-ink">Production &amp; Completion</div>
          <div className="text-[11px] text-muted">{periodKey ? `Month ${periodKey} — schedule vs. completed, and what's been left behind` : "Upload this month's PestPac reports to compare plan vs. completed"}</div>
        </div>
        {canUpload && <UploadButton />}
      </div>

      {!periodKey || routes.length === 0 ? (
        <div className="px-4 py-6 text-sm text-muted">
          No production loaded yet.{canUpload ? " Use Upload reports to drop this month's six PestPac exports (the Technician Schedule Report is required as the baseline)." : " Ask an admin or your manager to load this month's reports."}
        </div>
      ) : (
        <>
          {/* Per-route table (headline totals live in the command hero above) */}
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-sm">
              <thead>
                <tr className="text-[11px] uppercase tracking-wide text-muted">
                  <th className="px-3 py-2 text-left">Route</th>
                  <th className="px-3 py-2 text-right">Scheduled $</th>
                  <th className="px-3 py-2 text-right">Done / Sched</th>
                  <th className="px-3 py-2 text-right">Comp%</th>
                  <th className="px-3 py-2 text-center">Pace</th>
                  <th className="px-3 py-2 text-right">Left behind</th>
                  <th className="px-3 py-2 text-right">Callbacks</th>
                  <th className="px-3 py-2 text-right">Proj.</th>
                  <th className="px-3 py-2 text-right">Route net</th>
                </tr>
              </thead>
              <tbody>
                {routes.map((r) => (
                  <tr key={r.route} className={`border-t border-line ${openRoutes.has(r.route) && r.leftBehindCount > 0 ? "bg-brand-50/50" : ""}`}>
                    <td className="px-3 py-2"><span className="font-medium">{r.route}</span> <span className="text-xs text-muted">{r.techName}</span></td>
                    <td className="px-3 py-2 text-right tabular-nums font-medium">{money(r.scheduledDollars)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{r.completedCount}/{r.scheduledCount}</td>
                    <td className="px-3 py-2">
                      <div className="flex items-center justify-end gap-2">
                        <div className="h-1.5 w-16 overflow-hidden rounded-full bg-black/[0.06]" aria-hidden>
                          <div className="h-full rounded-full" style={{ width: `${Math.min(100, r.completionPct)}%`, backgroundColor: rampColor(r.completionPct) }} />
                        </div>
                        <span className="w-10 text-right tabular-nums">{r.completionPct}%</span>
                      </div>
                    </td>
                    <td className="px-3 py-2 text-center"><span className={`rounded-full border px-2 py-0.5 text-[10px] font-medium ${STATUS[r.status] ?? STATUS.on_pace}`}>{STATUS_LABEL[r.status] ?? r.status}</span></td>
                    <td className="px-3 py-2 text-right">
                      {r.leftBehindCount > 0 ? (
                        <button onClick={() => focusRoute(r.route)} className="font-medium text-red-600 hover:underline tabular-nums">{r.leftBehindCount} · {money(r.leftBehindDollars)}</button>
                      ) : <span className="text-muted">0</span>}
                    </td>
                    <td className={`px-3 py-2 text-right tabular-nums ${r.callbacks > 0 ? "text-amber-700" : "text-muted"}`}>{r.callbacks}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{r.projectedPct}%</td>
                    <td className={`px-3 py-2 text-right tabular-nums ${r.netRouteChangeDollars < 0 ? "text-red-600" : r.netRouteChangeDollars > 0 ? "text-brand-700" : "text-muted"}`}>{r.netRouteChange >= 0 ? "+" : ""}{r.netRouteChange} · {money(r.netRouteChangeDollars)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Left-behind gameplan — grouped by route, collapsible (one or all) */}
          <div id="leftbehind" className="scroll-mt-4 border-t border-line px-4 py-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <div className="text-sm font-medium text-ink">Jobs left behind <span className="text-xs font-normal text-muted">({leftBehind.length} across {groups.length} route{groups.length === 1 ? "" : "s"})</span></div>
                <p className="mt-0.5 text-[11px] text-muted">Past-due, not completed, and not on the board ahead. Address each: confirm it&apos;s rescheduled or note the plan.</p>
              </div>
              {groups.length > 0 && <button onClick={() => setAllRoutes(!allOpen)} className="text-xs font-medium text-brand-600 hover:underline">{allOpen ? "Collapse all" : "Expand all"}</button>}
            </div>
            <div className="mt-2 space-y-2">
              {groups.length === 0 ? (
                <p className="py-3 text-sm text-muted">Nothing left behind — nice work.</p>
              ) : groups.map((g) => {
                const isOpen = openRoutes.has(g.route);
                const addressed = g.jobs.length - g.open;
                const done = g.open === 0;
                return (
                  <div key={g.route} id={`lb-${g.route}`} className="scroll-mt-4 overflow-hidden rounded-lg border border-line">
                    <button onClick={() => toggleRoute(g.route)} className="flex w-full items-center gap-3 px-3 py-2.5 text-left hover:bg-black/[0.02]">
                      <span className={`grid h-6 w-6 shrink-0 place-items-center rounded-full text-[11px] font-semibold text-white ${done ? "bg-brand-500" : "bg-red-500"}`}>
                        {done ? <IconCheck className="h-3.5 w-3.5" /> : g.open}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium text-ink">Route {g.route}{g.techName ? ` · ${g.techName}` : ""}</span>
                        <span className="block text-[11px] text-muted">{g.jobs.length} left behind · {money(g.dollars)} · <span className={done ? "text-brand-700" : "text-amber-700"}>{addressed}/{g.jobs.length} addressed</span></span>
                      </span>
                      <IconChevron className={`h-4 w-4 shrink-0 text-muted transition-transform ${isOpen ? "rotate-180" : ""}`} />
                    </button>
                    {isOpen ? <div className="space-y-1.5 border-t border-line px-3 py-2.5">{g.jobs.map((j) => <JobRow key={j.id} job={j} branch={branch} />)}</div> : null}
                  </div>
                );
              })}
            </div>
          </div>

          {uploads.length > 0 && (
            <div className="border-t border-line px-4 py-2 text-[11px] text-muted">Loaded: {uploads.map((u) => `${u.type} (${u.rows})`).join(" · ")}</div>
          )}
        </>
      )}
    </Card>
  );
}

function JobRow({ job, branch }: { job: LeftBehindJob; branch: string }) {
  const router = useRouter();
  const [addressed, setAddressed] = useState(job.status === "addressed");
  const [note, setNote] = useState(job.managerNote ?? "");
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);

  async function save(next: boolean) {
    setBusy(true);
    try {
      await fetch("/api/branch-command/production", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "addressJob", id: job.id, status: next ? "addressed" : "open", note }) });
      setAddressed(next);
    } finally { setBusy(false); router.refresh(); }
  }

  return (
    <div className={`rounded-lg border px-3 py-2 ${addressed ? "border-brand-200 bg-brand-50/40" : "border-line"}`}>
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="rounded-full border border-line px-2 py-0.5 text-[11px] text-muted">rt {job.route}</span>
        <span className="font-medium text-ink">{job.customer ?? `Acct ${job.account}`}</span>
        <span className="text-xs text-muted">{job.service} · {job.scheduledDate ?? ""} · {money(job.dollars)}</span>
        <div className="ml-auto flex items-center gap-2">
          <button onClick={() => setOpen((o) => !o)} className="text-xs text-brand-600 hover:underline">{open ? "Hide" : "Plan"}</button>
          <button disabled={busy} onClick={() => save(!addressed)} className={`rounded-md border px-2 py-0.5 text-[11px] ${addressed ? "border-brand-500 bg-brand-50 text-brand-700" : "border-line text-muted hover:bg-black/5"}`}>{addressed ? "Addressed" : "Mark addressed"}</button>
        </div>
      </div>
      {open && (
        <div className="mt-2 flex flex-col gap-2 sm:flex-row">
          <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Plan: rescheduled to…, called customer, reassigned…" className="flex-1 rounded-lg border border-line px-2 py-1.5 text-sm" />
          <button disabled={busy} onClick={() => save(addressed)} className={`${btn.secondary} self-start`}>Save plan</button>
        </div>
      )}
      {!open && addressed && note && <p className="mt-1 text-xs text-muted"><span className="text-brand-700">Plan:</span> {note}</p>}
      <input type="hidden" value={branch} readOnly />
    </div>
  );
}

function UploadButton() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [preview, setPreview] = useState<{ ok?: boolean; periodKey?: string; detected?: { fileName: string; type: string; rows: number }[]; missing?: string[]; error?: string } | null>(null);
  const [files, setFiles] = useState<{ fileName: string; text: string }[]>([]);

  async function onPick(list: FileList | null) {
    if (!list || list.length === 0) return;
    setErr(null); setBusy(true);
    try {
      const read = await Promise.all(Array.from(list).map(async (f) => ({ fileName: f.name, text: await f.text() })));
      setFiles(read);
      const r = await fetch("/api/branch-command/production", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "preview", files: read }) });
      const j = await r.json();
      setPreview(j);
      if (!j.ok && j.error) setErr(j.error);
    } catch { setErr("Could not read the files."); } finally { setBusy(false); }
  }
  async function apply() {
    setBusy(true); setErr(null);
    try {
      const r = await fetch("/api/branch-command/production", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "apply", files }) });
      const j = await r.json();
      if (!j.ok) { setErr(j.error ?? "Upload failed."); return; }
      setOpen(false); setPreview(null); setFiles([]); router.refresh();
    } finally { setBusy(false); }
  }

  if (!open) return <button onClick={() => setOpen(true)} className={btn.secondary}>Upload reports</button>;
  return (
    <div className="w-full rounded-lg border border-line bg-black/[0.015] p-3">
      <div className="flex items-center justify-between">
        <div className="text-sm font-medium text-ink">Upload this month&apos;s PestPac reports</div>
        <button onClick={() => { setOpen(false); setPreview(null); setErr(null); }} className="text-xs text-muted hover:underline">Cancel</button>
      </div>
      <p className="mt-0.5 text-[11px] text-muted">Drop all six at once — Schedule (required), Production, Appointment List, Unserviced, Gain &amp; Loss, Call Back. Canopy detects each automatically.</p>
      <input type="file" multiple accept=".xls,.xlsx,.csv,.tsv,.txt" onChange={(e) => onPick(e.target.files)} className="mt-2 block w-full text-sm" />
      {err && <div className="mt-2 rounded-lg border border-red-200 bg-red-50 px-2 py-1.5 text-xs text-red-700">{err}</div>}
      {preview?.detected && (
        <div className="mt-2 text-xs">
          <div className="text-muted">Detected{preview.periodKey ? ` · month ${preview.periodKey}` : ""}:</div>
          <ul className="mt-1 space-y-0.5">
            {preview.detected.map((d, i) => (
              <li key={i} className={d.type === "unknown" ? "text-amber-700" : "text-ink"}>{d.type === "unknown" ? "? unrecognized" : d.type} — {d.fileName} ({d.rows} rows)</li>
            ))}
          </ul>
          {preview.missing && preview.missing.length > 0 && <div className="mt-1 text-amber-700">Missing (optional): {preview.missing.join(", ")}</div>}
          {preview.ok !== false && (
            <button disabled={busy} onClick={apply} className={`${btn.primary} mt-2`}>{busy ? "Applying…" : "Apply & compute"}</button>
          )}
        </div>
      )}
    </div>
  );
}
