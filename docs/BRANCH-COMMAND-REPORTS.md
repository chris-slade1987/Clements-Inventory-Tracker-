# Branch Command — weekly report intake (Phase 2 spec)

What the branch (or an admin) exports each week and uploads to **Branch Command**,
and how each file maps to the scoreboard domains + per-technician cards. Mirrors the
Routing Approval ingest pattern: upload → parse → normalized metrics, source-agnostic
(`upload` now, PestPac API later). Run every report for **last week (Mon–Sun)** unless
noted; MTD figures are month-to-date through the run date.

> PestPac report names vary by install. The names below are the common ones — **verify
> the exact report + column names in your PestPac** when we build each parser. Where a
> metric isn't in PestPac (leads/sales), it comes from Sales Center / WorkWave.

## 1. Production & pacing  → domain `production`
- **Report:** *Production Report* (a.k.a. Sales/Production by Branch), run **MTD** and **this week**.
- **Columns needed:** branch, production $ (billed/collected), period.
- **Feeds:** `production_mtd` ($), `production_week` ($), `pacing_pct` (MTD ÷ monthly budget).
- **Budget:** from the monthly manager report / KPI budget already in Canopy (MBR), not PestPac.

## 2. Route & schedule integrity  → domain `route`
- **Report A — Unserviced / Skipped:** *Unserviced Accounts* (or Skipped Services), last week.
  - Columns: date, account, technician, reason. Feeds `unserviced_count`, and
    `unserviced_open` (not yet rescheduled within 7 days — compare to the reschedule report).
- **Report B — Next week's schedule:** *Technician Schedule Report* for **next week**.
  - Confirms routes are built; feeds the "next week ready" check (count of techs with a schedule).
- **Stops/day:** derived from the Technician Production report (Report in §4) ÷ days worked.

## 3. Customer retention  → domain `retention`
- **Report A — Cancellations:** *Cancellation Report* (cancels/stops), last week.
  - Columns: date, account, technician, reason. Feeds `cancellations_count`; "saves" entered by the manager.
- **Report B — Callbacks / re-services:** *Callback* or *Re-service Report*, last week.
  - Columns: original service date, re-service date, technician, account. Feeds
    `callback_rate` = re-services ÷ services (target <3%, alarm >6%).

## 4. Technician oversight  → per-technician cards + `technician`
- **Report:** *Technician Production Report* (per tech), last week.
  - Columns: technician (name/route #), stops/jobs completed, production $, unserviced,
    cancellations, callbacks (join from §2–§3 by technician).
  - Feeds each tech card: production vs. pace, stops/day, unserviced, cancellations, callback rate.
  - **Join key:** tech number ↔ Canopy via the same route-profile mapping Routing Approval uses.

## 5. Compliance & safety (FL 482)  → domain `compliance`
- **Not a PestPac export** — manager checkoffs + existing Canopy data:
  - ID cards / licenses current → Canopy personnel/credentials.
  - Approved products only, use-records complete → manager attestation.
- Feeds the compliance checkoffs (no upload).

## 6. Inventory & finance  → domain `inventory`
- **Already in Canopy** — no upload:
  - Chemical disbursements → the **Check-Out** ledger (sum for the week).
  - Receipts scanned + Friday deposit → manager checkoffs.

## 7. Sales & lead hygiene  → domain `sales`
- **Source:** **Sales Center / WorkWave** (not PestPac), already connected to Canopy.
  - `open_leads`, `stale_leads_60` (60+ days) from the sales pipeline.

---

## Minimum weekly upload set (what the manager actually does)
A short, repeatable list each Friday:
1. **Production Report** (MTD + this week)
2. **Technician Production Report** (per tech, last week)
3. **Unserviced / Skipped**
4. **Cancellations**
5. **Callbacks / Re-services**
6. **Next-week Technician Schedule**

§5–§7 need no upload (Canopy already has them). Each file is dropped on Branch
Command's weekly upload (same confirm-before-apply + replace-on-re-upload flow as
Routing Approval); the parser normalizes into `WeeklyMetric` / `TechWeek`, and the
manager confirms/reacts rather than re-keying.

## Build order (Phase 2)
1. Upload UI on Branch Command (reuse the Routing Approval confirm flow).
2. Parsers per report (pin to a real sample export of each — same way the routing
   parser was pinned to the Technician Schedule Report).
3. Map parsed rows → `WeeklyMetric` (branch) + `TechWeek` (per tech) with `source:"upload"`.
4. Status thresholds already exist in `lib/branch-command.ts` (callback <3/>6, stops/day, pacing).

**To build the parsers, we need one real sample export of each report above** (one branch,
one week) — exactly how the routing parser was pinned to your November file.
