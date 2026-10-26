"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Card, btn } from "@/components/ui";
import AskCanopy from "@/components/AskCanopy";
import RouteLeafletMap, { type MapGroup } from "./RouteLeafletMap";

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

// Great-circle miles between two geocoded points.
function haversineMiles(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
  const R = 3958.8, toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat), dLng = toRad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
const AVG_MPH = 30, ROAD_FACTOR = 1.3; // local pest routes: straight-line × road factor, ~30 mph door-to-door
function fmtDur(min: number) { const h = Math.floor(min / 60), m = Math.round(min % 60); return h ? `${h}h ${m}m` : `${m}m`; }

// Per-DAY estimates from a day's stops (in route order). Miles/drive/fuel need geocoded
// stops; value is always exact. `located`/`total` tell the UI how complete the geo is.
function dayMetrics(day: Day | null): { miles: number; driveMin: number; fuel: number; value: number; located: number; total: number } {
  const stops = day?.stops ?? [];
  const value = stops.reduce((s, x) => s + x.amt, 0);
  const pts = stops.filter((s): s is Stop & { lat: number; lng: number } => s.lat != null && s.lng != null);
  const miles = routeMiles(pts);
  const driveMin = miles > 0 ? (miles / AVG_MPH) * 60 : 0;
  return { miles, driveMin, fuel: (miles / MPG) * GAS, value, located: pts.length, total: stops.length };
}

// Road-adjusted miles along an ordered list of geocoded points.
function routeMiles(pts: { lat: number; lng: number }[]): number {
  let m = 0;
  for (let i = 1; i < pts.length; i++) m += haversineMiles(pts[i - 1], pts[i]);
  return m * ROAD_FACTOR;
}
function metricsFor(stops: Stop[]): { miles: number; driveMin: number; fuel: number } {
  const pts = stops.filter((s): s is Stop & { lat: number; lng: number } => s.lat != null && s.lng != null);
  const miles = routeMiles(pts);
  return { miles, driveMin: (miles / AVG_MPH) * 60, fuel: (miles / MPG) * GAS };
}

// Reorder one day's stops to cut drive distance: nearest-neighbor seed + 2-opt,
// keeping locked stops pinned at their current position. Non-geocoded stops keep
// their relative order at the end. Returns stops with seq renumbered 1..n.
function optimizeOrder(stops: Stop[], isLocked: (seq: number) => boolean): Stop[] {
  const geo = stops.filter((s): s is Stop & { lat: number; lng: number } => s.lat != null && s.lng != null);
  const noGeo = stops.filter((s) => s.lat == null || s.lng == null);
  if (geo.length < 3) return stops;
  const n = geo.length;
  const result: (typeof geo[number] | null)[] = new Array(n).fill(null);
  const pinnedIdx = new Set<number>();
  geo.forEach((s, i) => { if (isLocked(s.seq)) { result[i] = s; pinnedIdx.add(i); } });
  const remaining = new Set(geo.filter((s) => !isLocked(s.seq)));
  let prev: (typeof geo[number]) | null = null;
  for (let i = 0; i < n; i++) {
    if (result[i]) { prev = result[i]; continue; }
    let best: (typeof geo[number]) | null = null, bestD = Infinity;
    for (const c of remaining) { const d = prev ? haversineMiles(prev, c) : 0; if (best === null || d < bestD) { best = c; bestD = d; } }
    if (!best) break;
    result[i] = best; remaining.delete(best); prev = best;
  }
  let ordered = result.filter(Boolean) as (typeof geo[number])[];
  // 2-opt only when nothing is pinned (keeps pinned positions exact otherwise).
  if (!pinnedIdx.size) ordered = twoOpt(ordered);
  return [...ordered, ...noGeo].map((s, i) => ({ ...s, seq: i + 1 }));
}
function twoOpt<T extends { lat: number; lng: number }>(route: T[]): T[] {
  const r = [...route];
  let improved = true, guard = 0;
  const d = (a: T, b: T) => haversineMiles(a, b);
  while (improved && guard++ < 60) {
    improved = false;
    for (let i = 0; i < r.length - 1; i++) {
      for (let k = i + 1; k < r.length; k++) {
        const a = r[i - 1], b = r[i], c = r[k], e = r[k + 1];
        const before = (a ? d(a, b) : 0) + (e ? d(c, e) : 0);
        const after = (a ? d(a, c) : 0) + (e ? d(b, e) : 0);
        if (after + 1e-9 < before) { r.splice(i, k - i + 1, ...r.slice(i, k + 1).reverse()); improved = true; }
      }
    }
  }
  return r;
}

// The Mon–Sun week (as present in the loaded month) that contains `date`.
function weekDaysOf(days: Day[], date: string): Day[] {
  if (!date) return [];
  const [y, m, d] = date.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  const monday = new Date(dt); monday.setUTCDate(dt.getUTCDate() - ((dt.getUTCDay() + 6) % 7));
  const sunday = new Date(monday); sunday.setUTCDate(monday.getUTCDate() + 6);
  const lo = monday.toISOString().slice(0, 10), hi = sunday.toISOString().slice(0, 10);
  return days.filter((x) => x.date >= lo && x.date <= hi && x.stops.length > 0).sort((a, b) => a.date.localeCompare(b.date));
}

// Distinct per-day colors for the week view (brand green first, then a readable spread).
const DAY_PALETTE = ["#1F7A45", "#2563EB", "#D97706", "#DB2777", "#7C3AED", "#0891B2", "#DC2626"];

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
  // Stats under the map/account order: default to the clicked day, toggle to monthly avg.
  const [statsView, setStatsView] = useState<"day" | "month">("day");
  // Rework scope + the optimizer's "after" stops that the map should display.
  const [scope, setScope] = useState<"day" | "week" | "month">("day");
  const [dayAfter, setDayAfter] = useState<Stop[] | null>(null);
  const [weekAfter, setWeekAfter] = useState<Record<string, Stop[]> | null>(null);
  // Clear any optimizer preview when the manager switches day or technician.
  useEffect(() => { setDayAfter(null); setWeekAfter(null); }, [selDate, sel.id]);
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

  // The week (as loaded) containing the selected day — used by the Week scope.
  const weekDays = useMemo(() => (days && curDay ? weekDaysOf(days, curDay.date) : []), [days, curDay]);

  // What the map draws: the week (color-coded per day) under Week scope, otherwise
  // the selected day (green) — showing the optimizer's proposed order when present.
  const mapGroups: MapGroup[] = useMemo(() => {
    if (scope === "week" && weekDays.length) {
      return weekDays.map((d, i) => ({ key: d.date, label: dayLabel(d.date), color: DAY_PALETTE[i % DAY_PALETTE.length], stops: weekAfter?.[d.date] ?? d.stops }));
    }
    const stops = (scope === "day" ? dayAfter : null) ?? curDay?.stops ?? [];
    return curDay ? [{ key: curDay.date, label: dayLabel(curDay.date), color: "#1F7A45", stops }] : [];
  }, [scope, weekDays, weekAfter, dayAfter, curDay]);

  // Daily stats for the clicked day (miles/drive/fuel need geocoded stops; value is exact).
  const dm = dayMetrics(curDay);
  const geoNote = dm.total > 0 && dm.located < dm.total ? `${dm.located}/${dm.total} located` : "stop 1 → last";
  const haveGeo = dm.located >= 2;
  const dailyTiles: [string, string, string, boolean][] = [
    ["Product value", money(dm.value), `${dm.total} stop${dm.total === 1 ? "" : "s"}`, false],
    ["Miles (est)", haveGeo ? dm.miles.toFixed(1) : "—", haveGeo ? geoNote : "locate stops", true],
    ["Drive time (est)", haveGeo ? fmtDur(dm.driveMin) : "—", "stop 1 → last", true],
    ["Est. fuel", haveGeo ? money(dm.fuel) : "—", `@ $${GAS}/gal`, true],
  ];

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
            context={`Routes · ${sel.name} (route ${sel.routeNo}, ${sel.kind}) · ${sel.totalStops} stops over ${sel.totalDays} days · avg ${sel.avgStopsPerDay}/day · daily loads [${sel.loads.join(", ")}] · status ${sel.status}`}
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
              <div className="mb-1 text-sm font-medium text-ink">
                {scope === "week"
                  ? <>Week of {curDay ? dayLabel(weekDays[0]?.date ?? curDay.date) : ""} <span className="text-xs font-normal text-muted">· {weekDays.length} days · color-coded</span></>
                  : <>{curDay ? dayLabel(curDay.date) : ""} <span className="text-xs font-normal text-muted">· {curDay?.stops.length} stops · {money(curDay?.stops.reduce((s, x) => s + x.amt, 0) ?? 0)}{dayAfter ? " · optimized order" : ""}</span></>}
              </div>
              <RouteLeafletMap groups={mapGroups} branch={branch} canLocate={!signed} onLocate={onLocate} locating={locating} />
            </div>
            <div>
              <StopList sel={sel} day={curDay} locks={locks} setLocks={setLocks} signed={signed} setProposal={setProposal} />
            </div>
          </div>
          <Rework
            sel={sel} days={days!} curDay={curDay} weekDays={weekDays} locks={locks} setLocks={setLocks} periodKey={periodKey}
            scope={scope} setScope={setScope} setDayAfter={setDayAfter} setWeekAfter={setWeekAfter}
            proposal={proposal} setProposal={setProposal} changeset={changeset} setChangeset={setChangeset} signed={signed}
          />
        </>
      )}

      {/* Stats (bottom): daily for the clicked day by default, toggle to monthly avg. */}
      <div className="mt-6 border-t border-line pt-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="text-[11px] uppercase tracking-wide text-brand-600 font-medium">
            {statsView === "day" ? `Day stats — ${curDay ? dayLabel(curDay.date) : "—"}` : `Monthly summary — ${sel.name}`}
          </div>
          <div className="flex gap-0.5 rounded-lg bg-black/[0.06] p-0.5 text-xs">
            <button onClick={() => setStatsView("day")} className={`rounded-md px-2.5 py-1 ${statsView === "day" ? "bg-surface font-medium text-ink shadow-sm" : "text-muted hover:text-ink"}`}>This day</button>
            <button onClick={() => setStatsView("month")} className={`rounded-md px-2.5 py-1 ${statsView === "month" ? "bg-surface font-medium text-ink shadow-sm" : "text-muted hover:text-ink"}`}>Monthly avg</button>
          </div>
        </div>
        <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
          {(statsView === "day" ? dailyTiles : summary).map((a) => (
            <div key={a[0]} className="rounded-lg border border-line bg-black/[0.015] px-3 py-2">
              <div className="text-[10px] uppercase tracking-wide text-muted">{a[0]}</div>
              <div className="mt-0.5 text-lg font-light tabular-nums" style={{ color: a[3] ? SC.good : a[0] === "Biggest day" && m.max >= 30 ? SC.alarm : undefined }}>{a[1]}</div>
              <div className="text-[10px] text-muted">{a[2]}</div>
            </div>
          ))}
        </div>
        {statsView === "day" && !haveGeo && dm.total > 0 ? (
          <p className="mt-2 text-[11px] text-muted">Miles, drive time and fuel need geocoded stops — use <span className="text-ink">Locate stops</span> on the map to fill them in.</p>
        ) : null}
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

// Export a day's optimized stop ORDER as a PestPac-ready sequence change set (.csv).
function downloadDayOrder(sel: Tech, date: string, after: Stop[], setNote: (s: string | null) => void) {
  const esc = (v: string | number) => { const s = String(v ?? ""); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const header = ["Account", "Customer", "Service", "New Stop #", "Address", "City", "Amount"];
  const rows = after.map((s) => [s.account, s.customer, s.svc, s.seq, s.addr, s.city, s.amt.toFixed(2)].map(esc).join(","));
  const csv = "﻿" + [header.join(","), ...rows].join("\r\n") + "\r\n";
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = `canopy-day-order_route-${sel.routeNo}_${date}.csv`;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
  setNote(`Downloaded the new stop order for ${date}. Apply the sequence in PestPac — nothing in Canopy changed.`);
}

function DeltaTile({ label, before, after, lowerBetter = true }: { label: string; before: string; after: string; lowerBetter?: boolean }) {
  return (
    <div className="rounded-lg border border-line px-3 py-2">
      <div className="text-[10px] uppercase tracking-wide text-muted">{label}</div>
      <div className="mt-0.5 flex items-baseline gap-1.5 text-sm tabular-nums">
        <span className="text-muted">{before}</span><span className="text-muted">→</span><span className="font-medium text-ink">{after}</span>
      </div>
    </div>
  );
}
const pctSaved = (b: number, a: number) => (b > 0 ? Math.round(((b - a) / b) * 100) : 0);

type Metrics = { miles: number; driveMin: number; fuel: number };
type DayRes = { before: Metrics; after: Metrics; stops: Stop[] };
type WeekRow = { date: string; beforeStops: number; afterStops: number; before: Metrics; after: Metrics };
type WeekRes = { rows: WeekRow[]; moves: Move[]; milesBefore: number; milesAfter: number; driveBefore: number; driveAfter: number; balBefore: number; balAfter: number };

type ReworkProps = {
  sel: Tech; days: Day[]; curDay: Day | null; weekDays: Day[]; locks: Set<string>; setLocks: (s: Set<string>) => void; periodKey: string;
  scope: "day" | "week" | "month"; setScope: (s: "day" | "week" | "month") => void;
  setDayAfter: (s: Stop[] | null) => void; setWeekAfter: (m: Record<string, Stop[]> | null) => void;
  proposal: Proposal | null; setProposal: (p: Proposal | null) => void; changeset: string | null; setChangeset: (s: string | null) => void; signed: boolean;
};

// Scoped "Rework" — pick WHAT to rework (one day's stop order · a whole week ·
// the month), let Canopy optimize it, and see the before→after efficiency gain.
function Rework(props: ReworkProps) {
  const { sel, days, curDay, weekDays, locks, setLocks, periodKey, scope, setScope, setDayAfter, setWeekAfter, proposal, setProposal, changeset, setChangeset } = props;
  const [dayRes, setDayRes] = useState<DayRes | null>(null);
  const [weekRes, setWeekRes] = useState<WeekRes | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const fmtD = (ds: string) => { const [y, m, d] = ds.split("-").map(Number); return DOW[new Date(Date.UTC(y, m - 1, d)).getUTCDay()] + " " + m + "/" + d; };
  const isLockedOn = (date: string) => (seq: number) => locks.has(`${sel.routeNo}|${date}|${seq}`);
  const nloc = [...locks].filter((k) => k.startsWith(sel.routeNo + "|")).length;

  const pick = (s: "day" | "week" | "month") => { setScope(s); setNote(null); };
  const clearAll = () => { setDayRes(null); setWeekRes(null); setProposal(null); setChangeset(null); setNote(null); setDayAfter(null); setWeekAfter(null); };

  function runDay() {
    if (!curDay) return;
    const after = optimizeOrder(curDay.stops, isLockedOn(curDay.date));
    setDayRes({ before: metricsFor(curDay.stops), after: metricsFor(after), stops: after });
    setDayAfter(after); setWeekAfter(null); setProposal(null); setChangeset(null); setNote(null);
  }

  function runWeek() {
    const work = weekDays.filter((d) => d.stops.length > 0);
    if (work.length < 2) { setWeekRes({ rows: [], moves: [], milesBefore: 0, milesAfter: 0, driveBefore: 0, driveAfter: 0, balBefore: 0, balAfter: 0 }); return; }
    const D = work.length;
    const beforeByDate: Record<string, Stop[]> = Object.fromEntries(work.map((d) => [d.date, d.stops.map((s) => ({ ...s }))]));

    // Re-cluster the week GEOGRAPHICALLY: pool the movable, located stops and split
    // them into equal, geographically-compact groups (one per working day) so each
    // day covers a tight area — that cuts cross-town travel AND evens the day counts.
    // Locked jobs and not-yet-geocoded stops stay on their original day.
    type Tagged = Stop & { origDate: string };
    const movable: Tagged[] = [];
    const pinnedByDate: Record<string, Stop[]> = {};
    for (const d of work) {
      pinnedByDate[d.date] = [];
      for (const s of d.stops) {
        const locked = locks.has(`${sel.routeNo}|${d.date}|${s.seq}`);
        if (s.lat != null && s.lng != null && !locked) movable.push({ ...s, origDate: d.date });
        else pinnedByDate[d.date].push({ ...s });
      }
    }
    // Sort by longitude (tie-break latitude) → contiguous chunks are compact bands.
    movable.sort((a, b) => (a.lng! - b.lng!) || (a.lat! - b.lat!));
    // Even day counts: each day's movable share = target − stops it already keeps,
    // so totals land ~equal even when some stops stayed pinned (locked/not geocoded).
    const totalAll = work.reduce((s, d) => s + d.stops.length, 0);
    const target = Math.round(totalAll / D);
    const caps = work.map((d) => Math.max(0, target - pinnedByDate[d.date].length));
    let extra = movable.length - caps.reduce((a, b) => a + b, 0);
    const byLoad = work.map((_, i) => i).sort((a, b) => (pinnedByDate[work[a].date].length + caps[a]) - (pinnedByDate[work[b].date].length + caps[b]));
    for (let k = 0; extra > 0; k++, extra--) caps[byLoad[k % D]]++;
    const moves: Move[] = [];
    const afterByDate: Record<string, Stop[]> = {};
    let idx = 0;
    work.forEach((d, i) => {
      const chunk = movable.slice(idx, idx + caps[i]); idx += caps[i];
      for (const s of chunk) if (s.origDate !== d.date) moves.push({ account: s.account, customer: s.customer, addr: s.addr, city: s.city, amt: s.amt, svc: s.svc, from: s.origDate, to: d.date });
      const combined: Stop[] = [...pinnedByDate[d.date], ...chunk.map(({ origDate: _o, ...rest }) => rest as Stop)];
      afterByDate[d.date] = optimizeOrder(combined, isLockedOn(d.date));
    });

    const rows: WeekRow[] = work.map((d) => ({
      date: d.date, beforeStops: beforeByDate[d.date].length, afterStops: afterByDate[d.date].length,
      before: metricsFor(beforeByDate[d.date]), after: metricsFor(afterByDate[d.date]),
    }));
    const sum = (f: (r: WeekRow) => number) => rows.reduce((s, r) => s + f(r), 0);
    setWeekRes({
      rows, moves,
      milesBefore: sum((r) => r.before.miles), milesAfter: sum((r) => r.after.miles),
      driveBefore: sum((r) => r.before.driveMin), driveAfter: sum((r) => r.after.driveMin),
      balBefore: balanceOf(rows.map((r) => r.beforeStops)), balAfter: balanceOf(rows.map((r) => r.afterStops)),
    });
    setWeekAfter(afterByDate); setDayAfter(null); setProposal(null); setChangeset(null); setNote(null);
  }

  function runMonth() {
    const work = days.map((d) => ({ date: d.date, stops: d.stops.map((s) => ({ ...s })) })).filter((d) => d.stops.length > 0);
    if (work.length < 2) { setProposal({ moves: [], balBefore: 0, balAfter: 0, maxBefore: 0, maxAfter: 0 }); return; }
    const size = (d: { stops: Stop[] }) => d.stops.length;
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
    setProposal({ moves, balBefore: balanceOf(sizesBefore), balAfter: balanceOf(work.map(size)), maxBefore: Math.max(...sizesBefore), maxAfter: Math.max(...work.map(size)) });
    setDayAfter(null); setWeekAfter(null); setChangeset(null); setNote(null);
  }

  const SCOPES: [typeof scope, string][] = [["day", "This day's order"], ["week", "This week"], ["month", "The month"]];

  return (
    <div className="mt-5 border-t border-line pt-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="text-[11px] uppercase tracking-wide text-brand-600 font-medium">Rework &amp; optimize</div>
        <div className="flex gap-0.5 rounded-lg bg-black/[0.06] p-0.5 text-xs">
          {SCOPES.map(([k, lbl]) => (
            <button key={k} onClick={() => pick(k)} className={`rounded-md px-2.5 py-1 ${scope === k ? "bg-surface font-medium text-ink shadow-sm" : "text-muted hover:text-ink"}`}>{lbl}</button>
          ))}
        </div>
      </div>
      <p className="mt-1 text-xs text-muted">Lock the jobs that can&apos;t move (a customer&apos;s required day/time), then let Canopy optimize. Every result is a draft — your loaded routing never changes until you upload a new schedule. {nloc > 0 ? `${nloc} job${nloc === 1 ? "" : "s"} locked.` : ""}</p>

      {/* DAY — reorder one day's stops for the shortest drive */}
      {scope === "day" && (
        <div className="mt-3">
          <div className="flex flex-wrap items-center gap-2">
            <button onClick={runDay} disabled={!curDay || dayMetrics(curDay).located < 3} className={btn.secondary}>Optimize {curDay ? dayLabel(curDay.date) : "the day"}&apos;s stop order</button>
            <AskCanopy variant="button" label="Ask Canopy to move a specific job"
              task={`On route ${sel.routeNo} (${sel.name}), help me rework ${curDay ? dayLabel(curDay.date) : "this day"}. I may want to move one job to another day, or set a specific stop order. Walk me through it and build a PestPac change set.`}
              context={`Route ${sel.routeNo} ${sel.name} · ${curDay ? dayLabel(curDay.date) : ""} · ${curDay?.stops.length ?? 0} stops · ${nloc} locked`} />
          </div>
          {curDay && dayMetrics(curDay).located < 3 && <p className="mt-2 text-xs text-muted">Need at least 3 located stops to reorder — use <span className="text-ink">Locate stops</span> on the map.</p>}
          {dayRes && (
            <div className="mt-3">
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                <DeltaTile label="Miles" before={dayRes.before.miles.toFixed(1)} after={dayRes.after.miles.toFixed(1)} />
                <DeltaTile label="Drive time" before={fmtDur(dayRes.before.driveMin)} after={fmtDur(dayRes.after.driveMin)} />
                <DeltaTile label="Est. fuel" before={money(dayRes.before.fuel)} after={money(dayRes.after.fuel)} />
              </div>
              <p className="mt-2 text-sm" style={{ color: dayRes.after.miles < dayRes.before.miles ? SC.good : undefined }}>
                {dayRes.after.miles < dayRes.before.miles
                  ? `Reordering cuts ~${(dayRes.before.miles - dayRes.after.miles).toFixed(1)} mi (${pctSaved(dayRes.before.miles, dayRes.after.miles)}%) and ~${fmtDur(dayRes.before.driveMin - dayRes.after.driveMin)} of drive time. The map shows the new order — press Play to watch it.`
                  : `This day is already close to optimal — no meaningful savings from reordering.`}
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                {dayRes.after.miles < dayRes.before.miles && curDay && <button className={btn.primary} onClick={() => downloadDayOrder(sel, curDay.date, dayRes.stops, setNote)}>Download new stop order (.csv)</button>}
                <button className="rounded-lg border border-line px-3 py-1.5 text-xs text-muted hover:bg-black/5" onClick={clearAll}>Revert to original</button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* WEEK — balance across days + reorder each; color-coded on the map */}
      {scope === "week" && (
        <div className="mt-3">
          <div className="flex flex-wrap items-center gap-2">
            <button onClick={runWeek} disabled={weekDays.length < 2} className={btn.secondary}>Balance &amp; reorder this week</button>
            <AskCanopy variant="button" label="Ask Canopy to rework the week"
              task={`Rework route ${sel.routeNo} (${sel.name})'s week (${weekDays.map((d) => dayLabel(d.date)).join(", ")}). Even out the days, tighten each day's drive, and tell me how much more efficient it is. Keep any job I lock on its day.`}
              context={`Route ${sel.routeNo} ${sel.name} · week days [${weekDays.map((d) => `${dayLabel(d.date)}:${d.stops.length}`).join(", ")}] · ${nloc} locked`} />
          </div>
          {weekDays.length < 2 && <p className="mt-2 text-xs text-muted">Pick a day that falls in a week with at least two working days.</p>}
          {weekRes && weekRes.rows.length > 0 && (
            <div className="mt-3">
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                <DeltaTile label="Total miles" before={weekRes.milesBefore.toFixed(0)} after={weekRes.milesAfter.toFixed(0)} />
                <DeltaTile label="Total drive" before={fmtDur(weekRes.driveBefore)} after={fmtDur(weekRes.driveAfter)} />
                <DeltaTile label="Day balance" before={String(weekRes.balBefore)} after={String(weekRes.balAfter)} />
                <DeltaTile label="Moves" before="—" after={String(weekRes.moves.length)} />
              </div>
              <p className="mt-2 text-sm" style={{ color: weekRes.milesAfter < weekRes.milesBefore ? SC.good : undefined }}>
                {weekRes.milesAfter < weekRes.milesBefore
                  ? `Across the week that's ~${(weekRes.milesBefore - weekRes.milesAfter).toFixed(0)} fewer miles (${pctSaved(weekRes.milesBefore, weekRes.milesAfter)}%) and ~${fmtDur(weekRes.driveBefore - weekRes.driveAfter)} less drive time. Each day is color-coded on the map.`
                  : `The week is already efficient — little to gain from reworking it.`}
              </p>
              <div className="mt-3 overflow-x-auto rounded-lg border border-line">
                <table className="w-full min-w-[460px] text-xs">
                  <thead><tr className="text-[10px] uppercase tracking-wide text-muted">{["Day", "Stops", "Miles", "Drive"].map((h, i) => <th key={h} className={`border-b border-line px-2 py-1.5 ${i ? "text-right" : "text-left"}`}>{h}</th>)}</tr></thead>
                  <tbody>
                    {weekRes.rows.map((r) => (
                      <tr key={r.date} className="border-b border-line last:border-0">
                        <td className="px-2 py-1.5">{fmtD(r.date)}</td>
                        <td className="px-2 py-1.5 text-right tabular-nums">{r.beforeStops === r.afterStops ? r.afterStops : `${r.beforeStops} → ${r.afterStops}`}</td>
                        <td className="px-2 py-1.5 text-right tabular-nums">{r.before.miles.toFixed(0)} → {r.after.miles.toFixed(0)}</td>
                        <td className="px-2 py-1.5 text-right tabular-nums">{fmtDur(r.before.driveMin)} → {fmtDur(r.after.driveMin)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                {weekRes.moves.length > 0 && <button className={btn.primary} onClick={() => downloadChangeSet(sel, periodKey, { moves: weekRes.moves, balBefore: weekRes.balBefore, balAfter: weekRes.balAfter, maxBefore: 0, maxAfter: 0 }, setNote)}>Download PestPac change set (.csv)</button>}
                <button className="rounded-lg border border-line px-3 py-1.5 text-xs text-muted hover:bg-black/5" onClick={clearAll}>Revert to original</button>
              </div>
            </div>
          )}
          {weekRes && weekRes.rows.length === 0 && <p className="mt-2 text-sm text-muted">Not enough working days this week to rework.</p>}
        </div>
      )}

      {/* MONTH — even out the whole month (existing rebalance) */}
      {scope === "month" && (
        <div className="mt-3">
          <div className="flex flex-wrap items-center gap-2">
            <button onClick={runMonth} className={btn.secondary}>Rebalance {sel.name}&apos;s month</button>
            <AskCanopy variant="button" label="Ask Canopy to rework it a specific way"
              task={`Rework route ${sel.routeNo} (${sel.name})'s routing to my needs. Tell me what you'd change and why, then help me build a change set for PestPac. For example I might need a customer kept on a specific day, two techs' territories swapped, or a lighter Friday.`}
              context={`Route ${sel.routeNo} ${sel.name} · daily loads [${sel.loads.join(", ")}] · ${nloc} job(s) locked`} />
          </div>
          {proposal && proposal.moves.length === 0 && <p className="mt-2 text-sm text-muted">{sel.name}&apos;s month is already well balanced — no moves proposed.</p>}
          {proposal && proposal.moves.length > 0 && (
            <div className="mt-3">
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                <DeltaTile label="Heaviest day" before={String(proposal.maxBefore)} after={String(proposal.maxAfter)} />
                <DeltaTile label="Balance" before={String(proposal.balBefore)} after={String(proposal.balAfter)} lowerBetter={false} />
                <div className="rounded-lg border border-line px-3 py-2"><div className="text-[10px] uppercase tracking-wide text-muted">Proposed moves</div><div className="mt-0.5 text-base font-light tabular-nums">{proposal.moves.length}</div></div>
              </div>
              <div className="mt-3 max-h-60 overflow-y-auto rounded-lg border border-line p-2">
                {proposal.moves.slice(0, 14).map((mv: Move, i: number) => (
                  <div key={i} className="flex flex-wrap items-center gap-2 py-0.5 text-xs"><span className="rounded-full border border-line px-2 py-0.5 text-muted">{fmtD(mv.from)} → {fmtD(mv.to)}</span><span className="flex-1 min-w-0">{mv.addr}, {mv.city}</span><span className="text-muted tabular-nums">{money(mv.amt)} · {mv.svc}</span></div>
                ))}
                {proposal.moves.length > 14 && <div className="mt-1 text-xs text-muted">+ {proposal.moves.length - 14} more moves</div>}
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                <button className={btn.primary} onClick={() => downloadChangeSet(sel, periodKey, proposal, setNote)}>Download PestPac change set (.csv)</button>
                <button className="rounded-lg border border-line px-3 py-1.5 text-xs text-muted hover:bg-black/5" onClick={() => { clearAll(); setLocks(new Set()); }}>Revert to original</button>
              </div>
            </div>
          )}
        </div>
      )}

      {note && <p className="mt-2 text-xs text-brand-700">{note}</p>}
      {changeset && <p className="mt-2 text-xs text-brand-700">{changeset}</p>}
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
