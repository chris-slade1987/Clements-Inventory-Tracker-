"use client";

// Cancellation Center — client pieces: division colors, the account table with
// CSV export, and the admin upload card. Charts live in Viz.tsx; the dashboard
// itself in Dashboard.tsx.

import { useRouter } from "next/navigation";
import { useMemo, useRef, useState } from "react";
import { btn } from "@/components/ui";

const money0 = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;

// ---- Division colors (fixed per division, never by rank) -------------------
// Validated categorical slots (CVD-safe adjacent order).
export const DIVISION_COLORS: Record<string, string> = {
  GHP: "#2a78d6",
  LO: "#1baf7a",
  TERMITE: "#eda100",
  MOSQUITO: "#4a3aa7",
  RODENT: "#008300",
  OTHER: "#8a968f",
};

// ---- Account table + CSV -------------------------------------------------------
export type AccountRow = {
  reason: string; since: string;
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
    const head = ["Account", "Customer", "City", "Zip", "Branch", "Route", "Technician", "Service", "Division", "Cancel reason", "Service since", "Cancelled services", "Lost value"];
    const esc = (v: string | number) => { const s = String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
    const body = shown.map((r) => [r.account, r.customer, r.city, r.zip, r.branch, r.route, r.tech, r.serviceCode, r.division, r.reason, r.since, r.lossCount, r.lossValue.toFixed(2)].map(esc).join(","));
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
              {th("Account", "account")}{th("Customer", "customer")}{th("Lost value", "lossValue", true)}{th("Service", "serviceCode")}{th("Reason", "reason")}{th("Route", "route")}{th("City", "city")}{th("Services", "lossCount", true)}
            </tr>
          </thead>
          <tbody>
            {shown.map((r, i) => (
              <tr key={`${r.account}-${r.serviceCode}-${i}`} className="border-t border-line">
                <td className="px-3 py-2 tabular-nums text-muted">{r.account}</td>
                <td className="px-3 py-2 text-ink">{r.customer}</td>
                <td className="px-3 py-2 text-right tabular-nums text-ink">{money0(r.lossValue)}</td>
                <td className="whitespace-nowrap px-3 py-2 text-ink">{r.serviceCode}{r.since ? <div className="text-xs text-muted">since {r.since}</div> : null}</td>
                <td className="whitespace-nowrap px-3 py-2 text-ink">{r.reason || <span className="text-muted">—</span>}</td>
                <td className="px-3 py-2 text-ink">{r.route}{r.tech ? <span className="text-muted"> · {r.tech}</span> : null}</td>
                <td className="px-3 py-2 text-ink">{r.city}</td>
                <td className="px-3 py-2 text-right tabular-nums text-ink">{r.lossCount}</td>
              </tr>
            ))}
            {shown.length === 0 ? <tr><td colSpan={8} className="px-3 py-6 text-center text-muted">No matching accounts.</td></tr> : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ---- Upload (admins) --------------------------------------------------------
type Summary = {
  kind: "gainloss" | "setups"; reasons?: { reason: string; count: number }[];
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
        setDone(j.summary.kind === "setups"
          ? `Saved ${j.summary.rows} cancel reasons for ${fmtDate(j.summary.startDate)}–${fmtDate(j.summary.endDate)}.`
          : `Saved ${j.summary.rows} cancellations for ${fmtDate(j.summary.startDate)}–${fmtDate(j.summary.endDate)}.`);
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
        Two PestPac reports, each for one month (month-to-date is fine), <span className="text-ink">sorted by Branch, Route</span>: the <span className="text-ink">Gain &amp; Loss Report</span> (the cancellations and their value) and the <span className="text-ink">Service Setup List</span> with <span className="text-ink">Start / End Cancel Date</span> set to the same dates (the cancel reasons). Upload either one here; the portal recognizes which it is. Uploading a month again replaces that month&apos;s copy of that report.
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
            {summary.kind === "setups" ? "Service Setup List (cancel reasons) · " : "Gain & Loss Report · "}
            {fmtDate(summary.startDate)}–{fmtDate(summary.endDate)} · {summary.kind === "setups" ? `${summary.rows} cancelled setups` : `${summary.lossCount} cancelled services · ${money0(summary.lossValue)}`}
            {summary.totalsChecked ? <span className="ml-2 text-xs text-brand-700">matches the report totals</span> : null}
          </div>
          <ul className="mt-1 text-xs text-muted">
            {Object.entries(summary.byBranch).map(([b, v]) => <li key={b}>{BRANCH_NAMES[b] ?? b}: {v.count}{summary.kind === "setups" ? "" : ` · ${money0(v.value)}`}</li>)}
          </ul>
          {summary.reasons?.length ? <p className="mt-1 text-xs text-muted">Reasons: {summary.reasons.map((r) => `${r.reason} ${r.count}`).join(" · ")}</p> : null}
          {summary.replaces ? <p className="mt-2 text-xs text-muted">This replaces the upload through {fmtDate(summary.replaces.endDate)} ({summary.replaces.fileName}).</p> : null}
          <button type="button" className={`${btn.primary} mt-3`} disabled={busy} onClick={() => post("apply", file)}>Save this month</button>
        </div>
      ) : null}
    </div>
  );
}
