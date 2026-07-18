"use client";

import { Fragment, useMemo, useState } from "react";
import Link from "next/link";
import { Card } from "@/components/ui";
import RangeToggle from "@/components/RangeToggle";
import { money } from "@/lib/format";
import { BRANCHES, branchLabel } from "@/lib/management";
import { computeFuelRange, okMpg, isoDay, type FuelRangeMode } from "@/lib/fuel-format";

export type FleetRow = {
  id: string;
  date: string;
  amount: number;
  gallons: number | null;
  costPerGallon: number | null;
  calculatedMpg: number | null;
  type: string;
  vehicleId: string;
  unit: string | null;
  name: string;
  year: number | null;
  branch: string | null;
};

const dayMs = 864e5;
const MONTH_LABEL = (ym: string) => {
  const [y, m] = ym.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString("en-US", { month: "short", year: "2-digit", timeZone: "UTC" });
};

/**
 * Interactive fleet fuel dashboard. The date-range switch (default last 30 days)
 * drives the top tiles and the per-vehicle table. The month trend and account
 * fees/rebates stay full-history as context.
 */
export default function FleetFuelDashboard({
  rows,
  months,
  fees,
  rebates,
}: {
  rows: FleetRow[];
  months: { month: string; spend: number }[];
  fees: number;
  rebates: number;
}) {
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
    () => purchases.filter((r) => { const t = Date.parse(r.date); return t >= start.getTime() && t <= end.getTime(); }),
    [purchases, start, end],
  );

  const totals = useMemo(() => {
    const spend = inRange.reduce((s, r) => s + r.amount, 0);
    const gallons = inRange.reduce((s, r) => s + (r.gallons ?? 0), 0);
    const vehicles = new Set(inRange.map((r) => r.vehicleId));
    return { spend, gallons, vehicleCount: vehicles.size, avgCpg: gallons > 0 ? spend / gallons : null };
  }, [inRange]);

  // Per-vehicle rollup, grouped by branch (Vero → Stuart → Orlando → Naples),
  // oldest to newest vehicle within each office.
  const vehicleGroups = useMemo(() => {
    const m = new Map<string, { name: string; unit: string | null; year: number | null; branch: string | null; spend: number; gallons: number; count: number; mpgs: number[] }>();
    for (const r of inRange) {
      if (!m.has(r.vehicleId)) m.set(r.vehicleId, { name: r.name, unit: r.unit, year: r.year, branch: r.branch, spend: 0, gallons: 0, count: 0, mpgs: [] });
      const e = m.get(r.vehicleId)!;
      e.spend += r.amount;
      e.gallons += r.gallons ?? 0;
      e.count += 1;
      if (okMpg(r.calculatedMpg)) e.mpgs.push(r.calculatedMpg);
    }
    const rows = [...m.entries()].map(([id, e]) => ({ id, ...e, avgMpg: e.mpgs.length ? e.mpgs.reduce((s, x) => s + x, 0) / e.mpgs.length : null }));
    const byYear = (a: typeof rows[number], b: typeof rows[number]) =>
      (a.year ?? Infinity) - (b.year ?? Infinity) || (a.unit ?? "").localeCompare(b.unit ?? "", undefined, { numeric: true });
    const groups: { key: string; label: string; items: typeof rows }[] = BRANCHES
      .map((b) => ({ key: b.key as string, label: b.label as string, items: rows.filter((r) => r.branch === b.key).sort(byYear) }))
      .filter((g) => g.items.length > 0);
    const other = rows.filter((r) => !BRANCHES.some((b) => b.key === r.branch)).sort(byYear);
    if (other.length) groups.push({ key: "none", label: "Unassigned", items: other });
    return groups;
  }, [inRange]);

  const maxMonth = Math.max(1, ...months.map((m) => m.spend));

  return (
    <>
      <div className="mb-4">
        <RangeToggle
          mode={mode} onMode={setMode}
          customStart={customStart} customEnd={customEnd}
          onCustomStart={setCustomStart} onCustomEnd={setCustomEnd}
          start={start} end={end}
        />
      </div>

      <div className="grid gap-3 grid-cols-2 lg:grid-cols-4 mb-5">
        <Tile label="Fuel spend" value={money(totals.spend)} />
        <Tile label="Gallons" value={totals.gallons.toLocaleString(undefined, { maximumFractionDigits: 0 })} />
        <Tile label="Avg $/gal" value={totals.avgCpg ? `$${totals.avgCpg.toFixed(2)}` : "—"} />
        <Tile label="Vehicles fueled" value={String(totals.vehicleCount)} />
      </div>

      {months.length > 1 ? (
        <Card className="p-4 mb-5">
          <div className="text-sm font-medium text-ink mb-3">Spend by statement month <span className="text-xs font-normal text-muted">· full history</span></div>
          <div className="space-y-1.5">
            {months.map((m) => (
              <div key={m.month} className="flex items-center gap-3">
                <div className="w-12 shrink-0 text-xs text-muted tabular-nums">{MONTH_LABEL(m.month)}</div>
                <div className="flex-1 h-5 rounded bg-black/[0.04] overflow-hidden">
                  <div className="h-full bg-emerald-grad rounded" style={{ width: `${(m.spend / maxMonth) * 100}%` }} />
                </div>
                <div className="w-20 shrink-0 text-right text-xs tabular-nums text-ink">{money(m.spend)}</div>
              </div>
            ))}
          </div>
          {(fees !== 0 || rebates !== 0) ? (
            <div className="mt-3 pt-3 border-t border-line text-xs text-muted flex flex-wrap gap-4">
              {fees !== 0 ? <span>Card subscription fees: <span className="text-ink">{money(fees)}</span></span> : null}
              {rebates !== 0 ? <span>Rebates &amp; credits: <span className="text-brand-700">{money(rebates)}</span></span> : null}
              <span className="text-muted/70">(account-level — not tied to a vehicle)</span>
            </div>
          ) : null}
        </Card>
      ) : null}

      <Card className="p-0 overflow-hidden">
        <div className="px-4 py-3 border-b border-line flex items-center justify-between">
          <div className="text-sm font-medium text-ink">Spend by vehicle</div>
          <span className="text-xs text-muted">{inRange.length} purchase{inRange.length === 1 ? "" : "s"} in range</span>
        </div>
        {vehicleGroups.length === 0 ? (
          <p className="px-4 py-8 text-center text-sm text-muted">No fuel purchases in this range.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-muted border-b border-line">
                  <th className="px-4 py-2 font-medium">Vehicle</th>
                  <th className="px-3 py-2 font-medium text-right">Fills</th>
                  <th className="px-3 py-2 font-medium text-right">Gallons</th>
                  <th className="px-3 py-2 font-medium text-right">Avg MPG</th>
                  <th className="px-3 py-2 font-medium text-right">Spend</th>
                </tr>
              </thead>
              <tbody>
                {vehicleGroups.map((g) => {
                  const groupSpend = g.items.reduce((s, v) => s + v.spend, 0);
                  return (
                    <Fragment key={g.key}>
                      <tr>
                        <td colSpan={4} className="bg-black/[0.03] px-4 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted">{g.label} · {g.items.length}</td>
                        <td className="bg-black/[0.03] px-3 py-1.5 text-right text-[11px] font-semibold tabular-nums text-muted">{money(groupSpend)}</td>
                      </tr>
                      {g.items.map((v) => (
                        <tr key={v.id} className="border-b border-line last:border-0">
                          <td className="px-4 py-2">
                            <Link href={`/fleet/${v.id}`} className="font-medium text-brand-700 hover:underline">
                              {v.unit ? `${v.unit} · ` : ""}{v.name}
                            </Link>
                          </td>
                          <td className="px-3 py-2 text-right tabular-nums">{v.count}</td>
                          <td className="px-3 py-2 text-right tabular-nums">{v.gallons.toLocaleString(undefined, { maximumFractionDigits: 0 })}</td>
                          <td className="px-3 py-2 text-right tabular-nums">{v.avgMpg ? v.avgMpg.toFixed(1) : "—"}</td>
                          <td className="px-3 py-2 text-right tabular-nums font-medium">{money(v.spend)}</td>
                        </tr>
                      ))}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </>
  );
}

function Tile({ label, value }: { label: string; value: string }) {
  return (
    <Card className="p-4">
      <div className="text-xs uppercase tracking-wider text-muted">{label}</div>
      <div className="mt-1 text-2xl font-light tabular-nums">{value}</div>
    </Card>
  );
}
