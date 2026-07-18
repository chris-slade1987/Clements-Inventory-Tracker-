"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Card } from "@/components/ui";
import RangeToggle from "@/components/RangeToggle";
import { money } from "@/lib/format";
import { computeFuelRange, okCpg, okMpg, isoDay, type FuelRangeMode } from "@/lib/fuel-format";

export type FuelRow = {
  id: string;
  date: string; // ISO
  driverName: string | null;
  merchant: string | null;
  gallons: number | null;
  costPerGallon: number | null;
  calculatedMpg: number | null;
  odometer: number | null;
  amount: number;
  type: string;
};

const dayMs = 864e5;
const fmtDate = (isoStr: string) => new Date(isoStr).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });

/**
 * Per-vehicle fuel history with a date-range switch that defaults to the last
 * 30 days. Ranges anchor to the most recent transaction (not "today"), and all
 * computation is client-side over the vehicle's rows.
 */
export default function VehicleFuelPanel({ rows }: { rows: FuelRow[] }) {
  const purchases = useMemo(() => rows.filter((r) => r.type === "Purchase" || r.amount > 0), [rows]);
  const anchor = useMemo(() => {
    const t = Math.max(0, ...purchases.map((r) => Date.parse(r.date)));
    return t > 0 ? new Date(t) : new Date();
  }, [purchases]);

  const [mode, setMode] = useState<FuelRangeMode>("30d");
  const [customStart, setCustomStart] = useState(isoDay(new Date(anchor.getTime() - 30 * dayMs)));
  const [customEnd, setCustomEnd] = useState(isoDay(anchor));

  const [start, end] = useMemo(() => computeFuelRange(mode, anchor, customStart, customEnd), [mode, anchor, customStart, customEnd]);

  const inRange = useMemo(
    () => purchases
      .filter((r) => { const t = Date.parse(r.date); return t >= start.getTime() && t <= end.getTime(); })
      .sort((x, y) => Date.parse(y.date) - Date.parse(x.date)),
    [purchases, start, end],
  );

  const summary = useMemo(() => {
    const spend = inRange.reduce((s, r) => s + r.amount, 0);
    const gallons = inRange.reduce((s, r) => s + (r.gallons ?? 0), 0);
    const mpgs = inRange.map((r) => r.calculatedMpg).filter(okMpg);
    const cpgs = inRange.map((r) => r.costPerGallon).filter(okCpg);
    return {
      spend,
      gallons,
      fills: inRange.length,
      avgMpg: mpgs.length ? mpgs.reduce((s, x) => s + x, 0) / mpgs.length : null,
      avgCpg: cpgs.length ? cpgs.reduce((s, x) => s + x, 0) / cpgs.length : null,
    };
  }, [inRange]);

  return (
    <Card className="p-0 overflow-hidden mb-5">
      <div className="px-4 py-3 border-b border-line flex items-center justify-between gap-2">
        <div className="text-sm font-medium text-ink">Fuel</div>
        <Link href="/fleet/fuel" className="text-xs font-medium text-brand-700 hover:underline">Fleet fuel →</Link>
      </div>

      {purchases.length === 0 ? (
        <p className="px-4 py-6 text-center text-sm text-muted">No fuel purchases linked to this vehicle yet.</p>
      ) : (
        <>
          <div className="px-4 pt-3">
            <RangeToggle
              mode={mode} onMode={setMode}
              customStart={customStart} customEnd={customEnd}
              onCustomStart={setCustomStart} onCustomEnd={setCustomEnd}
              start={start} end={end}
            />
          </div>

          <div className="grid grid-cols-2 lg:grid-cols-4 divide-x divide-line border-y border-line mt-3">
            <Stat label="Spend" value={money(summary.spend)} />
            <Stat label="Gallons" value={summary.gallons.toLocaleString(undefined, { maximumFractionDigits: 0 })} sub={`${summary.fills} fill${summary.fills === 1 ? "" : "s"}`} />
            <Stat label="Avg MPG" value={summary.avgMpg ? summary.avgMpg.toFixed(1) : "—"} />
            <Stat label="Avg $/gal" value={summary.avgCpg ? `$${summary.avgCpg.toFixed(2)}` : "—"} />
          </div>

          {inRange.length === 0 ? (
            <p className="px-4 py-8 text-center text-sm text-muted">No fuel purchases in this range.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-muted border-b border-line">
                    <th className="px-4 py-2 font-medium">Date</th>
                    <th className="px-3 py-2 font-medium">Driver</th>
                    <th className="px-3 py-2 font-medium">Merchant</th>
                    <th className="px-3 py-2 font-medium text-right">Gallons</th>
                    <th className="px-3 py-2 font-medium text-right">$/gal</th>
                    <th className="px-3 py-2 font-medium text-right">MPG</th>
                    <th className="px-3 py-2 font-medium text-right">Odometer</th>
                    <th className="px-4 py-2 font-medium text-right">Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {inRange.map((f) => (
                    <tr key={f.id} className="border-b border-line last:border-0">
                      <td className="px-4 py-2 whitespace-nowrap">{fmtDate(f.date)}</td>
                      <td className="px-3 py-2 text-muted whitespace-nowrap">{f.driverName ?? "—"}</td>
                      <td className="px-3 py-2 text-muted">{f.merchant ?? "—"}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{f.gallons != null ? f.gallons.toFixed(1) : "—"}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{okCpg(f.costPerGallon) ? `$${f.costPerGallon!.toFixed(2)}` : "—"}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{okMpg(f.calculatedMpg) ? f.calculatedMpg!.toFixed(1) : "—"}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{f.odometer != null ? f.odometer.toLocaleString() : "—"}</td>
                      <td className="px-4 py-2 text-right tabular-nums font-medium">{money(f.amount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </Card>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="px-4 py-3">
      <div className="text-[11px] uppercase tracking-wider text-muted">{label}</div>
      <div className="mt-0.5 text-lg font-light tabular-nums text-ink">{value}</div>
      {sub ? <div className="text-[11px] text-muted">{sub}</div> : null}
    </div>
  );
}
