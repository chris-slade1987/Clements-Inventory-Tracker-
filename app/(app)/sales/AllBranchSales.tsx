"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Card, btn } from "@/components/ui";
import { money, qty } from "@/lib/format";

// "All branch sales" — the TRUE branch/company book = Sales Team (service advisors)
// + Other (technicians, branch managers, leadership). Service advisors are the only
// ones tracked for goals/pacing/leaderboard; everyone else's closed $ is attributed
// to a branch here and shown as a clearly-differentiated second segment. The Sales
// Director / admins can log, edit and (reversibly) void an "other" sale.
//
// Brand: forest-green chrome, line-only, NO emoji (the sanctioned emoji exception
// is the motivation leaderboard/badges, not this analytics panel).

const TEAM_COLOR = "#2E6F47";  // Sales Team (advisors)
const OTHER_COLOR = "#86C540"; // Other sellers

type BranchRow = { branch: string; label: string; team: number; other: number; total: number };
type Entry = {
  id: string; branch: string; branchLabel: string;
  sellerName: string | null; sellerRole: string | null; sellerEmployeeId: string | null;
  closedAmount: number; dealsClosed: number; note: string | null;
};
type Seller = { id: string; name: string; branch: string | null; role: string | null };
type BranchOpt = { key: string; label: string };

const ROLES = ["Technician", "Branch Manager", "Leadership", "Other"] as const;

export default function AllBranchSales({
  periodKey, periodLabel, canManage, teamClosed, otherClosed, grandClosed,
  byBranch, entries, sellers, branches, scopedBranch,
}: {
  periodKey: string; periodLabel: string; canManage: boolean;
  teamClosed: number; otherClosed: number; grandClosed: number;
  byBranch: BranchRow[]; entries: Entry[]; sellers: Seller[]; branches: BranchOpt[];
  scopedBranch: string | null;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Entry | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const teamPct = grandClosed > 0 ? (teamClosed / grandClosed) * 100 : 100;
  const otherPct = grandClosed > 0 ? (otherClosed / grandClosed) * 100 : 0;

  async function voidEntry(e: Entry) {
    if (busyId) return;
    setBusyId(e.id);
    try {
      await fetch("/api/sales/other", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "void", id: e.id }) });
      router.refresh();
    } finally { setBusyId(null); }
  }

  return (
    <div className="mb-6">
      <div className="mb-2 flex items-center justify-between gap-2">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-muted">All branch sales · {periodLabel}</h2>
        {canManage ? (
          <button onClick={() => { setEditing(null); setOpen(true); }} className="inline-flex items-center gap-1.5 rounded-lg border border-brand-300 px-3 py-1.5 text-xs font-medium text-brand-700 hover:bg-brand-50">
            <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M12 5v14M5 12h14" /></svg>
            Log other sale
          </button>
        ) : null}
      </div>

      <Card className="p-4">
        {/* Grand total + Sales Team vs Other split */}
        <div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <div className="text-xs uppercase tracking-wider text-muted">Total closed this month{scopedBranch ? "" : " · all branches"}</div>
            <div className="text-3xl font-light tabular-nums text-ink">{money(grandClosed)}</div>
          </div>
          <div className="flex gap-4 text-sm">
            <Legend color={TEAM_COLOR} label="Sales Team" value={money(teamClosed)} sub={`${Math.round(teamPct)}%`} />
            <Legend color={OTHER_COLOR} label="Other" value={money(otherClosed)} sub={`${Math.round(otherPct)}%`} />
          </div>
        </div>
        {/* Stacked bar */}
        <div className="mt-3 flex h-4 w-full overflow-hidden rounded-full bg-black/[0.06]" role="img" aria-label={`Sales Team ${money(teamClosed)}, Other ${money(otherClosed)}`}>
          <div className="h-full transition-[width] duration-700 ease-out motion-reduce:transition-none" style={{ width: `${grandClosed > 0 ? teamPct : 0}%`, background: TEAM_COLOR }} />
          <div className="h-full transition-[width] duration-700 ease-out motion-reduce:transition-none" style={{ width: `${otherPct}%`, background: OTHER_COLOR }} />
        </div>
        <p className="mt-2 text-[11px] text-muted">
          <b className="font-medium text-ink">Sales Team</b> = service advisors (tracked for goals &amp; pacing). <b className="font-medium text-ink">Other</b> = technicians, branch managers &amp; leadership whose sales roll up to the branch.
        </p>

        {/* Per-branch split */}
        {byBranch.length > 1 ? (
          <div className="mt-4 space-y-2">
            {byBranch.map((b) => {
              const tPct = b.total > 0 ? (b.team / b.total) * 100 : 0;
              const oPct = b.total > 0 ? (b.other / b.total) * 100 : 0;
              return (
                <div key={b.branch}>
                  <div className="mb-1 flex items-center justify-between text-xs">
                    <span className="font-medium text-ink">{b.label}</span>
                    <span className="tabular-nums text-muted">
                      <span className="text-ink">{money(b.total)}</span>
                      {b.other > 0 ? <> · <span style={{ color: TEAM_COLOR }}>{money(b.team)}</span> + <span style={{ color: "#5f8a1e" }}>{money(b.other)}</span></> : null}
                    </span>
                  </div>
                  <div className="flex h-2.5 w-full overflow-hidden rounded-full bg-black/[0.06]">
                    <div className="h-full" style={{ width: `${tPct}%`, background: TEAM_COLOR }} />
                    <div className="h-full" style={{ width: `${oPct}%`, background: OTHER_COLOR }} />
                  </div>
                </div>
              );
            })}
          </div>
        ) : null}

        {/* Other sales detail — attribution to the specific seller where known */}
        <div className="mt-4 overflow-hidden rounded-xl border border-line">
          <div className="flex items-center justify-between border-b border-line px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-muted">
            <span>Other sales · techs, managers &amp; leadership</span>
            <span className="tabular-nums">{money(otherClosed)}</span>
          </div>
          {entries.length === 0 ? (
            <p className="px-3 py-5 text-center text-xs text-muted">
              No other-seller sales logged for {periodLabel} yet.{canManage ? " Use “Log other sale” to attribute a tech, manager or leadership sale to a branch." : ""}
            </p>
          ) : (
            <ul className="divide-y divide-line">
              {entries.map((e) => (
                <li key={e.id} className="flex items-center gap-3 px-3 py-2 text-sm">
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-medium text-ink">{e.sellerName || "Unattributed"}{e.sellerRole ? <span className="ml-1.5 rounded-full bg-black/[0.05] px-1.5 py-0.5 text-[10px] font-medium text-muted">{e.sellerRole}</span> : null}</div>
                    <div className="text-[11px] text-muted">{e.branchLabel}{e.dealsClosed > 0 ? ` · ${qty(e.dealsClosed)} deal${e.dealsClosed === 1 ? "" : "s"}` : ""}{e.note ? ` · ${e.note}` : ""}</div>
                  </div>
                  <span className="shrink-0 tabular-nums font-medium text-ink">{money(e.closedAmount)}</span>
                  {canManage ? (
                    <span className="shrink-0 flex items-center gap-2">
                      <button onClick={() => { setEditing(e); setOpen(true); }} className="text-[11px] font-medium text-brand-700 hover:underline">Edit</button>
                      <button onClick={() => voidEntry(e)} disabled={busyId === e.id} className="text-[11px] font-medium text-muted hover:text-red-600 disabled:opacity-50">{busyId === e.id ? "…" : "Remove"}</button>
                    </span>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </div>
      </Card>

      {open ? (
        <OtherSaleModal
          periodKey={periodKey} periodLabel={periodLabel}
          entry={editing} sellers={sellers} branches={branches} scopedBranch={scopedBranch}
          onClose={() => setOpen(false)} onSaved={() => { setOpen(false); router.refresh(); }}
        />
      ) : null}
    </div>
  );
}

function Legend({ color, label, value, sub }: { color: string; label: string; value: string; sub: string }) {
  return (
    <div className="flex items-center gap-2">
      <span className="h-3 w-3 shrink-0 rounded-sm" style={{ background: color }} />
      <div className="leading-tight">
        <div className="text-[11px] uppercase tracking-wide text-muted">{label}</div>
        <div className="tabular-nums font-medium text-ink">{value} <span className="text-[11px] font-normal text-muted">{sub}</span></div>
      </div>
    </div>
  );
}

function OtherSaleModal({
  periodKey, periodLabel, entry, sellers, branches, scopedBranch, onClose, onSaved,
}: {
  periodKey: string; periodLabel: string; entry: Entry | null;
  sellers: Seller[]; branches: BranchOpt[]; scopedBranch: string | null;
  onClose: () => void; onSaved: () => void;
}) {
  const [branch, setBranch] = useState(entry?.branch ?? scopedBranch ?? (branches[0]?.key ?? ""));
  const [sellerEmployeeId, setSellerEmployeeId] = useState(entry?.sellerEmployeeId ?? "");
  const [sellerName, setSellerName] = useState(entry?.sellerName ?? "");
  const [sellerRole, setSellerRole] = useState(entry?.sellerRole ?? "");
  const [closedAmount, setClosedAmount] = useState(entry?.closedAmount ?? 0);
  const [dealsClosed, setDealsClosed] = useState(entry?.dealsClosed ?? 0);
  const [note, setNote] = useState(entry?.note ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const branchSellers = useMemo(() => sellers.filter((s) => !branch || !s.branch || s.branch === branch), [sellers, branch]);

  function pickSeller(id: string) {
    setSellerEmployeeId(id);
    const s = sellers.find((x) => x.id === id);
    if (s) {
      setSellerName(s.name);
      if (s.branch) setBranch(s.branch);
      if (s.role && !sellerRole) {
        const r = /manager/i.test(s.role) ? "Branch Manager" : /tech/i.test(s.role) ? "Technician" : /chief|coo|ceo|cfo|president|director|owner|vp/i.test(s.role) ? "Leadership" : "Other";
        setSellerRole(r);
      }
    }
  }

  async function save() {
    setBusy(true); setError(null);
    try {
      const res = await fetch("/api/sales/other", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: entry?.id, periodKey, branch, sellerEmployeeId: sellerEmployeeId || null, sellerName, sellerRole, closedAmount, dealsClosed, note }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) { setError(d.error ?? "Save failed."); return; }
      onSaved();
    } catch { setError("Network error — try again."); }
    finally { setBusy(false); }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-0 sm:items-center sm:p-4">
      <Card className="w-full space-y-3 rounded-t-2xl p-5 sm:max-w-sm sm:rounded-2xl">
        <h3 className="text-base font-semibold">{entry ? "Edit" : "Log"} other sale — {periodLabel}</h3>

        <label className="block text-sm font-medium">Branch
          <select value={branch} onChange={(e) => setBranch(e.target.value)} className="mt-1 w-full rounded-lg border border-line px-3 py-2 text-sm">
            {branches.map((b) => <option key={b.key} value={b.key}>{b.label}</option>)}
          </select>
        </label>

        <label className="block text-sm font-medium">Seller (optional link)
          <select value={sellerEmployeeId} onChange={(e) => pickSeller(e.target.value)} className="mt-1 w-full rounded-lg border border-line px-3 py-2 text-sm">
            <option value="">— Not linked / enter name below —</option>
            {branchSellers.map((s) => <option key={s.id} value={s.id}>{s.name}{s.role ? ` · ${s.role}` : ""}</option>)}
          </select>
        </label>

        <label className="block text-sm font-medium">Seller name
          <input value={sellerName} onChange={(e) => { setSellerName(e.target.value); setSellerEmployeeId(""); }} placeholder="e.g. Chris Slade" className="mt-1 w-full rounded-lg border border-line px-3 py-2 text-sm" />
        </label>

        <label className="block text-sm font-medium">Seller type
          <select value={sellerRole} onChange={(e) => setSellerRole(e.target.value)} className="mt-1 w-full rounded-lg border border-line px-3 py-2 text-sm">
            <option value="">— Select —</option>
            {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
          </select>
        </label>

        <div className="grid grid-cols-2 gap-3">
          <label className="block text-sm font-medium">Closed ($)
            <input type="number" min={0} step="0.01" value={closedAmount || ""} onChange={(e) => setClosedAmount(parseFloat(e.target.value) || 0)} className="mt-1 w-full rounded-lg border border-line px-3 py-2 text-sm" />
          </label>
          <label className="block text-sm font-medium">Deals (count)
            <input type="number" min={0} step="1" value={dealsClosed || ""} onChange={(e) => setDealsClosed(parseInt(e.target.value) || 0)} className="mt-1 w-full rounded-lg border border-line px-3 py-2 text-sm" />
          </label>
        </div>

        <label className="block text-sm font-medium">Note (optional)
          <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. referral to Orlando branch" className="mt-1 w-full rounded-lg border border-line px-3 py-2 text-sm" />
        </label>

        {error ? <p className="text-sm text-red-600">{error}</p> : null}
        <div className="flex gap-2 pt-1">
          <button onClick={onClose} className={btn.secondary}>Cancel</button>
          <button onClick={save} disabled={busy} className={`${btn.primary} flex-1`}>{busy ? "Saving…" : "Save"}</button>
        </div>
      </Card>
    </div>
  );
}
