import { Fragment } from "react";
import Link from "next/link";
import { Card, PageHeader } from "@/components/ui";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import {
  allTechniciansByUsage,
  onHandValueByCategory,
  productCostMap,
  productLedgerByDivision,
  purchasedDollarsByWarehouse,
  spendByCategory,
  topProductsBySpend,
  type DivisionLedger,
  type Ranked,
} from "@/lib/reporting";
import { computeReorderFindings, type ReorderFinding } from "@/lib/reorder";
import { currentPeriods, monthlyBudgetFor } from "@/lib/budgets";
import { DIVISION_LABELS, divisionLabel } from "@/lib/constants";
import { money, qty } from "@/lib/format";

export const dynamic = "force-dynamic";

// Date-range toggle for the time-bounded analytics (spend / purchasing volume /
// purchasing pattern). Current on-hand is a point-in-time snapshot and is NEVER
// scoped by this range.
const RANGES = [
  { key: "30d", label: "Last 30 days" },
  { key: "month", label: "This month" },
  { key: "quarter", label: "This quarter" },
  { key: "ytd", label: "YTD" },
] as const;
type RangeKey = (typeof RANGES)[number]["key"];

function rangeStartFor(key: RangeKey, now: Date): Date {
  if (key === "30d") return new Date(now.getTime() - 30 * 864e5);
  if (key === "quarter") return new Date(now.getFullYear(), Math.floor(now.getMonth() / 3) * 3, 1);
  if (key === "ytd") return new Date(now.getFullYear(), 0, 1);
  return new Date(now.getFullYear(), now.getMonth(), 1); // "month"
}

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const user = await requireUser();
  const sp = await searchParams;
  const now = new Date();
  const p = currentPeriods(now);

  // Selected time range for the date-bounded analytics (default "month").
  const range: RangeKey = (RANGES.find((r) => r.key === sp.range)?.key ?? "month") as RangeKey;
  const rangeStart = rangeStartFor(range, now);
  const rangeLabel = RANGES.find((r) => r.key === range)!.label;

  const warehouses = await prisma.warehouse.findMany({
    where: { active: true },
    orderBy: { name: "asc" },
  });
  const selected = warehouses.find((w) => w.id === sp.branch) ?? null;
  const scopeId = selected?.id; // undefined = all branches
  const cost = await productCostMap();

  // Confirm-queue nudge (admins + HR only — they can act on it).
  const canConfirm = user.role === "admin" || user.hrAccess;
  const toConfirm = canConfirm
    ? await prisma.product.count({ where: { confirmed: false, active: true } })
    : 0;

  const [mtd, ytd, catSpend, topProducts, allTechs, ohByCat, ledger, openAlerts, allLowStock] =
    await Promise.all([
      // Branch budget tiles compare against the MONTHLY budget, so these stay
      // month-/year-to-date regardless of the range toggle.
      purchasedDollarsByWarehouse(p.monthStart),
      purchasedDollarsByWarehouse(p.yearStart),
      // Date-bounded analytics — scoped to the selected range window.
      spendByCategory(rangeStart, now, scopeId),
      topProductsBySpend(rangeStart, now, 8, scopeId),
      // Every technician with usage in scope (no top-N cap).
      allTechniciansByUsage(rangeStart, now, cost, scopeId),
      onHandValueByCategory(cost, scopeId),
      // Consolidated line-of-service → subcategory → product ledger. On-hand is a
      // point-in-time snapshot; purchased/dispersed are scoped to the range window.
      productLedgerByDivision(rangeStart, now, scopeId),
      prisma.alert.findMany({
        where: { status: "open" },
        orderBy: { createdAt: "desc" },
        include: { product: { select: { name: true } } },
        take: 6,
      }),
      // Low-stock / reorder-due, computed from movement history (run-rate + cadence).
      computeReorderFindings(),
    ]);

  // Scope the low-stock list to the selected branch's warehouse (if any).
  const lowStock = scopeId ? allLowStock.filter((f) => f.warehouseId === scopeId) : allLowStock;

  const companyMtd = [...mtd.values()].reduce((s, v) => s + v, 0);
  const companyBudget = warehouses.reduce((s, w) => s + monthlyBudgetFor(w.name), 0);
  const scopeOnHandValue = ohByCat.reduce((s, r) => s + r.value, 0);
  const scopeSpend = scopeId ? mtd.get(scopeId) ?? 0 : companyMtd;
  const scopeName = selected ? selected.name.replace(" (HQ)", "") : "All branches";

  // Build a /dashboard href preserving branch + range unless overridden. `branch`
  // null clears the branch scope; range "month" is the default so it's omitted.
  const hrefWith = (opts: { branch?: string | null; range?: RangeKey }) => {
    const branch = opts.branch === undefined ? scopeId ?? null : opts.branch;
    const r = opts.range ?? range;
    const params = new URLSearchParams();
    if (branch) params.set("branch", branch);
    if (r && r !== "month") params.set("range", r);
    const s = params.toString();
    return s ? `/dashboard?${s}` : "/dashboard";
  };

  return (
    <>
      <PageHeader title="Dashboard" subtitle={`This month at a glance · ${p.monthLabel}`} />

      {toConfirm > 0 ? (
        <Link href="/manage/confirm" className="block mb-4">
          <Card className="p-3 flex items-center gap-3 hover:ring-1 hover:ring-amber-300">
            <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-700">{toConfirm}</span>
            <span className="text-sm text-ink">
              product{toConfirm === 1 ? "" : "s"} to confirm before they can be checked out
            </span>
            <span className="ml-auto text-xs font-medium text-brand-300">Review →</span>
          </Card>
        </Link>
      ) : null}

      {/* Selector: company banner + branch cards. Click to scope the detail below. */}
      <Link href={hrefWith({ branch: null })} className="block mb-4">
        <Card className={`p-4 transition ${!selected ? "ring-2 ring-brand-500" : "hover:ring-1 hover:ring-brand-300"}`}>
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <div className="text-xs uppercase tracking-wider text-muted">
                All branches · spent this month
              </div>
              <div className="mt-1 text-3xl font-light tabular-nums">{money(companyMtd)}</div>
            </div>
            <div className="text-right">
              <div className="text-xs uppercase tracking-wider text-muted">
                Monthly budget{" "}
                <span className="ml-1 rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-700">placeholder</span>
              </div>
              <div className="mt-1 text-xl font-light tabular-nums text-muted">{money(companyBudget)}</div>
            </div>
          </div>
          <BudgetBar spent={companyMtd} budget={companyBudget} />
        </Card>
      </Link>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4 mb-5">
        {warehouses.map((w) => {
          const budget = monthlyBudgetFor(w.name);
          const spent = mtd.get(w.id) ?? 0;
          const isSel = selected?.id === w.id;
          return (
            <Link key={w.id} href={isSel ? hrefWith({ branch: null }) : hrefWith({ branch: w.id })} className="block">
              <Card className={`p-4 overflow-hidden transition ${isSel ? "ring-2 ring-brand-500" : "hover:ring-1 hover:ring-brand-300"}`}>
                <div className="h-1 -mx-4 -mt-4 mb-3 bg-emerald-grad" />
                <div className="text-xs font-medium uppercase tracking-wider text-muted">{w.name}</div>
                <div className="mt-2 text-2xl font-light tabular-nums">{money(spent)}</div>
                <BudgetBar spent={spent} budget={budget} />
                <div className="mt-3 flex justify-between text-xs">
                  <span className="text-muted">YTD</span>
                  <span className="tabular-nums">
                    {money(ytd.get(w.id) ?? 0)} <span className="text-muted">/ {money(budget * p.monthIndex)}</span>
                  </span>
                </div>
              </Card>
            </Link>
          );
        })}
      </div>

      {/* Scope indicator */}
      <div className="flex items-center justify-between mb-3">
        <h2 className="flex items-center gap-2 text-sm font-medium text-white">
          <span className="inline-block h-4 w-1 rounded bg-emerald-grad" />
          {scopeName}
          <span className="text-mint font-light">· {money(scopeSpend)} spent (mo) · {money(scopeOnHandValue)} on hand</span>
        </h2>
        {selected ? (
          <Link href={hrefWith({ branch: null })} className="text-xs font-medium text-brand-300 hover:underline">
            ← Show all branches
          </Link>
        ) : null}
      </div>

      {/* Time-range toggle — scopes the spend / purchasing panels below. On-hand
          panels stay "Current" regardless. */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <span className="text-[11px] uppercase tracking-wider text-muted">Spend range</span>
        <div className="flex flex-wrap gap-1 rounded-xl bg-black/20 p-1">
          {RANGES.map((r) => {
            const active = r.key === range;
            return (
              <Link
                key={r.key}
                href={hrefWith({ range: r.key })}
                className={`rounded-lg px-2.5 py-1 text-xs font-medium transition-colors ${
                  active ? "bg-emerald-grad text-[#05271c] shadow-sm" : "text-mint hover:bg-white/5 hover:text-white"
                }`}
              >
                {r.label}
              </Link>
            );
          })}
        </div>
      </div>

      {/* Reorder / low stock — driven by run-rate + purchasing cadence learned
          from the movement ledger. Scoped to the selected branch. */}
      <Card className="p-0 overflow-hidden mb-4">
        <div className="px-4 py-3 border-b border-line flex items-center justify-between">
          <PanelTitle>Reorder / low stock</PanelTitle>
          <div className="flex items-center gap-3">
            {lowStock.length > 0 ? (
              <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-700">
                {lowStock.length} to reorder
              </span>
            ) : null}
            <Link href="/alerts" className="text-xs font-medium text-brand-700 hover:underline">View alerts</Link>
          </div>
        </div>
        {lowStock.length === 0 ? (
          <Empty>Nothing running low for this scope — cover looks healthy.</Empty>
        ) : (
          <ul className="divide-y divide-line max-h-96 overflow-y-auto">
            {lowStock.slice(0, 12).map((f) => (
              <LowStockRow key={`${f.productId}:${f.warehouseId}`} f={f} showBranch={!selected} />
            ))}
          </ul>
        )}
      </Card>

      {/* One detail section, scoped to the selection */}
      <div className="grid gap-4 lg:grid-cols-2">
        {/* Consolidated ledger: line of service → subcategory → product, showing
            purchased & dispersed for the range window and current on-hand. This
            single table replaces the former LOS tiles, on-hand matrix, and
            product-movement panels. */}
        <Card className="p-0 overflow-hidden lg:col-span-2">
          <div className="px-4 py-3 border-b border-line flex items-center justify-between gap-2 flex-wrap">
            <PanelTitle>On-hand by line of service{selected ? ` · ${scopeName}` : ""}</PanelTitle>
            <span className="text-[11px] text-muted">
              On hand: current · Purchased/Dispersed: {rangeLabel}
            </span>
          </div>
          <LineOfServiceLedger rows={ledger} />
        </Card>

        <Card className="p-4">
          <PanelTitle>Top spend by category · {rangeLabel}</PanelTitle>
          <RankBars rows={catSpend} empty={`No purchases recorded for ${rangeLabel.toLowerCase()} yet.`} />
        </Card>
        <Card className="p-0 overflow-hidden">
          <div className="px-4 py-3 border-b border-line"><PanelTitle>Top products by spend · {rangeLabel}</PanelTitle></div>
          {topProducts.length === 0 ? <Empty>No purchases recorded for {rangeLabel.toLowerCase()} yet.</Empty> : <RankTable rows={topProducts} col="Cost" />}
        </Card>

        <Card className="p-0 overflow-hidden">
          <div className="px-4 py-3 border-b border-line flex items-center justify-between gap-2 flex-wrap">
            <PanelTitle>Technician spend · {scopeName} · {rangeLabel}</PanelTitle>
            {allTechs.length === 0 ? (
              <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-700">no check-outs yet</span>
            ) : (
              <span className="text-[11px] text-muted">{allTechs.length} tech{allTechs.length === 1 ? "" : "s"}</span>
            )}
          </div>
          {allTechs.length === 0 ? (
            <Empty>Dispersal populates as check-outs are recorded.</Empty>
          ) : (
            <div className="overflow-x-auto max-h-80 overflow-y-auto">
              <table className="w-full text-sm">
                <thead className="sticky top-0 z-10 bg-surface">
                  <tr className="text-left text-xs text-muted border-b border-line">
                    <th className="px-4 py-2 font-medium">Technician</th>
                    <th className="px-3 py-2 font-medium">Branch</th>
                    <th className="px-3 py-2 font-medium text-right">Items</th>
                    <th className="px-4 py-2 font-medium text-right">Value</th>
                  </tr>
                </thead>
                <tbody>
                  {allTechs.map((t) => (
                    <tr key={t.name + t.branch} className="border-b border-line last:border-0">
                      <td className="px-4 py-2">{t.name}</td>
                      <td className="px-3 py-2 text-muted">{t.branch.replace(" (HQ)", "")}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{qty(t.units)}</td>
                      <td className="px-4 py-2 text-right tabular-nums font-medium">{money(t.value)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        <Card className="p-0 overflow-hidden">
          <div className="px-4 py-3 border-b border-line flex items-center justify-between">
            <PanelTitle>Open alerts</PanelTitle>
            <Link href="/alerts" className="text-xs font-medium text-brand-700 hover:underline">View all</Link>
          </div>
          {openAlerts.length === 0 ? (
            <Empty>No open alerts.</Empty>
          ) : (
            <ul className="divide-y divide-line">
              {openAlerts.map((a) => (
                <li key={a.id} className="px-4 py-3 flex items-start gap-3">
                  <SeverityDot severity={a.severity} />
                  <div className="min-w-0">
                    <div className="text-sm">{a.message}</div>
                    <div className="text-xs text-muted">{a.type.replace(/_/g, " ")}{a.product ? ` · ${a.product.name}` : ""}</div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </>
  );
}

function PanelTitle({ children }: { children: React.ReactNode }) {
  return <h3 className="text-sm font-medium text-ink">{children}</h3>;
}
function Empty({ children }: { children: React.ReactNode }) {
  return <p className="px-4 py-8 text-center text-sm text-muted">{children}</p>;
}

// Color accent per line of service — a continuous left rail + tinted band ties
// every product visually to its category so you never lose your place. Full
// literal class strings (Tailwind scans source). Unknown codes fall back to slate.
const DIV_ACCENT: Record<string, { band: string; rail: string; dot: string; text: string }> = {
  GHP: { band: "bg-sky-50", rail: "border-l-sky-400", dot: "bg-sky-500", text: "text-sky-900" },
  LO: { band: "bg-emerald-50", rail: "border-l-emerald-400", dot: "bg-emerald-500", text: "text-emerald-900" },
  TERMITE: { band: "bg-amber-50", rail: "border-l-amber-400", dot: "bg-amber-500", text: "text-amber-900" },
  RODENT: { band: "bg-violet-50", rail: "border-l-violet-400", dot: "bg-violet-500", text: "text-violet-900" },
  MOSQUITO: { band: "bg-cyan-50", rail: "border-l-cyan-400", dot: "bg-cyan-500", text: "text-cyan-900" },
  OTHER: { band: "bg-slate-50", rail: "border-l-slate-400", dot: "bg-slate-400", text: "text-slate-800" },
  UNCLASSIFIED: { band: "bg-slate-50", rail: "border-l-slate-300", dot: "bg-slate-300", text: "text-slate-700" },
};
const accentFor = (code: string) => DIV_ACCENT[code] ?? DIV_ACCENT.UNCLASSIFIED;

// Consolidated line-of-service ledger. One scrolling table with strong visual
// grouping: each division gets a color-coded, STICKY header band + a continuous
// colored left rail down all its rows; each subcategory is a bold labeled group
// header; then per-product rows. On-hand is current; purchased/dispersed are the
// range window. Iterates the helper's order (DIVISIONS, unclassified trailing).
function LineOfServiceLedger({ rows }: { rows: DivisionLedger[] }) {
  if (rows.length === 0) return <Empty>No stock on hand or movement for this scope yet.</Empty>;

  const label = (code: string) =>
    code === "UNCLASSIFIED" ? "Unclassified" : (DIVISION_LABELS as Record<string, string>)[code] ?? divisionLabel(code);
  const num = (n: number) => (Math.abs(n) < 1e-6 ? <span className="text-muted/40">—</span> : qty(n));

  return (
    <div className="overflow-x-auto max-h-[42rem] overflow-y-auto">
      <table className="w-full border-separate border-spacing-0 text-sm">
        <thead className="sticky top-0 z-20 bg-surface">
          <tr className="text-left text-xs text-muted">
            <th className="border-b border-line px-4 py-2 font-medium">Product</th>
            <th className="border-b border-line px-3 py-2 font-medium text-right whitespace-nowrap">Purchased</th>
            <th className="border-b border-line px-3 py-2 font-medium text-right whitespace-nowrap">Dispersed</th>
            <th className="border-b border-line px-4 py-2 font-medium text-right whitespace-nowrap">On hand</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((d) => {
            const a = accentFor(d.division);
            return (
              <Fragment key={d.division}>
                {/* Division band — sticky under the column header so you always
                    see which line of service you're scrolling through. No totals:
                    summing units across different pack sizes/UoMs isn't meaningful. */}
                <tr className={`sticky top-[37px] z-10 ${a.band}`}>
                  <td colSpan={4} className={`border-y border-line border-l-4 ${a.rail} px-4 py-2.5`}>
                    <span className="flex items-center gap-2">
                      <span className={`inline-block h-2.5 w-2.5 rounded-full ${a.dot}`} />
                      <span className={`text-[13px] font-bold uppercase tracking-wide ${a.text}`}>{label(d.division)}</span>
                      <span className="rounded-full bg-white/70 px-1.5 py-0.5 text-[10px] font-medium text-muted">
                        {d.productCount} product{d.productCount === 1 ? "" : "s"}
                      </span>
                    </span>
                  </td>
                </tr>
                {d.subdivisions.map((s) => (
                  <Fragment key={`${d.division}:${s.subdivision}`}>
                    {/* Subcategory group header — a clear labeled band, not micro-text. No totals. */}
                    <tr className="bg-black/[0.035]">
                      <td colSpan={4} className={`border-b border-line border-l-4 ${a.rail} py-1.5 pl-5 pr-4`}>
                        <span className="flex items-center gap-2">
                          <span className={`inline-block h-1.5 w-1.5 rounded-sm ${a.dot}`} />
                          <span className="text-[11px] font-semibold uppercase tracking-wider text-ink">{s.subdivision}</span>
                          <span className="text-[10px] font-normal text-muted">{s.products.length} product{s.products.length === 1 ? "" : "s"}</span>
                        </span>
                      </td>
                    </tr>
                    {s.products.map((prod) => (
                      <tr key={prod.productId} className="hover:bg-black/[0.02]">
                        <td className={`border-b border-line border-l-4 ${a.rail} py-2 pl-8 pr-4`}>
                          <span className="block text-ink">{prod.name}</span>
                          {prod.unit ? <span className="block text-[11px] text-muted">{prod.unit}</span> : null}
                        </td>
                        <td className="border-b border-line px-3 py-2 text-right tabular-nums">{num(prod.purchased)}</td>
                        <td className="border-b border-line px-3 py-2 text-right tabular-nums">{num(prod.dispersed)}</td>
                        <td className="border-b border-line px-4 py-2 text-right tabular-nums font-medium">{num(prod.onHand)}</td>
                      </tr>
                    ))}
                  </Fragment>
                ))}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function BudgetBar({ spent, budget }: { spent: number; budget: number }) {
  const pct = budget > 0 ? Math.min(100, (spent / budget) * 100) : 0;
  const over = spent > budget && budget > 0;
  const remaining = budget - spent;
  return (
    <div className="mt-2">
      <div className="h-2 rounded-full bg-slate-200 overflow-hidden">
        <div className={`h-full rounded-full ${over ? "bg-amber-500" : "bg-emerald-grad"}`} style={{ width: `${pct}%` }} />
      </div>
      <div className="mt-1 flex justify-between text-[11px] text-muted tabular-nums">
        <span>{Math.round(pct)}% of budget</span>
        <span className={over ? "text-amber-600 font-medium" : "text-emerald-700"}>
          {over ? `${money(-remaining)} over` : `${money(remaining)} left`}
        </span>
      </div>
    </div>
  );
}

function RankBars({ rows, empty }: { rows: Ranked[]; empty: string }) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  if (rows.length === 0) return <p className="py-6 text-center text-sm text-muted">{empty}</p>;
  return (
    <div className="mt-3 space-y-2.5">
      {rows.map((r) => (
        <div key={r.key} className="flex items-center gap-3">
          <div className="w-28 shrink-0 text-sm truncate">{r.label}</div>
          <div className="flex-1 h-4 rounded bg-slate-100 overflow-hidden">
            <div className="h-full rounded bg-emerald-grad" style={{ width: `${Math.max(3, (r.value / max) * 100)}%` }} />
          </div>
          <div className="w-20 shrink-0 text-right text-sm font-medium tabular-nums">{money(r.value)}</div>
        </div>
      ))}
    </div>
  );
}

function RankTable({ rows, col }: { rows: Ranked[]; col: string }) {
  return (
    <div className="overflow-x-auto max-h-80 overflow-y-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-xs text-muted border-b border-line">
            <th className="px-4 py-2 font-medium">Product</th>
            <th className="px-3 py-2 font-medium text-right">Qty</th>
            <th className="px-4 py-2 font-medium text-right">{col}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.key} className="border-b border-line last:border-0">
              <td className="px-4 py-2">{r.label}</td>
              <td className="px-3 py-2 text-right tabular-nums">{qty(r.qty)}</td>
              <td className="px-4 py-2 text-right tabular-nums font-medium">{money(r.value)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// One low-stock / reorder row: product, current cover, and the learned cadence.
function LowStockRow({ f, showBranch }: { f: ReorderFinding; showBranch: boolean }) {
  const wh = f.warehouseName.replace(" (HQ)", "");
  const stockLabel = f.outOfStock
    ? "Out of stock"
    : `${qty(f.onHand)} ${f.unit} on hand · ~${Math.max(0, Math.round(f.coverDays))}d cover`;
  return (
    <li className="px-4 py-3 flex items-start gap-3">
      <SeverityDot severity={f.severity} />
      <div className="min-w-0 flex-1">
        <div className="text-sm text-ink">
          {f.productName}
          {showBranch ? <span className="ml-2 text-[11px] font-normal text-muted">{wh}</span> : null}
        </div>
        <div className="text-xs text-muted">
          {stockLabel}
          {f.regular ? ` · reorders ~every ${Math.round(f.cadenceDays)}d` : ` · ~${qty(Math.round(f.runRate30))}/30d`}
          {" · reorder "}~{qty(Math.round(f.reorderQty))} {f.unit}
        </div>
      </div>
    </li>
  );
}

function SeverityDot({ severity }: { severity: string }) {
  const color = severity === "critical" ? "bg-red-500" : severity === "warning" ? "bg-amber-500" : "bg-blue-500";
  return <span className={`mt-1 h-2.5 w-2.5 rounded-full shrink-0 ${color}`} />;
}
