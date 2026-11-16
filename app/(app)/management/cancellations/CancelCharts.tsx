"use client";

// Cancellation Center — client pieces: ranked bar lists (click a bar to filter),
// the division donut (fixed color per division, never by rank), the filter row,
// the account table with CSV export, and the admin upload card.

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useMemo, useRef, useState } from "react";
import { btn } from "@/components/ui";

const INK = "#1d2a23";
const MUTED = "#5c6b62";
const TRACK = "#eef1ef";
const BAR = "#2e6f47"; // brand-600 — single-hue magnitude
const BAR_ACTIVE = "#0b3d20";

const money0 = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;

// ---- Ranked bar list -------------------------------------------------------
export type BarRow = { key: string; label: string; sub?: string; value: number; count: number; href?: string; active?: boolean };

export function BarList({ rows, total, emptyText = "Nothing to show.", max = 12 }: { rows: BarRow[]; total: number; emptyText?: string; max?: number }) {
  const [hover, setHover] = useState<string | null>(null);
  const [all, setAll] = useState(false);
  if (rows.length === 0) return <p className="py-6 text-center text-sm text-muted">{emptyText}</p>;
  const shown = all ? rows : rows.slice(0, max);
  const top = Math.max(...rows.map((r) => r.value), 1);
  return (
    <div>
      <ul className="space-y-1.5">
        {shown.map((r) => {
          const pct = total > 0 ? Math.round((r.value / total) * 100) : 0;
          const inner = (
            <div
              className={`relative rounded-lg px-2 py-1.5 transition-colors ${r.href ? "hover:bg-brand-50" : ""} ${r.active ? "bg-brand-50 ring-1 ring-brand-300" : ""}`}
              onMouseEnter={() => setHover(r.key)}
              onMouseLeave={() => setHover(null)}
            >
              <div className="flex items-baseline justify-between gap-3 text-sm">
                <span className="min-w-0 truncate text-ink">
                  {r.label}
                  {r.sub ? <span className="ml-1.5 text-xs text-muted">{r.sub}</span> : null}
                </span>
                <span className="shrink-0 tabular-nums text-ink">
                  {money0(r.value)} <span className="text-xs text-muted">· {r.count}</span>
                </span>
              </div>
              <div className="mt-1 h-2 rounded-full" style={{ background: TRACK }}>
                <div className="h-2 rounded-full" style={{ width: `${Math.max(2, (r.value / top) * 100)}%`, background: r.active || hover === r.key ? BAR_ACTIVE : BAR }} />
              </div>
              {hover === r.key ? (
                <div role="tooltip" className="pointer-events-none absolute right-2 top-full z-10 mt-1 rounded-md border border-line bg-white px-2.5 py-1.5 text-xs text-ink shadow-md">
                  <div className="font-medium">{r.label}</div>
                  <div className="tabular-nums">{money0(r.value)} lost · {r.count} cancelled service{r.count === 1 ? "" : "s"}</div>
                  <div className="tabular-nums text-muted">{pct}% of the $ in view{r.href ? " · click to filter" : ""}</div>
                </div>
              ) : null}
            </div>
          );
          return <li key={r.key}>{r.href ? <Link href={r.href} scroll={false} aria-label={`Filter to ${r.label}`}>{inner}</Link> : inner}</li>;
        })}
      </ul>
      {rows.length > max ? (
        <button type="button" onClick={() => setAll((v) => !v)} className="mt-2 text-xs text-brand-700 hover:underline">
          {all ? "Show top " + max : `Show all ${rows.length}`}
        </button>
      ) : null}
    </div>
  );
}

// ---- Division donut (fixed color per division) ------------------------------
// Validated categorical slots (CVD-safe adjacent order) from components/charts SERIES.
export const DIVISION_COLORS: Record<string, string> = {
  GHP: "#2a78d6",
  LO: "#1baf7a",
  TERMITE: "#eda100",
  MOSQUITO: "#4a3aa7",
  RODENT: "#008300",
  OTHER: "#8a968f",
};

export function DivisionDonut({ slices }: { slices: { key: string; label: string; value: number; count: number; href: string; active: boolean }[] }) {
  const [hover, setHover] = useState<number | null>(null);
  const total = slices.reduce((s, x) => s + x.value, 0);
  if (total <= 0) return <p className="py-6 text-center text-sm text-muted">Nothing to show.</p>;
  const R = 80, r = 52, cx = 100, cy = 100;
  const starts = slices.map((_, i) => slices.slice(0, i).reduce((acc, x) => acc + x.value, 0) / total);
  const arcs = slices.map((s, i) => {
    const frac = s.value / total;
    const a0 = -Math.PI / 2 + starts[i] * Math.PI * 2, a1 = a0 + Math.min(frac, 0.9999) * Math.PI * 2;
    const large = a1 - a0 > Math.PI ? 1 : 0;
    const p = (rad: number, ang: number) => `${cx + rad * Math.cos(ang)},${cy + rad * Math.sin(ang)}`;
    const d = `M ${p(R, a0)} A ${R} ${R} 0 ${large} 1 ${p(R, a1)} L ${p(r, a1)} A ${r} ${r} 0 ${large} 0 ${p(r, a0)} Z`;
    return { d, s, pct: Math.round(frac * 100), color: DIVISION_COLORS[s.key] ?? DIVISION_COLORS.OTHER };
  });
  const h = hover != null ? arcs[hover] : null;
  return (
    <div className="flex flex-wrap items-center gap-5">
      <svg viewBox="0 0 200 200" width="170" height="170" role="img" aria-label="Cancellations by service division">
        {arcs.map((a, i) => (
          <path key={a.s.key} d={a.d} fill={a.color} stroke="#ffffff" strokeWidth={2}
            opacity={hover == null || hover === i ? 1 : 0.5}
            onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)} onTouchStart={() => setHover(i)} />
        ))}
        <text x={100} y={h ? 95 : 98} textAnchor="middle" fontSize={h ? 16 : 19} fill={INK}>{h ? money0(h.s.value) : money0(total)}</text>
        <text x={100} y={h ? 112 : 116} textAnchor="middle" fontSize={10.5} fill={MUTED}>{h ? `${h.s.label} · ${h.pct}%` : "lost value"}</text>
      </svg>
      <ul className="min-w-[170px] flex-1 space-y-1">
        {arcs.map((a, i) => (
          <li key={a.s.key} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
            <Link href={a.s.href} scroll={false} className={`flex items-center gap-2 rounded-md px-1.5 py-1 text-sm hover:bg-brand-50 ${a.s.active ? "bg-brand-50 ring-1 ring-brand-300" : ""}`}>
              <span className="inline-block h-3 w-3 shrink-0 rounded-sm" style={{ background: a.color }} />
              <span className="flex-1 truncate text-ink">{a.s.label}</span>
              <span className="tabular-nums text-ink">{a.pct}%</span>
              <span className="tabular-nums text-xs text-muted">{money0(a.s.value)} · {a.s.count}</span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

// ---- Filter row ---------------------------------------------------------------
export type FilterOpt = { value: string; label: string };

export function CancelFilters({
  months, branches, divisions, services, routes, cities, lockedBranch,
}: {
  months: FilterOpt[]; branches: FilterOpt[]; divisions: FilterOpt[]; services: FilterOpt[]; routes: FilterOpt[]; cities: FilterOpt[];
  lockedBranch: string | null;
}) {
  const router = useRouter();
  const sp = useSearchParams();
  const set = (k: string, v: string) => {
    const q = new URLSearchParams(sp.toString());
    if (v) q.set(k, v); else q.delete(k);
    // Changing the branch clears a route/city that may not belong to it.
    if (k === "branch") { q.delete("route"); q.delete("city"); }
    router.replace(`?${q.toString()}`, { scroll: false });
  };
  const anyFilter = ["branch", "div", "svc", "route", "city"].some((k) => sp.get(k) && !(k === "branch" && lockedBranch));
  const sel = "min-h-[44px] rounded-lg border border-line bg-white px-3 text-sm text-ink";
  const field = (label: string, k: string, opts: FilterOpt[], allLabel: string, disabled = false) => (
    <label className="flex min-w-[140px] flex-1 flex-col gap-1 text-xs text-muted">
      {label}
      <select className={sel} value={sp.get(k) ?? (k === "branch" && lockedBranch ? lockedBranch : "")} disabled={disabled} onChange={(e) => set(k, e.target.value)}>
        {k !== "m" ? <option value="">{allLabel}</option> : null}
        {opts.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </label>
  );
  return (
    <div className="flex flex-wrap items-end gap-2">
      {field("Month", "m", months, "")}
      {field("Branch", "branch", branches, "All branches", !!lockedBranch)}
      {field("Division", "div", divisions, "All divisions")}
      {field("Service type", "svc", services, "All services")}
      {field("Route / tech", "route", routes, "All routes")}
      {field("City", "city", cities, "All cities")}
      {anyFilter ? (
        <button type="button" className={`${btn.secondary} min-h-[44px]`} onClick={() => {
          const q = new URLSearchParams();
          const m = sp.get("m"); if (m) q.set("m", m);
          router.replace(`?${q.toString()}`, { scroll: false });
        }}>Clear filters</button>
      ) : null}
    </div>
  );
}

// ---- Account table + CSV -------------------------------------------------------
export type AccountRow = {
  account: string; customer: string; city: string; zip: string; branch: string; route: string; tech: string;
  serviceCode: string; division: string; lossCount: number; lossValue: number;
};

export function AccountTable({ rows, fileLabel }: { rows: AccountRow[]; fileLabel: string }) {
  const [q, setQ] = useState("");
  const [sort, setSort] = useState<{ k: keyof AccountRow; dir: 1 | -1 }>({ k: "lossValue", dir: -1 });
  const shown = useMemo(() => {
    const t = q.trim().toLowerCase();
    const f = t ? rows.filter((r) => Object.values(r).some((v) => String(v).toLowerCase().includes(t))) : rows;
    return [...f].sort((a, b) => {
      const x = a[sort.k], y = b[sort.k];
      return (typeof x === "number" && typeof y === "number" ? x - y : String(x).localeCompare(String(y), undefined, { numeric: true })) * sort.dir;
    });
  }, [rows, q, sort]);

  const csv = () => {
    const head = ["Account", "Customer", "City", "Zip", "Branch", "Route", "Technician", "Service", "Division", "Cancelled services", "Lost value"];
    const esc = (v: string | number) => { const s = String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
    const body = shown.map((r) => [r.account, r.customer, r.city, r.zip, r.branch, r.route, r.tech, r.serviceCode, r.division, r.lossCount, r.lossValue.toFixed(2)].map(esc).join(","));
    const blob = new Blob([[head.join(","), ...body].join("\n")], { type: "text/csv" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `cancellations-${fileLabel}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const th = (label: string, k: keyof AccountRow, right = false) => (
    <th scope="col" className={`px-3 py-2 font-medium ${right ? "text-right" : "text-left"}`}>
      <button type="button" className="hover:text-ink" onClick={() => setSort((s) => ({ k, dir: s.k === k ? (s.dir === 1 ? -1 : 1) : right ? -1 : 1 }))}>
        {label}{sort.k === k ? (sort.dir === 1 ? " ↑" : " ↓") : ""}
      </button>
    </th>
  );

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2 px-4 py-3">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search account, customer, city, route…" className="min-h-[44px] flex-1 rounded-lg border border-line bg-white px-3 text-sm text-ink" />
        <button type="button" className={btn.secondary} onClick={csv}>Download CSV</button>
      </div>
      <div className="max-h-[520px] overflow-auto border-t border-line">
        <table className="w-full min-w-[760px] text-sm">
          <thead className="sticky top-0 bg-[#f4f6f5] text-xs text-muted">
            <tr>
              {th("Account", "account")}{th("Customer", "customer")}{th("Lost value", "lossValue", true)}{th("Service", "serviceCode")}{th("Route", "route")}{th("City", "city")}{th("Services", "lossCount", true)}
            </tr>
          </thead>
          <tbody>
            {shown.map((r, i) => (
              <tr key={`${r.account}-${r.serviceCode}-${i}`} className="border-t border-line">
                <td className="px-3 py-2 tabular-nums text-muted">{r.account}</td>
                <td className="px-3 py-2 text-ink">{r.customer}</td>
                <td className="px-3 py-2 text-right tabular-nums text-ink">{money0(r.lossValue)}</td>
                <td className="whitespace-nowrap px-3 py-2 text-ink">{r.serviceCode}</td>
                <td className="px-3 py-2 text-ink">{r.route}{r.tech ? <span className="text-muted"> · {r.tech}</span> : null}</td>
                <td className="px-3 py-2 text-ink">{r.city}</td>
                <td className="px-3 py-2 text-right tabular-nums text-ink">{r.lossCount}</td>
              </tr>
            ))}
            {shown.length === 0 ? <tr><td colSpan={7} className="px-3 py-6 text-center text-muted">No matching accounts.</td></tr> : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ---- Upload (admins) --------------------------------------------------------
type Summary = {
  periodKey: string; startDate: string; endDate: string; rows: number; lossCount: number; lossValue: number; totalsChecked: boolean;
  byBranch: Record<string, { count: number; value: number }>; replaces: { endDate: string; fileName: string } | null;
};

const BRANCH_NAMES: Record<string, string> = { vero: "Vero Beach", stuart: "Stuart", orlando: "Orlando", naples: "Naples" };
const fmtDate = (iso: string) => { const [y, m, d] = iso.split("-").map(Number); return `${m}/${d}/${y}`; };

export function UploadCard() {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<{ name: string; text: string } | null>(null);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null);

  const post = async (action: "preview" | "apply", f: { name: string; text: string }) => {
    setBusy(true); setErr(null);
    try {
      const r = await fetch("/api/cancellations", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, fileName: f.name, text: f.text }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) { setErr(j.error ?? "Upload failed."); setSummary(null); return; }
      if (action === "preview") setSummary(j.summary);
      else {
        setDone(`Saved ${j.summary.rows} cancellations for ${fmtDate(j.summary.startDate)}–${fmtDate(j.summary.endDate)}.`);
        setSummary(null); setFile(null);
        if (input.current) input.current.value = "";
        router.replace(`?m=${j.summary.periodKey}`, { scroll: false });
        router.refresh();
      }
    } finally { setBusy(false); }
  };

  return (
    <div className="p-4">
      <p className="text-sm text-muted">
        In PestPac run <span className="text-ink">Reports → Gain &amp; Loss</span> for one month (month-to-date is fine), <span className="text-ink">sorted by Branch, Route</span>, and save it. Uploading a month again replaces that month.
      </p>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <input ref={input} type="file" accept=".xls,.txt,.tsv,.csv" className="text-sm"
          onChange={async (e) => {
            const f = e.target.files?.[0]; setDone(null); setSummary(null); setErr(null);
            if (!f) { setFile(null); return; }
            const text = await f.text();
            const next = { name: f.name, text };
            setFile(next);
            void post("preview", next);
          }} />
      </div>
      {busy ? <p className="mt-3 text-sm text-muted">Reading…</p> : null}
      {err ? <p role="alert" className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{err}</p> : null}
      {done ? <p role="status" className="mt-3 rounded-lg border border-brand-200 bg-brand-50 px-3 py-2 text-sm text-brand-800">{done}</p> : null}
      {summary && file ? (
        <div className="mt-3 rounded-lg border border-line bg-white p-3 text-sm">
          <div className="text-ink">
            {fmtDate(summary.startDate)}–{fmtDate(summary.endDate)} · {summary.lossCount} cancelled services · {money0(summary.lossValue)}
            {summary.totalsChecked ? <span className="ml-2 text-xs text-brand-700">matches the report totals</span> : null}
          </div>
          <ul className="mt-1 text-xs text-muted">
            {Object.entries(summary.byBranch).map(([b, v]) => <li key={b}>{BRANCH_NAMES[b] ?? b}: {v.count} · {money0(v.value)}</li>)}
          </ul>
          {summary.replaces ? <p className="mt-2 text-xs text-muted">This replaces the upload through {fmtDate(summary.replaces.endDate)} ({summary.replaces.fileName}).</p> : null}
          <button type="button" className={`${btn.primary} mt-3`} disabled={busy} onClick={() => post("apply", file)}>Save this month</button>
        </div>
      ) : null}
    </div>
  );
}
