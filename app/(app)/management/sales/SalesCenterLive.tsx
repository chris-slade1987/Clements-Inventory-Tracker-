"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Card, btn } from "@/components/ui";
import { branchLabel } from "@/lib/management";

type Period = { leads: number; won: number; lost: number; closeRate: number | null; soldAnnual: number; soldTotal: number };
type Metrics = {
  mtd: Period; qtd: Period; ytd: Period;
  byBranch: { branch: string; leads: number; won: number; lost: number; closeRate: number | null; soldAnnual: number }[];
  byRep: { owner: string; won: number; soldAnnual: number }[];
  bySource: { source: string; won: number; soldAnnual: number }[];
  months: { month: string; leads: number; won: number; soldAnnual: number }[];
  recentWon: { date: string; name: string; branch: string; owner: string; annualValue: number }[];
  openPipeline: number; totalRows: number;
  /** Which source produced this snapshot ("workwave" | "sheet"; absent on legacy snapshots). */
  source?: string;
};

const money = (n: number) => n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
const pct = (n: number | null) => (n == null ? "—" : `${n.toFixed(0)}%`);
const MONTH = (ym: string) => { const [y, m] = ym.split("-").map(Number); return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString("en-US", { month: "short", timeZone: "UTC" }); };

export default function SalesCenterLive({ metrics, syncedAt, lastError, canSync, workwaveConfigured = false }: { metrics: Metrics | null; syncedAt: string | null; lastError: string | null; canSync: boolean; workwaveConfigured?: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  // The live connection is WorkWave when its key is configured; otherwise the
  // hourly Google-Sheet export. `metrics.source` records which one produced the
  // snapshot on screen (may differ from the connection right after a switchover).
  const onWorkwave = workwaveConfigured;
  const snapshotSource = metrics?.source;

  async function sync() {
    setBusy(true); setMsg(null);
    const res = await fetch("/api/sales/sync", { method: "POST" });
    const data = await res.json().catch(() => ({}));
    setBusy(false);
    setMsg(res.ok ? `Synced ${data.rows ?? 0} opportunities${data.source ? ` from ${data.source === "workwave" ? "WorkWave" : "the sheet"}` : ""}.` : (data.error ?? "Sync failed."));
    router.refresh();
  }

  const maxMonth = Math.max(1, ...(metrics?.months.map((m) => m.soldAnnual) ?? [1]));

  return (
    <Card className="p-4 mb-6">
      <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
        <div>
          <div className="flex items-center gap-2">
            <div className="text-sm font-semibold text-ink">Sales Center — live</div>
            <span
              className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium ${onWorkwave ? "bg-emerald-50 text-emerald-700 border border-emerald-200" : "bg-black/[0.04] text-muted border border-line"}`}
              title={onWorkwave ? "Pulling live from the WorkWave Sales Center API" : "Reading the shared Google-Sheet export (WorkWave API not configured)"}
            >
              <span className={`inline-block h-1.5 w-1.5 rounded-full ${onWorkwave ? "bg-emerald-500" : "bg-black/25"}`} aria-hidden />
              {onWorkwave ? "WorkWave API" : "Google Sheet"}
            </span>
          </div>
          <div className="text-[11px] text-muted">
            {syncedAt ? `Synced ${new Date(syncedAt).toLocaleString()} · ${metrics?.totalRows.toLocaleString()} opportunities` : "Not synced yet"}
            {snapshotSource && snapshotSource !== (onWorkwave ? "workwave" : "sheet") ? ` · via ${snapshotSource === "workwave" ? "WorkWave" : "sheet"}` : ""}
            {lastError ? " · last sync failed" : ""}
          </div>
        </div>
        {canSync ? <button onClick={sync} disabled={busy} className={btn.secondary}>{busy ? "Syncing…" : "Sync now"}</button> : null}
      </div>

      {lastError ? <div className="mb-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">{onWorkwave ? "WorkWave" : "Sheet"} sync error: {lastError}</div> : null}

      {!metrics ? (
        <p className="py-6 text-center text-sm text-muted">
          No sales data yet.{" "}
          {onWorkwave
            ? <>Click <span className="font-medium">Sync now</span> to pull from the WorkWave Sales Center API.</>
            : <>Click <span className="font-medium">Sync now</span> once the Google Sheet is shared &ldquo;Anyone with the link&rdquo;.</>}
        </p>
      ) : (
        <>
          {/* Period tiles */}
          <div className="grid gap-3 sm:grid-cols-3 mb-4">
            {([["This month", metrics.mtd], ["This quarter", metrics.qtd], ["Year to date", metrics.ytd]] as const).map(([label, p]) => (
              <div key={label} className="rounded-xl border border-line p-3">
                <div className="text-[11px] uppercase tracking-wider text-muted">{label}</div>
                <div className="mt-1 text-2xl font-light tabular-nums text-ink">{money(p.soldAnnual)}<span className="text-xs text-muted"> sold</span></div>
                <div className="mt-1 flex gap-3 text-xs text-muted tabular-nums">
                  <span><span className="text-ink">{p.won}</span> won</span>
                  <span><span className="text-ink">{p.leads}</span> leads</span>
                  <span>close <span className="text-ink">{pct(p.closeRate)}</span></span>
                </div>
              </div>
            ))}
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            {/* By branch (YTD) */}
            <div>
              <div className="text-xs font-medium text-ink mb-1.5">By branch · YTD</div>
              <table className="w-full text-sm">
                <thead><tr className="text-left text-[11px] text-muted border-b border-line"><th className="py-1 font-medium">Branch</th><th className="py-1 font-medium text-right">Leads</th><th className="py-1 font-medium text-right">Won</th><th className="py-1 font-medium text-right">Close</th><th className="py-1 font-medium text-right">Sold</th></tr></thead>
                <tbody>
                  {metrics.byBranch.map((b) => (
                    <tr key={b.branch} className="border-b border-line last:border-0">
                      <td className="py-1.5">{b.branch === "other" ? "Other" : branchLabel(b.branch)}</td>
                      <td className="py-1.5 text-right tabular-nums">{b.leads}</td>
                      <td className="py-1.5 text-right tabular-nums">{b.won}</td>
                      <td className="py-1.5 text-right tabular-nums">{pct(b.closeRate)}</td>
                      <td className="py-1.5 text-right tabular-nums font-medium">{money(b.soldAnnual)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Monthly trend */}
            <div>
              <div className="text-xs font-medium text-ink mb-1.5">Sold by month · trailing 12</div>
              <div className="space-y-1">
                {metrics.months.map((m) => (
                  <div key={m.month} className="flex items-center gap-2">
                    <div className="w-8 shrink-0 text-[11px] text-muted">{MONTH(m.month)}</div>
                    <div className="flex-1 h-4 rounded bg-black/[0.04] overflow-hidden"><div className="h-full bg-emerald-grad rounded" style={{ width: `${(m.soldAnnual / maxMonth) * 100}%` }} /></div>
                    <div className="w-16 shrink-0 text-right text-[11px] tabular-nums text-ink">{m.soldAnnual > 0 ? money(m.soldAnnual) : "—"}</div>
                  </div>
                ))}
              </div>
            </div>

            {/* Top reps */}
            <div>
              <div className="text-xs font-medium text-ink mb-1.5">Top reps · YTD sold</div>
              <ul className="space-y-1 text-sm">
                {metrics.byRep.slice(0, 6).map((r) => (
                  <li key={r.owner} className="flex justify-between"><span className="text-ink truncate">{r.owner}</span><span className="tabular-nums text-muted">{r.won} · {money(r.soldAnnual)}</span></li>
                ))}
              </ul>
            </div>

            {/* Lead sources */}
            <div>
              <div className="text-xs font-medium text-ink mb-1.5">Lead sources · YTD won</div>
              <ul className="space-y-1 text-sm">
                {metrics.bySource.slice(0, 6).map((s) => (
                  <li key={s.source} className="flex justify-between"><span className="text-ink truncate">{s.source}</span><span className="tabular-nums text-muted">{s.won} · {money(s.soldAnnual)}</span></li>
                ))}
              </ul>
            </div>
          </div>

          {metrics.openPipeline > 0 ? <div className="mt-3 text-xs text-muted">Open pipeline (annual value): <span className="text-ink font-medium">{money(metrics.openPipeline)}</span></div> : null}
        </>
      )}
      {msg ? <p className="mt-2 text-xs text-brand-700">{msg}</p> : null}
    </Card>
  );
}
