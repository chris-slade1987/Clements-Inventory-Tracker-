"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Card, btn } from "@/components/ui";
import AskCanopy from "@/components/AskCanopy";
import RouteLeafletMap from "./RouteLeafletMap";

const MPG = 18, GAS = 3.45;
const SC: Record<string, string> = { good: "#1F7A45", warn: "#E3B23C", alarm: "#DC2626", info: "#5c6b62" };
const SL: Record<string, string> = { good: "On track", warn: "Watch", alarm: "Heavy day", info: "Not graded" };
const KL: Record<string, string> = { route: "Route", commercial: "Commercial", senior: "Senior" };
const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const money = (n: number) => "$" + Math.round(n).toLocaleString();

type Finding = { id: string; severity: string; title: string; detail: string; question: string | null; requiresResponse: boolean; managerResponse: string | null; status: string };
type Tech = { id: string; routeNo: string | null; name: string; kind: string; partnerRouteNo: string | null; totalDays: number; totalStops: number; totalDollars: number; avgStopsPerDay: number | null; estMiles: number | null; estDriveMinutes: number | null; status: string; approved: boolean; perStop: number; loads: number[]; findings: Finding[] };
type Stop = { seq: number; account: string; svc: string; customer: string; addr: string; city: string; zip: string; lat: number | null; lng: number | null; amt: number };
type Day = { date: string; stops: Stop[] };
type Move = { account: string; customer: string; addr: string; city: string; amt: number; svc: string; from: string; to: string };
type Proposal = { moves: Move[]; balBefore: number; balAfter: number; maxBefore: number; maxAfter: number };
type Data = { month: { id: string; branch: string; periodKey: string; status: string; signedName: string | null; signedAt: string | null; loaded: boolean; uploadedAt: string | null; uploadedBy: string | null }; techs: Tech[]; gate: { techs: number; unapproved: number; openFindings: number; canSign: boolean }; totals: { stops: number; dollars: number; miles: number } };

const median = (a: number[]) => { if (!a.length) return 0; const b = [...a].sort((x, y) => x - y); const m = b.length >> 1; return b.length % 2 ? b[m] : (b[m - 1] + b[m]) / 2; };
const mean = (a: number[]) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : 0);
const std = (a: number[]) => { const m = mean(a); return Math.sqrt(mean(a.map((x) => (x - m) ** 2))); };
const balanceOf = (a: number[]) => { const m = mean(a); return m ? Math.max(0, Math.min(100, Math.round((1 - std(a) / m) * 100))) : 0; };

export default function RoutingBoard({ data, canUpload, periodKey }: { data: Data; canUpload: boolean; periodKey: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [selId, setSelId] = useState<string | null>(data.techs[0]?.id ?? null);
  const [daysByTech, setDaysByTech] = useState<Record<string, Day[]>>({});
  const [selDate, setSelDate] = useState<string | null>(null);
  const [locks, setLocks] = useState<Set<string>>(new Set());
  const [proposal, setProposal] = useState<Proposal | null>(null);
  const [changeset, setChangeset] = useState<string | null>(null);
  const [locating, setLocating] = useState(false);
  const [signName, setSignName] = useState("");
  const signed = data.month.status === "signed";
  const sel = data.techs.find((t) => t.id === selId) || data.techs[0] || null;
  const days = sel ? daysByTech[sel.name] : undefined;

  const post = async (payload: Record<string, unknown>, tag: string) => {
    setBusy(tag); setErr(null);
    try {
      const res = await fetch("/api/routing-approval", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ branch: data.month.branch, periodKey, ...payload }) });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) { setErr(j.error || "Something went wrong."); return false; }
      router.refresh(); return true;
    } catch (e) { setErr((e as Error).message); return false; } finally { setBusy(null); }
  };

  // Geocode this month's stops (bounded, server-side) then reload the tech's days
  // so the street map fills in. Best-effort: in environments where geocoding is
  // blocked it simply no-ops and the located count stays put.
  async function locateStops() {
    if (!sel) return;
    setLocating(true);
    try {
      await fetch("/api/routing-approval", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "geocode", branch: data.month.branch, periodKey }) });
      setDaysByTech((p) => { const n = { ...p }; delete n[sel.name]; return n; });
    } catch { /* ignore */ } finally { setLocating(false); }
  }

  // fetch a tech's day/stop detail on demand
  useEffect(() => {
    if (!sel || daysByTech[sel.name]) return;
    let live = true;
    fetch("/api/routing-approval", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "techDays", branch: data.month.branch, periodKey, techName: sel.name }) })
      .then((r) => r.json()).then((j) => { if (live && j.days) setDaysByTech((p) => ({ ...p, [sel.name]: j.days })); }).catch(() => {});
    return () => { live = false; };
  }, [sel, daysByTech, data.month.branch, periodKey]);

  if (!data.month.loaded) {
    return <UploadEmpty canUpload={canUpload} periodKey={periodKey} branch={data.month.branch} />;
  }

  const flagged = data.techs.filter((t) => ["warn", "alarm"].includes(t.status)).length;
  const fuel = data.totals.miles / MPG * GAS;
  const kpis: [string, string, string, boolean][] = [
    ["Routes", String(data.techs.length), "this branch", false],
    ["Stops", data.totals.stops.toLocaleString(), "scheduled", false],
    ["Scheduled $", money(data.totals.dollars), "this month", false],
    ["Flagged", String(flagged), "need a look", false],
    ["Est. miles", Math.round(data.totals.miles).toLocaleString(), "modeled", true],
    ["Est. fuel", money(fuel), `@ $${GAS}/gal`, true],
  ];

  return (
    <div className="space-y-5">
      {signed && (
        <Card className="p-4" style={{ borderColor: `${SC.good}55` }}>
          <p className="text-sm text-ink"><strong>Signed</strong> by {data.month.signedName}{data.month.signedAt ? ` on ${new Date(data.month.signedAt).toLocaleString("en-US", { timeZone: "America/New_York" })}` : ""}. This month’s routing is approved.</p>
        </Card>
      )}
      {err && <p className="text-sm text-red-700">{err}</p>}
      {canUpload && <div className="flex justify-end"><UploadButton branch={data.month.branch} compact /></div>}

      {/* KPI strip */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
        {kpis.map((k) => (
          <Card key={k[0]} className="p-4">
            <div className="text-[10px] uppercase tracking-wide text-muted">{k[0]}</div>
            <div className="mt-1 text-xl font-light tabular-nums" style={{ color: k[3] ? SC.good : undefined }}>{k[1]}</div>
            <div className="text-[11px] text-muted">{k[2]}</div>
          </Card>
        ))}
      </div>

      {/* roster */}
      <Card className="p-5">
        <h3 className="text-lg font-light text-ink">Technicians — {data.month.branch}</h3>
        <p className="mt-0.5 text-xs text-muted">Tap a route to open it. Bars show the daily stop load across the month.</p>
        <div className="mt-3 overflow-x-auto rounded-xl border border-line">
          <table className="w-full min-w-[640px] text-sm">
            <thead><tr className="text-[11px] uppercase tracking-wide text-muted">
              {["Route", "Technician", "Type", "Month load", "Days", "Stops", "Avg/day", "Balance", "$/stop", "Status", "Appr."].map((h, i) => (
                <th key={h} className={`border-b border-line px-3 py-2 ${i >= 4 && i <= 8 ? "text-right" : "text-left"}`}>{h}</th>
              ))}
            </tr></thead>
            <tbody>
              {data.techs.map((t) => {
                const bal = t.kind === "route" ? balanceOf(t.loads) : null;
                return (
                  <tr key={t.id} onClick={() => { setSelId(t.id); setSelDate(null); setProposal(null); setChangeset(null); }} className={`cursor-pointer border-b border-line last:border-0 hover:bg-brand-50 ${t.id === selId ? "bg-brand-50" : ""}`}>
                    <td className="px-3 py-2 text-xs text-muted tabular-nums">{t.routeNo}</td>
                    <td className="px-3 py-2">{t.name}</td>
                    <td className="px-3 py-2"><KindChip kind={t.kind} /></td>
                    <td className="px-3 py-2"><Spark loads={t.loads} /></td>
                    <td className="px-3 py-2 text-right tabular-nums">{t.totalDays}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{t.totalStops}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{t.avgStopsPerDay}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{bal ?? "—"}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{money(t.perStop)}</td>
                    <td className="px-3 py-2"><StatusChip s={t.status} /></td>
                    <td className="px-3 py-2" onClick={(e) => e.stopPropagation()}>
                      <input type="checkbox" className="h-4 w-4 accent-[#1F7A45]" checked={t.approved} disabled={signed || busy !== null} onChange={(e) => post({ action: "approveTech", techMonthId: t.id, approved: e.target.checked }, "ap" + t.id)} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>

      {/* focus */}
      {sel && <FocusCard sel={sel} days={days} selDate={selDate} setSelDate={setSelDate} periodKey={periodKey} locks={locks} setLocks={setLocks} proposal={proposal} setProposal={setProposal} changeset={changeset} setChangeset={setChangeset} signed={signed} busy={busy} post={post} onLocate={locateStops} locating={locating} branch={data.month.branch} />}

      {/* sign-off */}
      {!signed && (
        <Card className="p-5 copilot-safe-actions">
          <h3 className="text-lg font-light text-ink">Sign the month</h3>
          {data.gate.canSign
            ? <p className="mt-1 text-sm" style={{ color: SC.good }}>Every route approved and every flag answered — ready to sign.</p>
            : <p className="mt-1 text-sm text-muted">Before you can sign: {[data.gate.unapproved ? `${data.gate.unapproved} route${data.gate.unapproved === 1 ? "" : "s"} to approve` : "", data.gate.openFindings ? `${data.gate.openFindings} flag${data.gate.openFindings === 1 ? "" : "s"} to answer` : ""].filter(Boolean).join(" · ")}.</p>}
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <input value={signName} onChange={(e) => setSignName(e.target.value)} placeholder="Type your full name" disabled={!data.gate.canSign} className="w-56 rounded-lg border border-line px-2.5 py-2 text-sm disabled:opacity-50" />
            <button onClick={() => post({ action: "sign", signedName: signName }, "sign")} disabled={!data.gate.canSign || busy !== null || !signName.trim()} className={btn.primary}>{busy === "sign" ? "Signing…" : "Attest & sign routing"}</button>
          </div>
        </Card>
      )}
    </div>
  );
}

function KindChip({ kind }: { kind: string }) {
  const c = kind === "commercial" ? "#8a5a12" : kind === "senior" ? "#3b6ea5" : "#1f5836";
  return <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px]" style={{ color: c, backgroundColor: `${c}14`, border: `1px solid ${c}33` }}>{KL[kind] || kind}</span>;
}
function StatusChip({ s }: { s: string }) {
  return <span className="inline-flex items-center gap-1.5 text-xs" style={{ color: SC[s] }}><span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: SC[s] }} />{SL[s] || s}</span>;
}
function Spark({ loads }: { loads: number[] }) {
  if (!loads.length) return <span className="text-xs text-muted">—</span>;
  const max = Math.max(...loads, 1), W = 104, H = 22, bw = W / loads.length;
  return (
    <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} aria-hidden>
      {loads.map((v, i) => { const bh = Math.max(2, (v / max) * H); return <rect key={i} x={i * bw} y={H - bh} width={Math.max(1, bw - 1)} height={bh} rx="1" fill={v >= 28 ? SC.alarm : v >= max * 0.8 ? "#2e6f47" : "#74a96e"} />; })}
    </svg>
  );
}

type FocusProps = {
  sel: Tech; days: Day[] | undefined; selDate: string | null; setSelDate: (d: string | null) => void; periodKey: string;
  locks: Set<string>; setLocks: (s: Set<string>) => void; proposal: Proposal | null; setProposal: (p: Proposal | null) => void; changeset: string | null; setChangeset: (s: string | null) => void;
  signed: boolean; busy: string | null; post: (p: Record<string, unknown>, t: string) => Promise<boolean>;
  onLocate: () => void; locating: boolean; branch: string;
};
function FocusCard(props: FocusProps) {
  const { sel, days, selDate, setSelDate, periodKey, locks, setLocks, proposal, setProposal, changeset, setChangeset, signed, busy, post, onLocate, locating, branch } = props;
  const loading = !days;
  const sizes = sel.loads;
  const m = {
    avg: sel.avgStopsPerDay ?? 0, median: median(sizes), balance: balanceOf(sizes),
    max: sizes.length ? Math.max(...sizes) : 0, min: sizes.length ? Math.min(...sizes) : 0,
    miles: sel.estMiles ?? 0, drive: sel.estDriveMinutes ?? 0, fuel: (sel.estMiles ?? 0) / MPG * GAS,
  };
  const curDay = useMemo(() => {
    if (!days || !days.length) return null;
    if (selDate) { const d = days.find((x) => x.date === selDate); if (d) return d; }
    return days.reduce((a, b) => (b.stops.length > a.stops.length ? b : a), days[0]);
  }, [days, selDate]);

  // Monthly summary tiles (bottom of the focus). Green = modeled estimate.
  const summary: [string, string, string, boolean][] = [
    ["Est. production", money(sel.totalDollars), `${sel.totalStops} stops · ${sel.totalDays} days`, false],
    ["Avg stops/day", String(m.avg), `median ${m.median}`, false],
    ["Biggest day", String(m.max), m.max >= 30 ? "heavy" : "", false],
    ["Smallest day", String(m.min), "", false],
    ["Est. fuel", money(m.fuel), `@ $${GAS}/gal`, true],
    ["Est. miles", m.miles.toLocaleString(), "modeled", true],
    ["Est. drive", Math.round(m.drive / 60) + "h " + (m.drive % 60) + "m", "modeled", true],
    ["Balance", sel.kind === "route" ? String(m.balance) : "—", sel.kind === "route" ? "day evenness" : "not graded", false],
  ];

  return (
    <Card className="p-5">
      <div className="flex flex-wrap items-baseline gap-2">
        <span className="text-xl font-light text-ink">{sel.name}</span>
        <span className="text-xs text-muted tabular-nums">Route {sel.routeNo}</span>
        <KindChip kind={sel.kind} />
        {sel.partnerRouteNo && <span className="text-xs text-muted">paired with route {sel.partnerRouteNo}</span>}
        <span className="ml-auto">
          <AskCanopy
            variant="button"
            label="Ask Canopy about this route"
            task={`Help me review and improve route ${sel.routeNo} (${sel.name})'s monthly routing. What stands out, and how could the days be balanced or made more efficient? I can lock jobs that must stay.`}
            context={`Routing Approval · ${sel.name} (route ${sel.routeNo}, ${sel.kind}) · ${sel.totalStops} stops over ${sel.totalDays} days · avg ${sel.avgStopsPerDay}/day · daily loads [${sel.loads.join(", ")}] · status ${sel.status}`}
          />
        </span>
      </div>

      {/* Daily load — bigger clickable bar chart (tap a bar to open that day below) */}
      <div className="mt-4 text-[11px] uppercase tracking-wide text-muted">Daily load — tap a day</div>
      {loading ? <p className="mt-2 text-sm text-muted">Loading {sel.name}&apos;s routes…</p> : (
        <>
          <DayBars days={days!} curDate={curDay?.date} onPick={setSelDate} />
          <div className="mt-3 grid grid-cols-1 gap-4 lg:grid-cols-2">
            <div>
              <div className="mb-1 text-sm font-medium text-ink">{curDay ? dayLabel(curDay.date) : ""} <span className="text-xs font-normal text-muted">· {curDay?.stops.length} stops · {money(curDay?.stops.reduce((s, x) => s + x.amt, 0) ?? 0)}</span></div>
              <RouteLeafletMap stops={curDay?.stops ?? []} branch={branch} canLocate={!signed} onLocate={onLocate} locating={locating} />
            </div>
            <div>
              <StopList sel={sel} day={curDay} locks={locks} setLocks={setLocks} signed={signed} setProposal={setProposal} />
            </div>
          </div>
          <Optimize sel={sel} days={days!} locks={locks} setLocks={setLocks} periodKey={periodKey} proposal={proposal} setProposal={setProposal} changeset={changeset} setChangeset={setChangeset} />
        </>
      )}

      {/* Monthly summary (bottom) + flags with AI drill-in */}
      <div className="mt-6 border-t border-line pt-4">
        <div className="text-[11px] uppercase tracking-wide text-brand-600 font-medium">Monthly summary — {sel.name}</div>
        <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
          {summary.map((a) => (
            <div key={a[0]} className="rounded-lg border border-line bg-black/[0.015] px-3 py-2">
              <div className="text-[10px] uppercase tracking-wide text-muted">{a[0]}</div>
              <div className="mt-0.5 text-lg font-light tabular-nums" style={{ color: a[3] ? SC.good : a[0] === "Biggest day" && m.max >= 30 ? SC.alarm : undefined }}>{a[1]}</div>
              <div className="text-[10px] text-muted">{a[2]}</div>
            </div>
          ))}
        </div>
        <div className="mt-4 flex items-center justify-between gap-2">
          <div className="text-[11px] uppercase tracking-wide text-muted">Flags {sel.findings.filter((f) => f.severity !== "good" && f.severity !== "info").length ? `· ${sel.findings.filter((f) => f.severity !== "good" && f.severity !== "info").length} to address` : "· none critical"}</div>
        </div>
        <div className="mt-2 space-y-2">
          {sel.findings.map((f) => <FindingRow key={f.id} f={f} sel={sel} signed={signed} busy={busy} post={post} />)}
        </div>
      </div>
    </Card>
  );
}

// Bigger version of the roster sparkline: one clickable bar per working day.
function DayBars({ days, curDate, onPick }: { days: Day[]; curDate?: string; onPick: (d: string) => void }) {
  const max = Math.max(1, ...days.map((d) => d.stops.length));
  return (
    <div className="mt-2 flex items-end gap-1 overflow-x-auto rounded-xl border border-line bg-black/[0.015] p-3" style={{ minHeight: 132 }}>
      {days.map((d) => {
        const n = d.stops.length;
        const h = Math.max(6, Math.round((n / max) * 96));
        const on = d.date === curDate;
        const col = n >= 30 ? SC.alarm : n >= max * 0.8 ? "#2e6f47" : "#74a96e";
        return (
          <button key={d.date} onClick={() => onPick(d.date)} title={`${dayLabel(d.date)} · ${n} stops`} className="flex shrink-0 flex-col items-center gap-1" style={{ width: 30 }}>
            <span className="text-[10px] tabular-nums" style={{ color: on ? "var(--color-ink)" : "var(--color-muted)" }}>{n}</span>
            <span className="w-full rounded-t" style={{ height: h, background: col, outline: on ? "2px solid var(--color-brand-600)" : "none", outlineOffset: 1, opacity: on ? 1 : 0.85 }} />
            <span className="text-[9px] tabular-nums" style={{ color: on ? "var(--color-ink)" : "var(--color-muted)" }}>{d.date.slice(5).replace("-", "/")}</span>
          </button>
        );
      })}
    </div>
  );
}

function dayLabel(ds: string): string {
  const [y, m, d] = ds.split("-").map(Number);
  return DOW[new Date(Date.UTC(y, m - 1, d)).getUTCDay()] + " " + m + "/" + d;
}

function FindingRow({ f, sel, signed, busy, post }: { f: Finding; sel: Tech; signed: boolean; busy: string | null; post: (p: Record<string, unknown>, t: string) => Promise<boolean>; }) {
  const [resp, setResp] = useState(f.managerResponse ?? "");
  const c = SC[f.severity] ?? SC.warn;
  const answered = f.status === "answered";
  return (
    <div className="rounded-lg border border-l-4 border-line p-3" style={{ borderLeftColor: c }}>
      <div className="flex items-start justify-between gap-3">
        <p className="text-sm text-ink">{f.title}</p>
        <div className="flex shrink-0 items-center gap-2">
          {answered && <span className="text-xs font-medium" style={{ color: SC.good }}>Answered</span>}
          <AskCanopy
            label="Ask Canopy"
            task={`On route ${sel.routeNo} (${sel.name}), help me with this routing flag: "${f.title}". ${f.detail} What are my options, and can you help me rework the month to fix it?`}
            context={`Route ${sel.routeNo} ${sel.name} · ${sel.totalStops} stops / ${sel.totalDays} days · daily loads [${sel.loads.join(", ")}]`}
          />
        </div>
      </div>
      <p className="mt-0.5 text-xs text-muted">{f.detail}</p>
      {f.question && !signed && (
        <div className="mt-2 flex flex-col gap-2 sm:flex-row">
          <textarea value={resp} onChange={(e) => setResp(e.target.value)} rows={2} placeholder="Your explanation…" className="flex-1 rounded-lg border border-line px-2 py-1.5 text-sm" />
          <button onClick={() => post({ action: "respondFinding", findingId: f.id, response: resp }, "f" + f.id)} disabled={busy !== null || !resp.trim()} className={`${btn.secondary} self-start`}>{busy === "f" + f.id ? "Saving…" : answered ? "Update" : "Submit"}</button>
        </div>
      )}
      {f.question && signed && f.managerResponse && <p className="mt-2 text-sm text-ink"><span className="text-muted">Response:</span> {f.managerResponse}</p>}
    </div>
  );
}

function StopList({ sel, day, locks, setLocks, signed, setProposal }: { sel: Tech; day: Day | null; locks: Set<string>; setLocks: (s: Set<string>) => void; signed: boolean; setProposal: (p: Proposal | null) => void }) {
  if (!day) return null;
  const total = day.stops.reduce((s, x) => s + x.amt, 0);
  const key = (seq: number) => `${sel.routeNo}|${day.date}|${seq}`;
  const toggle = (seq: number) => { const n = new Set(locks); const k = key(seq); if (n.has(k)) n.delete(k); else n.add(k); setLocks(n); setProposal(null); };
  return (
    <div className="max-h-[460px] overflow-y-auto rounded-xl border border-line">
      <table className="w-full min-w-[340px] text-sm">
        <thead><tr className="text-[11px] uppercase tracking-wide text-muted"><th className="border-b border-line px-2 py-2 text-right">#</th><th className="border-b border-line px-2 py-2 text-left">Service</th><th className="border-b border-line px-2 py-2 text-left">Address</th><th className="border-b border-line px-2 py-2 text-right">$</th><th className="border-b border-line px-2 py-2">Lock</th></tr></thead>
        <tbody>
          {day.stops.map((s) => { const lk = locks.has(key(s.seq)); return (
            <tr key={s.seq} className="border-b border-line last:border-0">
              <td className="px-2 py-1.5 text-right tabular-nums">{s.seq}</td>
              <td className="px-2 py-1.5">{s.svc}</td>
              <td className="px-2 py-1.5">{s.addr}, {s.city} {s.zip}</td>
              <td className="px-2 py-1.5 text-right tabular-nums">{money(s.amt)}</td>
              <td className="px-2 py-1.5"><button disabled={signed} onClick={() => toggle(s.seq)} className={`rounded-md border px-2 py-0.5 text-[11px] ${lk ? "border-brand-500 bg-brand-50 text-brand-700" : "border-line text-muted hover:bg-black/5"}`}>{lk ? "Locked" : "Lock"}</button></td>
            </tr>
          ); })}
          <tr className="bg-brand-50 font-medium"><td className="px-2 py-1.5 text-right">—</td><td className="px-2 py-1.5">{day.stops.length} stops</td><td /><td className="px-2 py-1.5 text-right tabular-nums">{money(total)}</td><td /></tr>
        </tbody>
      </table>
    </div>
  );
}

// Build a PestPac-ready change set and hand it to the browser as a .csv download.
// This is a CLIENT-SIDE export only — it writes nothing back to Canopy. The columns
// are keyed on the PestPac Account # so the reschedule can be matched on import; the
// manager reviews it, then applies the date moves in PestPac. (If PestPac needs an
// exact import layout, we match these columns to that template.)
function downloadChangeSet(sel: Tech, periodKey: string, proposal: Proposal, setChangeset: (s: string | null) => void) {
  const esc = (v: string | number) => { const s = String(v ?? ""); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const usDate = (iso: string) => { const [y, m, d] = iso.split("-").map(Number); return `${m}/${d}/${y}`; };
  const header = ["Account", "Customer", "Service", "Current Date", "Proposed Date", "Amount"];
  const rows = proposal.moves.map((mv: Move) => [mv.account, mv.customer, mv.svc, usDate(mv.from), usDate(mv.to), mv.amt.toFixed(2)].map(esc).join(","));
  const csv = "﻿" + [header.join(","), ...rows].join("\r\n") + "\r\n";
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `canopy-changeset_route-${sel.routeNo}_${periodKey}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
  setChangeset(`Downloaded ${proposal.moves.length} proposed move${proposal.moves.length === 1 ? "" : "s"} for route ${sel.routeNo} (${sel.name}) — review in Excel, then apply the date changes in PestPac. Nothing in Canopy changed.`);
}

function Optimize({ sel, days, locks, setLocks, periodKey, proposal, setProposal, changeset, setChangeset }: { sel: Tech; days: Day[]; locks: Set<string>; setLocks: (s: Set<string>) => void; periodKey: string; proposal: Proposal | null; setProposal: (p: Proposal | null) => void; changeset: string | null; setChangeset: (s: string | null) => void }) {
  const fmtD = (ds: string) => { const [y, m, d] = ds.split("-").map(Number); return DOW[new Date(Date.UTC(y, m - 1, d)).getUTCDay()] + " " + m + "/" + d; };
  const nloc = [...locks].filter((k) => k.startsWith(sel.routeNo + "|")).length;
  const run = () => {
    const work = days.map((d) => ({ date: d.date, stops: d.stops.map((s) => ({ ...s })) })).filter((d) => d.stops.length > 0);
    if (work.length < 2) { setProposal({ moves: [], balBefore: 0, balAfter: 0, maxBefore: 0, maxAfter: 0 }); return; }
    const size = (d: { stops: unknown[] }) => d.stops.length;
    const sizesBefore = work.map(size);
    const moves: Move[] = [];
    let guard = 0;
    while (guard++ < 400) {
      const donor = work.reduce((a, b) => (size(b) > size(a) ? b : a));
      const recip = work.reduce((a, b) => (size(b) < size(a) ? b : a));
      if (size(donor) - size(recip) <= 2) break;
      const cand = donor.stops.filter((s) => !locks.has(`${sel.routeNo}|${donor.date}|${s.seq}`)).sort((a, b) => a.amt - b.amt)[0];
      if (!cand) break;
      donor.stops = donor.stops.filter((s) => s !== cand); recip.stops.push(cand);
      moves.push({ account: cand.account, customer: cand.customer, addr: cand.addr, city: cand.city, amt: cand.amt, svc: cand.svc, from: donor.date, to: recip.date });
      if (moves.length >= 60) break;
    }
    const sizesAfter = work.map(size);
    setProposal({ moves, balBefore: balanceOf(sizesBefore), balAfter: balanceOf(sizesAfter), maxBefore: Math.max(...sizesBefore), maxAfter: Math.max(...sizesAfter) });
    setChangeset(null);
  };
  return (
    <div className="mt-5 border-t border-line pt-4">
      <div className="text-[11px] uppercase tracking-wide text-brand-600 font-medium">Optimize &amp; propose</div>
      <p className="mt-0.5 text-xs text-muted">Lock the jobs that can&apos;t move (a customer&apos;s required day/time), then let Canopy rebalance the rest into a PestPac-ready change set.</p>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <button onClick={run} className={btn.secondary}>Rebalance {sel.name}&apos;s month</button>
        <AskCanopy
          variant="button"
          label="Ask Canopy to rework it a specific way"
          task={`Rework route ${sel.routeNo} (${sel.name})'s routing to my needs. Tell me what you'd change and why, then help me build a change set for PestPac. For example I might need a customer kept on a specific day, two techs' territories swapped, or a lighter Friday.`}
          context={`Route ${sel.routeNo} ${sel.name} · daily loads [${sel.loads.join(", ")}] · ${nloc} job(s) locked`}
        />
        <span className="text-xs text-muted">{nloc} job{nloc === 1 ? "" : "s"} locked.</span>
      </div>
      {proposal && proposal.moves.length === 0 && <p className="mt-2 text-sm text-muted">{sel.name}&apos;s month is already well balanced — no moves proposed.</p>}
      {proposal && proposal.moves.length > 0 && (
        <div className="mt-3">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {[["Proposed moves", String(proposal.moves.length), false], ["Heaviest day", `${proposal.maxBefore} → ${proposal.maxAfter}`, false], ["Balance", `${proposal.balBefore} → ${proposal.balAfter}`, false]].map((a) => (
              <div key={a[0] as string} className="rounded-lg border border-line px-3 py-2"><div className="text-[10px] uppercase tracking-wide text-muted">{a[0]}</div><div className="mt-0.5 text-base font-light tabular-nums">{a[1]}</div></div>
            ))}
          </div>
          <div className="mt-3 max-h-60 overflow-y-auto rounded-lg border border-line p-2">
            {proposal.moves.slice(0, 14).map((mv: Move, i: number) => (
              <div key={i} className="flex flex-wrap items-center gap-2 py-0.5 text-xs"><span className="rounded-full border border-line px-2 py-0.5 text-muted">{fmtD(mv.from)} → {fmtD(mv.to)}</span><span className="flex-1 min-w-0">{mv.addr}, {mv.city}</span><span className="text-muted tabular-nums">{money(mv.amt)} · {mv.svc}</span></div>
            ))}
            {proposal.moves.length > 14 && <div className="mt-1 text-xs text-muted">+ {proposal.moves.length - 14} more moves</div>}
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            <button className={btn.primary} onClick={() => downloadChangeSet(sel, periodKey, proposal, setChangeset)}>Download PestPac change set (.csv)</button>
            <button className="rounded-lg border border-line px-3 py-1.5 text-xs text-muted hover:bg-black/5" onClick={() => { setProposal(null); setChangeset(null); setLocks(new Set()); }}>Revert to original</button>
          </div>
          <p className="mt-2 text-[11px] text-muted">Rebalancing is a working draft — it never changes your loaded routing. Canopy only overwrites data when you upload a new schedule. Revert to original clears this draft and every lock; your loaded month is untouched.</p>
          {changeset && <p className="mt-2 text-xs text-brand-700">{changeset}</p>}
        </div>
      )}
    </div>
  );
}

type Preview = { periodKey: string; periodLabel: string; techs: number; stops: number; branches: { branch: string; techs: number; stops: number }[]; fileName: string; text: string };
const BR_LABEL: Record<string, string> = { vero: "Vero Beach", stuart: "Stuart", orlando: "Orlando", naples: "Naples" };

function UploadButton({ branch, compact }: { branch: string; compact?: boolean }) {
  const router = useRouter();
  const ref = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);

  const onFile = async (file: File) => {
    setBusy(true); setErr(null); setPreview(null);
    try {
      const text = await file.text();
      const res = await fetch("/api/routing-approval", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "preview", text }) });
      const j = await res.json().catch(() => ({}));
      if (!res.ok || !j.ok) { setErr(j.error || "Could not read that file."); return; }
      setPreview({ ...j, fileName: file.name, text });
    } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };

  const confirm = async () => {
    if (!preview) return;
    setBusy(true); setErr(null);
    try {
      const res = await fetch("/api/routing-approval", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "upload", fileName: preview.fileName, text: preview.text }) });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) { setErr(j.error || "Load failed."); return; }
      // Jump to the month that was just loaded (usually next month, not today's).
      router.push(`/routing-approval?branch=${branch}&period=${preview.periodKey}`);
      router.refresh();
      setPreview(null);
    } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };

  return (
    <div className={compact ? "flex flex-col items-end gap-2" : "flex flex-col items-center gap-2"}>
      <input ref={ref} type="file" accept=".xls,.tsv,.csv,.txt" className="hidden" onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])} />
      {!preview && <button className={btn.secondary} disabled={busy} onClick={() => ref.current?.click()}>{busy ? "Reading…" : "Upload monthly routing export"}</button>}
      {err && <span className="text-xs text-red-700">{err}</span>}
      {preview && (
        <Card className="w-full max-w-lg p-4 text-left">
          <div className="text-sm text-ink">Confirm this is the routing to load:</div>
          <div className="mt-2 text-base font-light text-ink">{preview.periodLabel} <span className="text-xs text-muted">· {preview.fileName}</span></div>
          <div className="mt-1 text-sm text-muted">{preview.techs} technicians · {preview.stops.toLocaleString()} stops across {preview.branches.length} branches</div>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {preview.branches.map((b) => <span key={b.branch} className="rounded-full border border-line px-2 py-0.5 text-[11px] text-muted">{BR_LABEL[b.branch] || b.branch}: {b.techs} techs · {b.stops} stops</span>)}
          </div>
          <p className="mt-2 text-xs text-muted">This loads as the <strong>{preview.periodLabel}</strong> routing and replaces any {preview.periodLabel} data already loaded. The managers of each branch then review and sign off.</p>
          <div className="mt-3 flex gap-2">
            <button className={btn.primary} disabled={busy} onClick={confirm}>{busy ? "Loading…" : `Load ${preview.periodLabel} routing`}</button>
            <button className="rounded-lg border border-line px-3 py-1.5 text-sm text-muted" disabled={busy} onClick={() => { setPreview(null); setErr(null); }}>Cancel</button>
          </div>
        </Card>
      )}
    </div>
  );
}
function UploadEmpty({ canUpload, periodKey, branch }: { canUpload: boolean; periodKey: string; branch: string }) {
  const [y, m] = periodKey.split("-").map(Number);
  const label = new Date(Date.UTC(y, m - 1, 1)).toLocaleString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
  return (
    <Card className="p-8 text-center">
      <h3 className="text-lg font-light text-ink">Routing not loaded for {label}</h3>
      <p className="mx-auto mt-2 max-w-md text-sm text-muted">{canUpload ? "Load the PestPac “Technician Schedule Report” for the month (sorted by Technician). You’ll see a summary to confirm before it’s applied, and it opens the month it’s for. Re-uploading replaces that month." : "An admin loads the monthly routing export, then you’ll review and sign off on each technician here."}</p>
      {canUpload && <div className="mt-4 flex justify-center"><UploadButton branch={branch} /></div>}
    </Card>
  );
}
