"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Card, btn } from "@/components/ui";

// Branch Command — Production & Completion. Managers upload the six PestPac exports in
// one drop; Canopy compares them to the monthly schedule and shows per-route completion,
// pacing, and the jobs-left-behind gameplan. Data is computed server-side (the engine);
// this renders it + the upload flow + the per-job "addressed + plan" accountability.

export type RouteRow = {
  route: string; techName: string | null;
  scheduledCount: number; completedCount: number; completionPct: number;
  expectedPct: number; status: string; leftBehindCount: number; leftBehindDollars: number;
  remainingCount: number; projectedPct: number; callbacks: number;
  netRouteChange: number; netRouteChangeDollars: number;
};
export type LeftBehindJob = { id: string; route: string; account: string; customer: string | null; service: string | null; scheduledDate: string | null; dollars: number; status: string; managerNote: string | null };
export type Totals = { scheduled: number; completed: number; completionPct: number; leftBehind: number; leftBehindDollars: number; remaining: number; callbacks: number; netChange: number; netChangeDollars: number };

const money = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;
const STATUS: Record<string, string> = { ahead: "text-brand-700 bg-brand-50 border-brand-200", on_pace: "text-brand-700 bg-brand-50 border-brand-200", behind: "text-amber-700 bg-amber-50 border-amber-200", critical: "text-red-700 bg-red-50 border-red-200" };
const STATUS_LABEL: Record<string, string> = { ahead: "Ahead", on_pace: "On pace", behind: "Behind", critical: "Critical" };

export default function ProductionCompletion({
  branch, periodKey, routes, totals, leftBehind, uploads, canUpload,
}: {
  branch: string; periodKey: string | null; routes: RouteRow[]; totals: Totals;
  leftBehind: LeftBehindJob[]; uploads: { type: string; fileName: string; rows: number }[]; canUpload: boolean;
}) {
  const [routeFilter, setRouteFilter] = useState<string | null>(null);
  const shown = routeFilter ? leftBehind.filter((j) => j.route === routeFilter) : leftBehind;

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
          {/* Totals strip */}
          <div className="grid grid-cols-2 gap-px bg-line sm:grid-cols-4 lg:grid-cols-6">
            <Stat label="Completion" value={`${totals.completionPct}%`} sub={`${totals.completed}/${totals.scheduled}`} />
            <Stat label="Left behind" value={String(totals.leftBehind)} sub={money(totals.leftBehindDollars)} tone={totals.leftBehind > 0 ? "bad" : "good"} />
            <Stat label="Remaining" value={String(totals.remaining)} />
            <Stat label="Callbacks" value={String(totals.callbacks)} tone={totals.callbacks > 0 ? "warn" : "good"} />
            <Stat label="Route net" value={`${totals.netChange >= 0 ? "+" : ""}${totals.netChange}`} sub={money(totals.netChangeDollars)} tone={totals.netChangeDollars < 0 ? "bad" : "good"} />
            <Stat label="Routes" value={String(routes.length)} />
          </div>

          {/* Per-route table */}
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-sm">
              <thead>
                <tr className="text-[11px] uppercase tracking-wide text-muted">
                  <th className="px-3 py-2 text-left">Route</th>
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
                  <tr key={r.route} className={`border-t border-line ${routeFilter === r.route ? "bg-brand-50/50" : ""}`}>
                    <td className="px-3 py-2"><span className="font-medium">{r.route}</span> <span className="text-xs text-muted">{r.techName}</span></td>
                    <td className="px-3 py-2 text-right tabular-nums">{r.completedCount}/{r.scheduledCount}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{r.completionPct}%</td>
                    <td className="px-3 py-2 text-center"><span className={`rounded-full border px-2 py-0.5 text-[10px] font-medium ${STATUS[r.status] ?? STATUS.on_pace}`}>{STATUS_LABEL[r.status] ?? r.status}</span></td>
                    <td className="px-3 py-2 text-right">
                      {r.leftBehindCount > 0 ? (
                        <button onClick={() => setRouteFilter(routeFilter === r.route ? null : r.route)} className="font-medium text-red-600 hover:underline tabular-nums">{r.leftBehindCount} · {money(r.leftBehindDollars)}</button>
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

          {/* Left-behind gameplan */}
          <div className="border-t border-line px-4 py-3">
            <div className="flex items-center justify-between">
              <div className="text-sm font-medium text-ink">Jobs left behind {routeFilter ? `· route ${routeFilter}` : ""} <span className="text-xs font-normal text-muted">({shown.length})</span></div>
              {routeFilter && <button onClick={() => setRouteFilter(null)} className="text-xs text-brand-600 hover:underline">Show all</button>}
            </div>
            <p className="mt-0.5 text-[11px] text-muted">Past-due, not completed, and not on the board ahead. Address each: confirm it&apos;s rescheduled or note the plan.</p>
            <div className="mt-2 max-h-[420px] space-y-1.5 overflow-y-auto">
              {shown.length === 0 ? <p className="py-3 text-sm text-muted">Nothing left behind here — nice.</p> : shown.map((j) => <JobRow key={j.id} job={j} branch={branch} />)}
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

function Stat({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: "good" | "warn" | "bad" }) {
  const c = tone === "bad" ? "text-red-600" : tone === "warn" ? "text-amber-600" : "text-ink";
  return (
    <div className="bg-surface px-3 py-3">
      <div className="text-[10px] uppercase tracking-wide text-muted">{label}</div>
      <div className={`mt-0.5 text-xl font-light tabular-nums ${c}`}>{value}</div>
      {sub && <div className="text-[11px] text-muted tabular-nums">{sub}</div>}
    </div>
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
