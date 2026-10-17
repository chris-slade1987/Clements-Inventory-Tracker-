// ===========================================================================
// Canonical Metric Registry  —  "One number, one definition, one source, one owner"
// ===========================================================================
//
// CanopyOS vision Theme 1 (Single Source of Truth). Every KPI the portal puts on
// a dashboard tile should have EXACTLY ONE entry here: a stable key, a display
// name, a plain-English definition, its real SOURCE (derived by reading the code
// that computes it — never assumed), its OWNER (the role/function accountable for
// it), and the unit/format. Where two tiles show overlapping concepts (the three
// "sales/closed" figures; the budget-vs-actual surfaces), each gets its OWN entry
// that names what makes it different and which one is canonical.
//
// This module is pure data + lookups — it imports nothing server-only (no Prisma),
// so it is safe to import from client components (e.g. the "What is this number?"
// MetricInfo popover) as well as server pages.
//
// Keep in lockstep with the computation. When a KPI's source/definition changes
// in lib/management.ts, lib/branch-pnl.ts, lib/reporting.ts, lib/sales-funnel.ts,
// lib/sales-sync.ts/workwave, lib/fuel.ts, lib/qc.ts or lib/checklists.ts, update
// the matching entry here in the SAME change (see docs/WORKFLOWS.md).
//
// ---------------------------------------------------------------------------
// PLANNED (back-pocket): Sales source migration — WorkWave Sales Center → SmarterLaunch
// ---------------------------------------------------------------------------
// Sales is transitioning OFF WorkWave Sales Center and ONTO SmarterLaunch (API) as
// the system of record. The exact cutover mechanism is not decided yet, but it will
// resolve to a point-in-time boundary: BEFORE date X → WorkWave (locked historical,
// frozen snapshot, append-only, never re-pulled or overwritten); ON/AFTER date X →
// SmarterLaunch. When that happens:
//   - `sales_center_sold` below is the entry to change: its `source` flips to
//     SmarterLaunch (or the canonical "sold" metric becomes a stitched series —
//     frozen WorkWave history + live SmarterLaunch — joined at the boundary WITHOUT
//     double-counting across it). Do it here in one place, in the same change as the
//     computation move in lib/sales-sync.ts.
//   - The Data Connections health board (lib/connections-health.ts) should then show
//     post-cutover WorkWave as "archived / read-only historical", NOT stale/error.
//   - Guardrail: be the spine, not a second CRM — don't rebuild SmarterLaunch; lock
//     history like the inventory ledger (immutable, reconcile by reversal only).
// ===========================================================================

export type MetricUnit = "usd" | "pct" | "count" | "ratio" | "days";

export type MetricDefinition = {
  /** Stable registry key. For MBR `KpiValue`-backed tiles this matches the KPI
   *  key (e.g. "new_sales", "production") so a tile can look itself up by key;
   *  the non-MBR figures use their own distinct keys. */
  key: string;
  /** Display name shown in the popover header. */
  name: string;
  /** Plain-English, one-to-two-sentence definition a manager can read. */
  definition: string;
  /** Where the number actually comes from (system / table / lib function). */
  source: string;
  /** The role or function accountable for this number. */
  owner: string;
  unit: MetricUnit;
  /** Short format hint, e.g. "$ (whole dollars)" or "percent, 1 decimal". */
  format: string;
  /** What time window the figure covers / how it's scoped. */
  window?: string;
  /** True when this is THE canonical figure for its concept (vs. an overlapping
   *  operational view of the same idea). */
  canonical?: boolean;
  /** What distinguishes this metric from other tiles that look similar. */
  distinction?: string;
  /** Other registry keys a reader is likely to confuse this with. */
  relatedKeys?: string[];
};

// ---------------------------------------------------------------------------
// The registry. Grouped by concept in comments; the exported map is flat.
// ---------------------------------------------------------------------------
const DEFINITIONS: MetricDefinition[] = [
  // === The three "sales / closed" figures (the primary ambiguity) ==========
  {
    key: "new_sales",
    name: "New Sales (MBR)",
    definition:
      "New business booked in the period, as reported in the Monthly Board Report and compared against the MBR / Branch-KPI budget. This is the booked, budget-reconciled new-business revenue line.",
    source:
      "MBR workbook `new_sales` → `KpiValue(kpiKey=\"new_sales\")`, by company/branch scope and month | ytd | cy_forecast basis (lib/management.ts → periodValues/cell; surfaced by lib/branch-pnl.ts).",
    owner: "Finance / Controller (MBR owner)",
    unit: "usd",
    format: "$ (whole dollars)",
    window: "Follows the dashboard's period + basis toggle (the selected month, or YTD).",
    canonical: true,
    distinction:
      "The official budgeted new-business number. Differs from Sales Center “sold” (annualized value of won opportunities, a different window & source) and from funnel “closed $” (per-advisor coaching figure for the current sales month).",
    relatedKeys: ["sales_center_sold", "funnel_closed"],
  },
  {
    key: "sales_center_sold",
    name: "Sales Center “sold”",
    definition:
      "Annualized value of closed-won opportunities over a trailing window (MTD / QTD / YTD) from the live Sales Center pipeline. An operational pipeline read, not reconciled to the MBR.",
    source:
      "WorkWave Sales Center (Marketing) API when `WORKWAVE_API_KEY` is set, otherwise the hourly Google-Sheet opportunity export; rolled up by `computeSalesMetrics` into a `SalesSnapshot` as the sum of won opportunities' Annual Value by close date (lib/sales-sync.ts, lib/workwave.ts).",
    owner: "Sales Operations",
    unit: "usd",
    format: "$ (whole dollars, annualized value)",
    window: "MTD / QTD / YTD by opportunity close date, as of the last sync.",
    distinction:
      "Operational won-pipeline value (annualized), windowed by close date and sourced from WorkWave/the sheet — NOT the MBR's booked new-sales revenue, and NOT the advisors' funnel closed $.",
    relatedKeys: ["new_sales", "funnel_closed"],
  },
  {
    key: "funnel_closed",
    name: "Funnel closed $",
    definition:
      "Dollars closed by the service-advisor sales team in the CURRENT sales month, logged in each advisor's funnel. This is the coaching / leaderboard figure — sales-team only, unless the grand total (which adds non-advisor “Other” sellers) is shown.",
    source:
      "Sum of `SalesPeriodStat.closedAmount` across service advisors for the current sales month (`teamFunnel().totals.closed`, lib/sales-funnel.ts). Manual entry today, SmarterLaunch-fed later; `grandClosed` additionally includes `SalesOtherEntry` (Other sellers).",
    owner: "Sales Director (advisors log it)",
    unit: "usd",
    format: "$ (whole dollars)",
    window: "The current sales month (tied to the live sales cadence, not the MBR report period).",
    distinction:
      "Per-advisor funnel closes for the current sales month — the coaching number. Not budget-reconciled, narrower than MBR New Sales, and a different source/window than Sales Center “sold.”",
    relatedKeys: ["new_sales", "sales_center_sold"],
  },

  // === Branch P&L budget-vs-actual categories ==============================
  {
    key: "production",
    name: "Production Revenue",
    definition:
      "Branch service production revenue for the period — the branch's operating top line in budget-vs-actual.",
    source:
      "MBR `production` → `KpiValue(kpiKey=\"production\")`, branch or company scope (lib/management.ts; lib/branch-pnl.ts).",
    owner: "Branch Manager / Finance",
    unit: "usd",
    format: "$ (whole dollars)",
    window: "Period + basis toggle (month | YTD | full-year forecast).",
    canonical: true,
    distinction: "The branch top line. At company scope the headline revenue is Net Revenue instead.",
    relatedKeys: ["net_revenue"],
  },
  {
    key: "net_revenue",
    name: "Net Revenue",
    definition: "Company net revenue for the period — the company-level headline top line.",
    source: "MBR `net_revenue` → `KpiValue(kpiKey=\"net_revenue\")`, company scope (lib/management.ts).",
    owner: "Finance",
    unit: "usd",
    format: "$ (whole dollars)",
    window: "Period + basis toggle (month | YTD | full-year forecast).",
    canonical: true,
    distinction: "Company top line; the branch equivalent used for budget-vs-actual is Production Revenue.",
    relatedKeys: ["production"],
  },
  {
    key: "net_after_labor",
    name: "Net after Labor",
    definition: "Production revenue less technician labor — the branch profitability line, paired with Margin %.",
    source: "MBR `net_after_labor` → `KpiValue`, branch scope; Margin % sub-line is `margin_pct` (lib/branch-pnl.ts).",
    owner: "Branch Manager / Finance",
    unit: "usd",
    format: "$ (whole dollars)",
    window: "Period + basis toggle.",
    relatedKeys: ["margin_pct", "route_contrib"],
  },
  {
    key: "margin_pct",
    name: "Margin %",
    definition: "Net-after-labor as a percentage of production (the MBR's Net-after-Labor margin definition).",
    source: "MBR `margin_pct` → `KpiValue` (lib/branch-pnl.ts).",
    owner: "Branch Manager / Finance",
    unit: "pct",
    format: "percent, 1 decimal",
    relatedKeys: ["net_after_labor"],
  },
  {
    key: "route_contrib",
    name: "Route Contribution",
    definition:
      "Revenue less direct route costs (technician wages, fuel, chemical, vehicle R&M and a reconciling “other route costs” bucket). It never isolates manager compensation.",
    source: "MBR `route_contrib` → `KpiValue` (lib/management.ts; waterfall built in app/(app)/executive/page.tsx).",
    owner: "Branch Manager / Finance",
    unit: "usd",
    format: "$ (whole dollars)",
    relatedKeys: ["route_contrib_pct", "net_after_labor"],
  },
  {
    key: "route_contrib_pct",
    name: "Route Contribution %",
    definition: "Route contribution as a percentage of revenue.",
    source: "MBR `route_contrib_pct` → `KpiValue` (lib/management.ts).",
    owner: "Branch Manager / Finance",
    unit: "pct",
    format: "percent, 1 decimal",
    relatedKeys: ["route_contrib"],
  },
  {
    key: "tech_wages",
    name: "Technician Wages",
    definition: "Technician labor cost for the period. Lower-is-better; also shown as a % of branch revenue.",
    source: "MBR `tech_wages` → `KpiValue`, branch scope (lib/branch-pnl.ts).",
    owner: "Branch Manager / Payroll",
    unit: "usd",
    format: "$ (whole dollars); % of revenue shown alongside",
    relatedKeys: ["production"],
  },
  {
    key: "fuel",
    name: "Fuel",
    definition:
      "Fleet fuel spend for the period. Lower-is-better; shown as a % of revenue. For a branch this is REAL card spend, not a model line.",
    source:
      "Branch view: actual Coast-card `FuelTransaction` rows summed via each vehicle's branch for the MBR YTD window (`fuelByBranch`, lib/fuel.ts), with the company fuel budget allocated to the branch by its production share. Falls back to the company MBR `fuel` line when a branch has no fuel loaded. Company view uses the MBR `fuel` line.",
    owner: "Fleet / Finance",
    unit: "usd",
    format: "$ (whole dollars); % of revenue shown alongside",
    distinction:
      "Branch fuel is actual Coast transactions (budget is the allocated company fuel budget); the company figure is the MBR fuel line.",
    relatedKeys: ["chemical_expense", "tech_wages"],
  },
  {
    key: "chemical_expense",
    name: "Chemical Expense",
    definition:
      "Chemical cost for the period. Lower-is-better; shown as a % of revenue. Ties to inventory purchases.",
    source:
      "MBR `chemical_expense` → `KpiValue`, company scope. No branch split exists in the model, so it is shown tagged “company-wide” at branch scope (lib/branch-pnl.ts).",
    owner: "Finance / Inventory",
    unit: "usd",
    format: "$ (whole dollars); % of revenue shown alongside",
    distinction: "Company-wide model line (no branch split). Relates to — but is not — inventory on-hand value / spend.",
    relatedKeys: ["on_hand_value", "fuel"],
  },
  {
    key: "ebitda",
    name: "EBITDA",
    definition: "Adjusted EBITDA per the MBR reconciliation (including add-backs).",
    source: "MBR `ebitda` → `KpiValue`, company scope; margin is `ebitda_pct` (lib/management.ts; app/(app)/management/board/page.tsx).",
    owner: "Finance",
    unit: "usd",
    format: "$ (whole dollars)",
    relatedKeys: ["ebitda_pct"],
  },
  {
    key: "ebitda_pct",
    name: "EBITDA %",
    definition: "EBITDA as a percentage of net revenue (EBITDA margin).",
    source: "MBR `ebitda_pct` → `KpiValue`, company scope (lib/management.ts).",
    owner: "Finance",
    unit: "pct",
    format: "percent, 1 decimal",
    relatedKeys: ["ebitda"],
  },
  {
    key: "sga",
    name: "SG&A",
    definition:
      "Selling, general & administrative overhead for the period. Lower-is-better; shown as a % of revenue. Overhead compensation appears only as aggregate buckets — no individual or manager compensation line.",
    source: "MBR `sga` → `KpiValue`, company scope (lib/management.ts; detail in app/(app)/management/board/page.tsx).",
    owner: "Finance",
    unit: "usd",
    format: "$ (whole dollars); % of revenue shown alongside",
  },
  {
    key: "stops",
    name: "Stops Completed",
    definition: "Count of service stops completed in the period.",
    source: "MBR `stops` → `KpiValue`, branch scope (lib/branch-pnl.ts).",
    owner: "Branch Manager",
    unit: "count",
    format: "whole count",
  },

  // === Book / attrition ====================================================
  {
    key: "attrition",
    name: "Cancellations",
    definition: "Dollar value of recurring business cancelled (book lost) in the period. Lower-is-better.",
    source: "MBR `attrition` → `KpiValue`, branch/company scope (lib/management.ts; lib/branch-pnl.ts).",
    owner: "Branch Manager / Finance",
    unit: "usd",
    format: "$ (whole dollars)",
    distinction: "The dollars of book lost — not the attrition RATE (that is a percentage of the book).",
    relatedKeys: ["attrition_rate", "book_value"],
  },
  {
    key: "attrition_rate",
    name: "Attrition Rate",
    definition:
      "On a month basis: cancellations as a percentage of the forward recurring book (best-in-class is under 1% / month). On YTD: the cumulative cancellations rate (the monthly benchmark isn't applied).",
    source: "MBR `attrition_rate` → `KpiValue` (lib/management.ts).",
    owner: "Finance / Branch Manager",
    unit: "pct",
    format: "percent, 2 decimals",
    distinction: "A rate (% of book). The dollar figure is Cancellations.",
    relatedKeys: ["attrition", "book_value"],
  },
  {
    key: "book_value",
    name: "Book Value",
    definition:
      "The forward recurring book — annualized recurring revenue on the books. The forward 12-month projection compounds this at the trailing-average month-over-month growth rate (an estimate, labeled as such).",
    source: "MBR `book_value` → `KpiValue`; the forward projection is `bookForecast()` in lib/management.ts (read-only).",
    owner: "Finance",
    unit: "usd",
    format: "$ (whole dollars)",
    relatedKeys: ["attrition", "attrition_rate"],
  },

  // === Inventory (the ledger-integrity crown jewel) ========================
  {
    key: "on_hand_qty",
    name: "On-hand (units)",
    definition:
      "Current stock on hand for a product in a warehouse = the SUM of all its stock movements (check-in +, check-out −, adjustment ±). Never edited directly; corrected only with reversals and adjustments so the audit trail stays intact.",
    source: "`SUM(StockMovement.quantity)` grouped by product/warehouse (lib/reporting.ts; the ledger rule lives in lib/inventory.ts).",
    owner: "Warehouse / Inventory manager",
    unit: "count",
    format: "units (product's unit of measure)",
    canonical: true,
    distinction: "The authoritative quantity. On-hand inventory VALUE is this quantity priced at latest cost — an estimate.",
    relatedKeys: ["on_hand_value"],
  },
  {
    key: "on_hand_value",
    name: "On-hand inventory value",
    definition:
      "On-hand units valued at the latest known unit cost (the most recent priced movement). A valuation estimate, not a general-ledger figure.",
    source:
      "On-hand units (`SUM(StockMovement.quantity)`) × latest cost per product (`onHandValueByWarehouse` / `onHandValueByCategory` with `productCostMap`, lib/reporting.ts).",
    owner: "Warehouse / Inventory manager",
    unit: "usd",
    format: "$ (whole dollars, est. at latest cost)",
    distinction: "A valuation estimate (latest cost), not a GL number. The authoritative figure is On-hand (units).",
    relatedKeys: ["on_hand_qty", "chemical_expense"],
  },

  // === Field quality & oversight ===========================================
  {
    key: "qc_pass_rate",
    name: "QC pass rate",
    definition:
      "Share of graded ride-behind QC checklist items marked “pass” across completed inspections (General Household Pest + Lawn & Ornamental). Measures field work quality.",
    source: "Graded items on completed `QcInspection` records (lib/qc.ts); goal is 10 of each form per branch per month, feeding the quarterly scorecard.",
    owner: "Branch Manager / Director of Field Ops",
    unit: "pct",
    format: "percent",
    window: "Per branch, per period (monthly goal: 20 inspections).",
    distinction: "Field work quality (did the treatment pass) — distinct from Checklist compliance (did the oversight checklist get signed).",
    relatedKeys: ["checklist_compliance"],
  },
  {
    key: "checklist_compliance",
    name: "Checklist compliance",
    definition:
      "Share of required recurring manager oversight checklists signed on time for a branch and period — an append-only, attested completion.",
    source: "Signed `ChecklistCompletion` vs. the due cadence per branch/period (lib/checklists.ts).",
    owner: "Branch Manager",
    unit: "pct",
    format: "percent",
    window: "Per branch, per cadence period (weekly / monthly).",
    distinction: "Measures that the oversight checklist was completed & signed — not field work quality (that is QC pass rate).",
    relatedKeys: ["qc_pass_rate"],
  },
];

// ---------------------------------------------------------------------------
// Lookups
// ---------------------------------------------------------------------------
export const METRIC_REGISTRY: ReadonlyMap<string, MetricDefinition> = new Map(
  DEFINITIONS.map((d) => [d.key, d]),
);

/** The canonical definition for a key, or null if the key isn't registered. */
export function getMetric(key: string | null | undefined): MetricDefinition | null {
  if (!key) return null;
  return METRIC_REGISTRY.get(key) ?? null;
}

/** Whether a metric key has a registry entry (cheap guard before rendering the affordance). */
export function hasMetric(key: string | null | undefined): boolean {
  return !!key && METRIC_REGISTRY.has(key);
}

/** All definitions (stable order), e.g. for a future registry index screen. */
export function allMetrics(): MetricDefinition[] {
  return [...DEFINITIONS];
}

/** Short human label for a unit (used by the popover's format row). */
export function unitLabel(unit: MetricUnit): string {
  switch (unit) {
    case "usd": return "US dollars";
    case "pct": return "percentage";
    case "count": return "count";
    case "ratio": return "ratio";
    case "days": return "days";
  }
}
