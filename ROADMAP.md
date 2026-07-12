# Clements Command & Control — Platform Roadmap

**Vision:** one platform, multiple **centers**. Each center is a mode in the nav
(today: Inventory ↔ Management), sharing one design system, auth, and data
pipelines. The goal is a single place for operations, finance, and people —
not seven separate tools.

## Architecture principles (already in place)

- **Center switcher** in the app shell — add a center by adding a nav group + pages.
- **Shared UI**: `Card`, `PageHeader`, the chart module (`components/charts.tsx`),
  budget-vs-actual variance coloring, company↔branch drill-down, month/YTD toggle.
- **Two ingestion patterns**, reused per domain:
  1. **Structured import** — CSV/xlsx upload (products, employees, KPIs).
  2. **AI document extraction** — upload a PDF, Claude reads it, you confirm
     (invoices, Monthly Board Report). Behind `ANTHROPIC_API_KEY`, JSON fallback.
- **Role-gated** access; per-branch scoping; **manager compensation never shown**.
- Every monthly artifact is stored as its own period, so history is preserved.

## The seven centers

| Center | Status | Reuses | New data / integration | Phase |
|---|---|---|---|---|
| **Inventory** | ✅ Built | — | Supplier invoices (AI read), PestPac catalog | Done |
| **Financial Reporting** | 🟡 Core built (Management dashboard) | KPI engine, charts, MBR upload | CFO board financials (MBR PDF) | 1 |
| **Sales** | 🟡 Started (Sales & Attrition) | KPI engine, charts | **Sales Center** export (leads→won, campaigns, calls, conversion) | 1 |
| **Manager Performance** | ⬜ New | KPI engine, branch scoping, scorecards | Quarterly targets + bonus metrics (mostly already in KPIs) | 1 |
| **Fleet Management** | ⬜ New | Card/table UI, import, cost-vs-time charts | Vehicle records, maintenance/repair logs, mileage, fuel | 2 |
| **HR** | ⬜ New | Employee profiles (exist), import, doc storage | Onboarding steps, training, certifications/expiry (Paychex export) | 2 |
| **GPS Routing** | ⬜ New | Charts, branch/tech scoping | **Live GPS API** (Verizon Connect / Azuga / Samsara / Motive) | 3 |

## Recommended sequence

**Phase 1 — finish the reporting spine (no external integrations).**
These three all run on the KPI engine already built; they're data-ingestion, not
new plumbing — highest leverage, lowest risk.
- **Financial Reporting**: broaden the MBR extraction (balance sheet, cash flow,
  full P&L) into a shareholder/leadership view.
- **Sales**: ingest the Sales Center export — close rates, campaign performance,
  calling initiatives, conversion, acquisition source. (Needs the export format.)
- **Manager Performance**: per-manager scorecards — quarterly targets, bonus
  metrics, operational KPIs, with in-quarter progress vs. goal.

**Phase 2 — new operational centers (structured data, light/no integration).**
- **Fleet Management**: vehicle registry + maintenance/repair/cost history; charts
  for cost-per-mile over time and replacement-timing signals.
- **HR**: onboarding checklists, training/certification tracking with expiry
  alerts, richer employee profiles. Scope around Paychex (augment, don't replace
  payroll/compliance).

**Phase 3 — integration-dependent.**
- **GPS Routing**: requires a live telematics API. Biggest external dependency —
  do it once the internal centers are proven. Which GPS provider is in use
  determines the integration.

## Open inputs needed from the business

- **Sales Center**: an export sample (CSV/PDF) so we can model leads→won, campaigns, calls.
- **Fleet**: where vehicle/maintenance records live today (spreadsheet? shop invoices?).
- **HR**: what Paychex can export; which certifications/trainings must be tracked.
- **GPS**: which telematics provider (for API access).
- **Manager Performance**: the scorecard definition + bonus formula per branch.

## Cross-cutting (as the platform grows)

- Consolidated home/landing that surfaces each center's headline KPIs.
- Per-role access (e.g., a branch manager sees their branch; shareholders see finance).
- Export/share (board packet, manager packet) generated from live data.
