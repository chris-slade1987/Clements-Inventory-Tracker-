"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Card, btn } from "@/components/ui";

const MPG = 18, GAS = 3.45;
const SC: Record<string, string> = { good: "#1F7A45", warn: "#E3B23C", alarm: "#DC2626", info: "#5c6b62" };
const SL: Record<string, string> = { good: "On track", warn: "Watch", alarm: "Heavy day", info: "Not graded" };
const KL: Record<string, string> = { route: "Route", commercial: "Commercial", senior: "Senior" };
const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const money = (n: number) => "$" + Math.round(n).toLocaleString();

type Finding = { id: string; severity: string; title: string; detail: string; question: string | null; requiresResponse: boolean; managerResponse: string | null; status: string };
type Tech = { id: string; routeNo: string | null; name: string; kind: string; partnerRouteNo: string | null; totalDays: number; totalStops: number; totalDollars: number; avgStopsPerDay: number | null; estMiles: number | null; estDriveMinutes: number | null; status: string; approved: boolean; perStop: number; loads: number[]; findings: Finding[] };
type Stop = { seq: number; svc: string; customer: string; addr: string; city: string; zip: string; lat: number | null; lng: number | null; amt: number };
type Day = { date: string; stops: Stop[] };
type Move = { addr: string; city: string; amt: number; svc: string; from: string; to: string };
type Proposal = { moves: Move[]; balBefore: number; balAfter: number; maxBefore: number; maxAfter: number };
type Data = { month: { id: string; branch: string; periodKey: string; status: string; signedName: string | null; signedAt: string | null; loaded: boolean; uploadedAt: string | null; uploadedBy: string | null }; techs: Tech[]; gate: { techs: number; unapproved: number; openFindings: number; canSign: boolean }; totals: { stops: number; dollars: number; miles: number } };

const median = (a: number[]) => { if (!a.length) return 0; const b = [...a].sort((x, y) => x - y); const m = b.length >> 1; return b.length % 2 ? b[m] : (b[m - 1] + b[m]) / 2; };
const mean = (a: number[]) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : 0);
const std = (a: number[]) => { const m = mean(a); return Math.sqrt(mean(a.map((x) => (x - m) ** 2))); };
const balanceOf = (a: number[]) => { const m = mean(a); return m ? Math.max(0, Math.min(100, Math.round((1 - std(a) / m) * 100))) : 0; };
function hash(s: string) { let x = 0; for (let i = 0; i < s.length; i++) x = (x * 31 + s.charCodeAt(i)) >>> 0; return x; }
function rnd(seed: number) { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }

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

  // fetch a tech's day/stop detail on demand
  useEffect(() => {
    if (!sel || daysByTech[sel.name]) return;
    let live = true;
    fetch("/api/routing-approval", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "techDays", branch: data.month.branch, periodKey, techName: sel.name }) })
      .then((r) => r.json()).then((j) => { if (live && j.days) setDaysByTech((p) => ({ ...p, [sel.name]: j.days })); }).catch(() => {});
    return () => { live = false; };
  }, [sel, daysByTech, data.month.branch, periodKey]);

  if (!data.month.loaded) {
    return <UploadEmpty canUpload={canUpload} onUploaded={() => router.refresh()} periodKey={periodKey} />;
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
      {canUpload && <div className="flex justify-end"><UploadButton onUploaded={() => router.refresh()} compact /></div>}

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
      {sel && <FocusCard sel={sel} days={days} selDate={selDate} setSelDate={setSelDate} periodKey={periodKey} locks={locks} setLocks={setLocks} proposal={proposal} setProposal={setProposal} changeset={changeset} setChangeset={setChangeset} signed={signed} busy={busy} post={post} />}

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
};
function FocusCard(props: FocusProps) {
  const { sel, days, selDate, setSelDate, periodKey, locks, setLocks, proposal, setProposal, changeset, setChangeset, signed, busy, post } = props;
  const loading = !days;
  const sizes = sel.loads;
  const m = {
    days: sel.totalDays, stops: sel.totalStops, avg: sel.avgStopsPerDay ?? 0, median: median(sizes),
    balance: balanceOf(sizes), perStop: sel.perStop, miles: sel.estMiles ?? 0, drive: sel.estDriveMinutes ?? 0, fuel: (sel.estMiles ?? 0) / MPG * GAS,
  };
  const curDay = useMemo(() => {
    if (!days || !days.length) return null;
    if (selDate) { const d = days.find((x) => x.date === selDate); if (d) return d; }
    return days.reduce((a, b) => (b.stops.length > a.stops.length ? b : a), days[0]);
  }, [days, selDate]);

  const astats: [string, string, string, boolean][] = [
    ["Days", String(m.days), "", false], ["Stops", String(m.stops), "", false], ["Avg/day", String(m.avg), "median " + m.median, false],
    ["Balance", sel.kind === "route" ? String(m.balance) : "—", sel.kind === "route" ? "day evenness" : "not graded", false],
    ["$/stop", money(m.perStop), "", false], ["Est. miles", m.miles.toLocaleString(), "modeled", true],
    ["Est. drive", Math.round(m.drive / 60) + "h", (m.drive % 60) + "m · modeled", true], ["Est. fuel", money(m.fuel), "modeled", true],
  ];

  return (
    <Card className="p-5">
      <div className="flex flex-wrap items-baseline gap-2">
        <span className="text-xl font-light text-ink">{sel.name}</span>
        <span className="text-xs text-muted tabular-nums">Route {sel.routeNo}</span>
        <KindChip kind={sel.kind} />
        {sel.partnerRouteNo && <span className="text-xs text-muted">paired with route {sel.partnerRouteNo}</span>}
      </div>

      <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-8">
        {astats.map((a) => (
          <div key={a[0]} className="rounded-lg border border-line bg-black/[0.015] px-3 py-2">
            <div className="text-[10px] uppercase tracking-wide text-muted">{a[0]}</div>
            <div className="mt-0.5 text-base font-light tabular-nums" style={{ color: a[3] ? SC.good : undefined }}>{a[1]}</div>
            <div className="text-[10px] text-muted">{a[2]}</div>
          </div>
        ))}
      </div>

      {/* findings */}
      <div className="mt-5">
        <div className="text-[11px] uppercase tracking-wide text-brand-600 font-medium">What Canopy flagged</div>
        <div className="mt-2 space-y-2">
          {sel.findings.map((f) => <FindingRow key={f.id} f={f} signed={signed} busy={busy} post={post} />)}
        </div>
      </div>

      {/* calendar + map + stops */}
      <div className="mt-5 text-[11px] uppercase tracking-wide text-muted">Daily load — tap a day</div>
      {loading ? <p className="mt-2 text-sm text-muted">Loading {sel.name}&apos;s routes…</p> : (
        <>
          <Calendar periodKey={periodKey} days={days!} curDate={curDay?.date} onPick={setSelDate} />
          <div className="mt-2 grid grid-cols-1 gap-4 lg:grid-cols-2">
            <div>
              <RouteMap sel={sel} day={curDay} />
              <p className="mt-2 text-[11px] text-muted">Route in service order with direction of travel. {curDay && curDay.stops.some((s) => s.lat == null) ? "Pin positions are modeled until addresses finish geocoding." : "Pins are geocoded addresses."} Real street maps + road drive-time in the full build.</p>
            </div>
            <div>
              <StopList sel={sel} day={curDay} locks={locks} setLocks={setLocks} signed={signed} setProposal={setProposal} />
            </div>
          </div>
          {/* optimize */}
          <Optimize sel={sel} days={days!} locks={locks} proposal={proposal} setProposal={setProposal} changeset={changeset} setChangeset={setChangeset} />
        </>
      )}
    </Card>
  );
}

function FindingRow({ f, signed, busy, post }: { f: Finding; signed: boolean; busy: string | null; post: (p: Record<string, unknown>, t: string) => Promise<boolean>; }) {
  const [resp, setResp] = useState(f.managerResponse ?? "");
  const c = SC[f.severity] ?? SC.warn;
  const answered = f.status === "answered";
  return (
    <div className="rounded-lg border border-l-4 border-line p-3" style={{ borderLeftColor: c }}>
      <div className="flex items-start justify-between gap-3">
        <p className="text-sm text-ink">{f.title}</p>
        {answered && <span className="shrink-0 text-xs font-medium" style={{ color: SC.good }}>Answered</span>}
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

function Calendar({ periodKey, days, curDate, onPick }: { periodKey: string; days: Day[]; curDate?: string; onPick: (d: string) => void }) {
  const [y, mo] = periodKey.split("-").map(Number);
  const counts: Record<string, number> = {}; days.forEach((d) => (counts[d.date] = d.stops.length));
  const max = Math.max(1, ...Object.values(counts));
  const first = new Date(Date.UTC(y, mo - 1, 1)).getUTCDay();
  const dim = new Date(Date.UTC(y, mo, 0)).getUTCDate();
  const cells: React.ReactNode[] = ["S", "M", "T", "W", "T", "F", "S"].map((d, i) => <div key={"h" + i} className="text-center text-[10px] text-muted">{d}</div>);
  for (let i = 0; i < first; i++) cells.push(<div key={"b" + i} />);
  for (let day = 1; day <= dim; day++) {
    const ds = `${y}-${String(mo).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    const c = counts[ds] || 0; const t = c / max;
    cells.push(
      <button key={ds} disabled={!c} onClick={() => onPick(ds)} className={`relative rounded-md border p-1 text-left ${ds === curDate ? "outline outline-2 outline-brand-600" : ""} ${c ? "cursor-pointer" : "opacity-40"}`}
        style={{ aspectRatio: "1 / 0.8", borderColor: "var(--color-line)", background: c ? `color-mix(in srgb, #2e6f47 ${Math.round(18 + t * 72)}%, transparent)` : "transparent" }}>
        <span className="text-[10px]" style={{ color: t > 0.55 ? "rgba(255,255,255,.85)" : "var(--color-muted)" }}>{day}</span>
        {c > 0 && <span className="absolute bottom-0.5 left-1 text-[11px] tabular-nums" style={{ color: t > 0.55 ? "#fff" : "var(--color-ink)" }}>{c}</span>}
      </button>
    );
  }
  return <div className="mt-1 grid grid-cols-7 gap-1">{cells}</div>;
}

function dayCoords(sel: Tech, day: Day): [number, number][] {
  if (day.stops.length && day.stops.every((s) => s.lat != null && s.lng != null)) return day.stops.map((s) => [s.lat as number, s.lng as number]);
  // Illustrative layout (normalized by the map anyway) until geocoding completes.
  const r = rnd(hash(String(sel.routeNo) + day.date)); const out: [number, number][] = []; let lat = 0, lng = 0; const head = r() * 6.283;
  for (let i = 0; i < day.stops.length; i++) { const ang = head + Math.sin(i * 0.9) * 0.9 + (r() - 0.5) * 0.5; const step = 0.004 + r() * 0.004; lat += Math.cos(ang) * step; lng += Math.sin(ang) * step; out.push([lat, lng]); }
  return out;
}
function RouteMap({ sel, day }: { sel: Tech; day: Day | null }) {
  const svgRef = useRef<SVGSVGElement>(null);
  if (!day) return <div className="grid h-72 place-items-center rounded-xl border border-line text-sm text-muted">No route for this day</div>;
  const cs = dayCoords(sel, day); const lats = cs.map((c) => c[0]), lngs = cs.map((c) => c[1]);
  const pad = 46, W = 600, H = 460;
  const minx = Math.min(...lngs), maxx = Math.max(...lngs), miny = Math.min(...lats), maxy = Math.max(...lats);
  const sx = (v: number) => pad + ((v - minx) / ((maxx - minx) || 1)) * (W - 2 * pad);
  const sy = (v: number) => H - pad - ((v - miny) / ((maxy - miny) || 1)) * (H - 2 * pad);
  const pts = cs.map((c) => [sx(c[1]), sy(c[0])] as [number, number]);
  const total = day.stops.reduce((s, x) => s + x.amt, 0);
  return (
    <div className="relative overflow-hidden rounded-xl border border-line" style={{ background: "#eef2ee" }}>
      <svg ref={svgRef} viewBox={`0 0 ${W} ${H}`} className="block w-full" role="img" aria-label="Route map">
        {[1, 2, 3, 4, 5].map((i) => <g key={i}><line x1={0} y1={(H / 6) * i} x2={W} y2={(H / 6) * i} stroke="#d4ddd5" /><line x1={(W / 6) * i} y1={0} x2={(W / 6) * i} y2={H} stroke="#d4ddd5" /></g>)}
        <polyline fill="none" stroke="#2e6f47" strokeWidth={2.3} strokeLinejoin="round" strokeOpacity={0.65} points={pts.map((p) => p.join(",")).join(" ")} />
        {pts.map((p, i) => (<g key={i}><circle cx={p[0]} cy={p[1]} r={day.stops[i].amt >= 150 ? 12 : 10} fill="#1f5836" stroke="#fff" strokeWidth={1.5}><title>{day.stops[i].seq}. {day.stops[i].svc} — {day.stops[i].addr} — {money(day.stops[i].amt)}</title></circle><text x={p[0]} y={p[1] + 3.5} textAnchor="middle" fontSize={10} fill="#fff">{day.stops[i].seq}</text></g>))}
        <circle cx={pts[0][0]} cy={pts[0][1]} r={15} fill="none" stroke="#1F7A45" strokeWidth={2} />
      </svg>
      <div className="absolute bottom-2 left-2 rounded-lg border border-line bg-white/85 px-2 py-1 text-[11px] text-ink">{day.stops.length} stops · {money(total)}</div>
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

function Optimize({ sel, days, locks, proposal, setProposal, changeset, setChangeset }: { sel: Tech; days: Day[]; locks: Set<string>; proposal: Proposal | null; setProposal: (p: Proposal | null) => void; changeset: string | null; setChangeset: (s: string | null) => void }) {
  const fmtD = (ds: string) => { const [y, m, d] = ds.split("-").map(Number); return DOW[new Date(Date.UTC(y, m - 1, d)).getUTCDay()] + " " + m + "/" + d; };
  const nloc = [...locks].filter((k) => k.startsWith(sel.routeNo + "|")).length;
  const run = () => {
    const work = days.map((d) => ({ date: d.date, stops: d.stops.map((s) => ({ ...s })) })).filter((d) => d.stops.length > 0);
    if (work.length < 2) { setProposal({ moves: [], balBefore: 0, balAfter: 0, maxBefore: 0, maxAfter: 0 }); return; }
    const size = (d: { stops: unknown[] }) => d.stops.length;
    const sizesBefore = work.map(size);
    const moves: { addr: string; city: string; amt: number; svc: string; from: string; to: string }[] = [];
    let guard = 0;
    while (guard++ < 400) {
      const donor = work.reduce((a, b) => (size(b) > size(a) ? b : a));
      const recip = work.reduce((a, b) => (size(b) < size(a) ? b : a));
      if (size(donor) - size(recip) <= 2) break;
      const cand = donor.stops.filter((s) => !locks.has(`${sel.routeNo}|${donor.date}|${s.seq}`)).sort((a, b) => a.amt - b.amt)[0];
      if (!cand) break;
      donor.stops = donor.stops.filter((s) => s !== cand); recip.stops.push(cand);
      moves.push({ addr: cand.addr, city: cand.city, amt: cand.amt, svc: cand.svc, from: donor.date, to: recip.date });
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
        <button onClick={run} className={btn.secondary}>Ask Canopy to rebalance {sel.name}&apos;s month</button>
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
          <div className="mt-3 flex gap-2">
            <button className={btn.secondary} onClick={() => setChangeset(["CanopyOS — proposed routing changes", `Route ${sel.routeNo} ${sel.name} · ${sel.kind}`, `Respecting ${nloc} locked job(s)`, "----", ...proposal.moves.map((mv: Move) => `MOVE  ${mv.addr}, ${mv.city}  ($${Math.round(mv.amt)} ${mv.svc})  ${mv.from} -> ${mv.to}`)].join("\n"))}>Export change set for PestPac</button>
            <button className="rounded-lg border border-line px-3 py-1.5 text-xs text-muted" onClick={() => { setProposal(null); setChangeset(null); }}>Discard</button>
          </div>
          {changeset && <pre className="mt-3 overflow-x-auto whitespace-pre rounded-lg border border-line bg-black/[0.02] p-3 text-[11px] text-ink">{changeset}</pre>}
        </div>
      )}
    </div>
  );
}

function UploadButton({ onUploaded, compact }: { onUploaded: () => void; compact?: boolean }) {
  const ref = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const onFile = async (file: File) => {
    setBusy(true); setMsg(null);
    try {
      const text = await file.text();
      const res = await fetch("/api/routing-approval", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "upload", fileName: file.name, text }) });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) { setMsg(j.error || "Upload failed."); return; }
      setMsg(`Loaded ${(j.months as { stops: number }[] | undefined)?.reduce((s, m) => s + m.stops, 0)?.toLocaleString()} stops across ${j.months?.length} branches.`);
      onUploaded();
    } catch (e) { setMsg((e as Error).message); } finally { setBusy(false); }
  };
  return (
    <div className={compact ? "flex items-center gap-2" : "flex flex-col items-center gap-2"}>
      <input ref={ref} type="file" accept=".xls,.tsv,.csv,.txt" className="hidden" onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])} />
      <button className={btn.secondary} disabled={busy} onClick={() => ref.current?.click()}>{busy ? "Loading…" : "Upload monthly routing export"}</button>
      {msg && <span className="text-xs text-muted">{msg}</span>}
    </div>
  );
}
function UploadEmpty({ canUpload, periodKey }: { canUpload: boolean; onUploaded: () => void; periodKey: string }) {
  const router = useRouter();
  return (
    <Card className="p-8 text-center">
      <h3 className="text-lg font-light text-ink">Routing not loaded for {periodKey}</h3>
      <p className="mx-auto mt-2 max-w-md text-sm text-muted">{canUpload ? "Load the PestPac “Technician Schedule Report” for the month (sorted by Technician) to populate the review. Re-uploading replaces the month." : "An admin loads the monthly routing export, then you’ll review and sign off on each technician here."}</p>
      {canUpload && <div className="mt-4 flex justify-center"><UploadButton onUploaded={() => router.refresh()} /></div>}
    </Card>
  );
}
