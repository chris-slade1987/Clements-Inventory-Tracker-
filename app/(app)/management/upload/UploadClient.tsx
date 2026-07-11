"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Card, btn } from "@/components/ui";
import { money } from "@/lib/format";

type ParsedKpi = { key: string; scope: string; basis: string; actual: number | null; budget: number | null };
type Parsed = {
  year: number; month: number; label: string;
  kpis: ParsedKpi[];
  lob: { scope: string; lob: string; revenue: number }[];
  techProduction: { scope: string; name: string; actual: number; budget: number }[];
  source: string;
};

const KPI_LABELS: Record<string, string> = {
  net_revenue: "Net Revenue", operating_income: "Operating Income", ebitda: "EBITDA",
  ebitda_pct: "EBITDA %", route_contrib: "Route Contribution", route_contrib_pct: "Route Contribution %",
  ending_cash: "Ending Cash", production: "Production", book_value: "Book Value", new_sales: "New Sales",
  attrition: "Attrition", attrition_rate: "Attrition Rate", tech_wages: "Technician Wages", fuel: "Fuel",
  chemical_expense: "Chemical Expense", vehicle_rm: "Vehicle R&M", sga: "Total SG&A", net_income: "Net Income",
};

export default function UploadClient({ hasKey }: { hasKey: boolean }) {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [parsed, setParsed] = useState<Parsed | null>(null);

  async function onFile(file: File) {
    setBusy(true); setError(null); setNote(null); setParsed(null);
    const fd = new FormData();
    fd.append("file", file);
    try {
      const res = await fetch("/api/management/upload", { method: "POST", body: fd });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) setError(data.error ?? "Could not read the report.");
      else setParsed(data.parsed);
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  async function commit() {
    if (!parsed) return;
    setBusy(true); setError(null);
    try {
      const res = await fetch("/api/management/upload", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ parsed }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { setError(data.error ?? "Save failed."); return; }
      setNote(`Saved ${parsed.label}: ${data.kpis} KPI values, ${data.lob} line-of-business rows, ${data.techs} technicians.`);
      setParsed(null);
      router.push(`/management?p=${parsed.year}-${String(parsed.month).padStart(2, "0")}`);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  const company = (k: string, basis = "month") =>
    parsed?.kpis.find((v) => v.key === k && v.scope === "company" && v.basis === basis);

  return (
    <>
      <div className="flex flex-wrap items-center gap-2 mb-3">
        <button onClick={() => fileRef.current?.click()} disabled={busy} className={btn.primary}>
          {busy ? "Reading…" : "Upload MBR"}
        </button>
        <input
          ref={fileRef}
          type="file"
          accept=".pdf,application/pdf,.json,application/json,image/*"
          className="hidden"
          onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])}
        />
        <span className="text-xs text-muted">PDF of the Monthly Board Report{!hasKey ? " (or a .json extract — PDF reading needs an API key)" : ""}.</span>
      </div>

      {!hasKey ? (
        <p className="mb-3 text-xs text-amber-300">
          Reading a PDF requires <code>ANTHROPIC_API_KEY</code> to be set on the server. Until then you can upload a structured <code>.json</code> extract.
        </p>
      ) : null}
      {error ? <p className="mb-3 text-sm text-red-400">{error}</p> : null}
      {note ? <p className="mb-3 text-sm text-brand-200">{note}</p> : null}

      {parsed ? (
        <Card className="p-4 space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-lg font-medium">{parsed.label}</div>
              <div className="text-xs text-muted">
                Read from {parsed.source === "claude" ? "the uploaded PDF" : "a JSON extract"} · {parsed.kpis.length} KPI values ·{" "}
                {parsed.lob.length} LOB rows · {parsed.techProduction.length} technicians
              </div>
            </div>
            <button onClick={commit} disabled={busy} className={btn.primary}>
              {busy ? "Saving…" : "Confirm & update dashboard"}
            </button>
          </div>

          <div>
            <div className="text-xs uppercase tracking-wider text-muted mb-2">Company headline — this month (review before saving)</div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-muted border-b border-line">
                    <th className="px-2 py-1.5 font-medium">Metric</th>
                    <th className="px-2 py-1.5 font-medium text-right">Actual</th>
                    <th className="px-2 py-1.5 font-medium text-right">Budget</th>
                  </tr>
                </thead>
                <tbody>
                  {["net_revenue", "operating_income", "ebitda", "route_contrib", "chemical_expense", "new_sales"].map((k) => {
                    const c = company(k);
                    if (!c) return null;
                    const pct = k.endsWith("_pct");
                    const f = (n: number | null) => (n == null ? "—" : pct ? `${n}%` : money(n));
                    return (
                      <tr key={k} className="border-b border-line last:border-0">
                        <td className="px-2 py-1.5">{KPI_LABELS[k] ?? k}</td>
                        <td className="px-2 py-1.5 text-right tabular-nums font-medium">{f(c.actual)}</td>
                        <td className="px-2 py-1.5 text-right tabular-nums text-muted">{f(c.budget)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          <p className="text-[11px] text-muted">
            Saving replaces any existing data for {parsed.label}. Manager compensation is never imported.
          </p>
        </Card>
      ) : null}
    </>
  );
}
