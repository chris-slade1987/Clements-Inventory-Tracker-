# Monthly Board Report (MBR) ingestion runbook

How to ingest a month's financials into the CanopyOS portal, globally, the same
way every month. The MBR PDF is delivered one month in arrears (e.g. the **October
2026** board report carries **September 2026** financials). Follow these steps in
order; each month is **additive** — never hard-delete or rewrite a prior month.

Canonical schema: `lib/mbr/extract.ts` (`KPI_KEYS`, `SCOPES`, `BASES`, the
`Parsed*` types). Reference snapshot: the most recent `prisma/data/mbr-YYYY-MM.json`.

## 1. Receive the PDF
Get the monthly MBR PDF (~40+ pages). Read it in pages (the Read tool caps at 20
pages/call). Sections used: **Actual Production vs Budget** (p.3), **Revenue by
Service Code / Line of Business / Branch** (per-branch LOB), **Monthly Individual
Route Metrics** (per-tech Total Production), **New Sales by Service by Branch**,
**Attrition – By Branch**, and **Financial Summary – P&L** (Month / YTD / CY
forecast columns).

## 2. Produce `prisma/data/mbr-YYYY-MM.json`
Mirror the previous month's file **exactly** — same keys, scopes, bases, ordering,
row counts. Header: `year`, `month` (1–12, the **financial** month), `label`
(e.g. `"September 2026"`), `source: "json"`.

- **`kpis[]`** — every `KPI_KEY` × scope × basis the prior file populates (186 rows
  as of 2026-09). Per row: `actual`/`budget` with `basis`:
  - `month` = the month-end column (e.g. `9/30/2026`)
  - `ytd` = the `YTD <mm>/<dd>/<yy>` column
  - `cy_forecast` = the `Forecast CY` / `Budget CY` columns (P&L + production). For
    `new_sales`, `cy_forecast` has no clean report column — **carry the prior
    month's values** (actual `null` + the annual budget).
  - `production` maps to the **Preliminary Total** block (NOT Grand Total) per scope
    + company. P&L/revenue KPIs are company-scope from the P&L pages.
  - `new_sales` month/ytd actual = the branch Total rows (ytd = the `YYYY Total`
    column = Jan→month sum). New-sales budgets are the internal annual plan: monthly
    budget is constant; ytd budget accumulates (prior ytd + monthly). These are
    re-asserted from the June MBR by deploy-db and are guarded, so exact-match the
    prior-month convention.
  - `attrition`/`attrition_rate` from the Attrition "Total" + rate rows (ytd should
    = prior ytd + this month). `book_value` + `ending_cash` are month-only.
  - Use `null` where the report has no value.
- **`lob[]`** — 6 buckets per scope (`Pest`, `L&O`, `Fertilizer`, `Termite`,
  `Rat`, `Other`) for company + 4 branches (30 rows). From the **Revenue by Service
  Code** "Total" row per branch: `Other` = Ant + Bat + Bee + Mosquito + Wildlife +
  Unknown (fold the small categories; use the pure `Pest` column, not page-10's
  combined Pest).
- **`techProduction[]`** — per-tech from **Monthly Individual Route Metrics**
  (`Total Production` column = revenue). `scope` = branch, `name` = badge label,
  `lob` = that page's LOB column, `actual` = Total Production. **`budget` follows the
  established convention `round(badgeNumber / 12, 2)`** (0 for non-numeric names);
  keep it consistent with prior months rather than changing methodology. Skip `NA`
  rows. **PRODUCTION ONLY — never store manager/officer/individual compensation**
  (use Total Production/revenue, never the Tech Wages column); overhead comp is only
  the aggregate P&L buckets (`back_office_total`, `officer_total`).

Tip: generate the file by mapping over the prior month's JSON and substituting
`actual`/`budget` per `key|scope|basis`, so structure/order/count stay identical.

## 3. Wire deploy-db
Add the new base to the `seedMbrFromFile` loop in `scripts/deploy-db.ts`
(the `["mbr-2026-07", "mbr-2026-08", "mbr-2026-09", …]` array) and update the
comment. It stays guarded/idempotent/non-fatal.

## 4. How production gets updated
`scripts/deploy-db.ts` runs during `npm run build` and, on a **Production** Vercel
deploy (`VERCEL_ENV === "production"`), executes `prisma db push` + all seeds
against the **production** database (`DIRECT_URL`/`DATABASE_URL` — the same Neon
Postgres the live app queries; previews are skipped and never mutate it). So once
the new file is wired and merged to `main`, the next production deploy loads the
month automatically — **no manual step required**. `seedMbrFromFile` is **guarded**:
it only creates a ReportPeriod that's missing, and otherwise just reconciles LOB +
the P&L drilldown, so a later in-app correction is never clobbered.

Alternative / correction path: a super-admin (Chris, Julie, April) can upload the
PDF or a `.json` extract at **Settings & Admin → Management → Upload**
(`/management/upload` → `claudeExtractMbr` → confirm → `commitMbr`). `commitMbr`
**replaces** that month's rows, so it's the way to correct a month after it's live.

## 5. Validate (do this every month)
- `npx tsc --noEmit` clean.
- Load into local SQLite (`DATABASE_URL="file:./dev.db"`): a throwaway tsx script in
  the repo that calls `seedMbrFromFile(prisma, "mbr-YYYY-MM")` and prints the counts
  (then delete it). Expect `kpis`, `lob`, `techs` to match the file.
- **Tie to the PDF control totals**, e.g. company Preliminary production month actual
  (the `production|company|month` actual), YTD actual, and the branch Preliminary
  month totals. Confirm attrition/new-sales ytd = prior-month ytd + this month.

## 6. Deploy
Commit on a feature branch, push, fast-forward `main`, and poll CI to green
(`gh api repos/<owner>/<repo>/commits/<sha>/check-runs` — the `check` run must be
`completed success`). The production deploy then loads the month per step 4.

## Docs to keep in lockstep (see `AGENTS.md` / `CLAUDE.md`)
Adding a month is **data, not a workflow change**: update the MBR row in
`docs/WORKFLOWS.md` (note the month loaded). Do **not** bump the manager-manual or
handbook version for data-only changes, and only touch `lib/access-catalog.ts` if a
page/route/tool actually changes (it won't for a monthly load).
