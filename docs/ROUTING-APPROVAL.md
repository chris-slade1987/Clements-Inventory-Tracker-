# Routing Approval — monthly proactive routing sign-off (design + spec)

**Status:** Design + schema (Phase 1) · **Owner:** Chris / Director of Field Ops
**Sibling of:** Branch Command (`docs/BRANCH-COMMAND.md`) — same fed-data + AI-findings +
per-unit forced sign-off pattern, on a **monthly** cadence instead of weekly.

## The problem it fixes

The routing department sets each month's routing, but technicians and managers don't
review it with any real intent. Inefficiency is discovered **reactively** mid-month when
a tech complains about a bad day. Routing Approval moves the review **to the first week of
the month** and makes the manager **sign off on each technician's month before it runs** —
proactive ownership instead of mid-month firefighting.

## Principles (shared with Branch Command)

1. **Feed, don't fetch.** The routing dept's monthly export is uploaded; managers review a
   visual dashboard, they don't pull reports.
2. **Source-agnostic.** Rows carry `source` (`upload` | `manual` | `api`) so a future
   PestPac routing API drops in with no UI change.
3. **Forced, per-technician sign-off.** The manager must approve **each tech's** routing
   (and answer every flag) before the month can be signed.
4. **AI guides the eye.** The assistant flags days that look too big/small and techs with
   excess drive time or mileage, so the manager reviews the *right* days closely.

## Cadence & enforcement

- **Monthly**, reviewed in the **first week**. Due by end of the first week of the month.
- A branch that hasn't signed its `RoutingMonth` by the first-week deadline is a **miss**
  (same CEO/HR-clearable pattern as Branch Command), surfaced on the Manager Checklist
  (monthly row) + the operating-rhythm ribbon (This month) + the leadership rollup.

## The dashboard

`/routing-approval` — branch-scoped (admins/leadership switch branches). For the selected
month:

1. **Technician + day picker** — choose a tech, then a day.
2. **Dynamic map** (Leaflet + OpenStreetMap, no API key): the day's stops as ordered
   markers (1…x) joined by a route line, so the manager *sees* the shape of the day.
3. **Stops table under the map** — `# · customer · address · $ per stop`, with **totals**
   (stops, $) at the bottom.
4. **Monthly summary table** — one row per technician: days, total stops, total $, avg
   stops/day, **estimated miles**, **estimated drive time**, and a status chip. This is the
   at-a-glance "is this tech's month balanced?" view.
5. **AI findings panel** — days too big / too small, excess drive time, excess mileage,
   lopsided day-to-day balance; each may require a written response.
6. **Per-technician sign-off** — the manager marks each tech "routing reviewed & approved"
   (with an optional note); then signs the month. **Cannot sign** until every tech is
   approved and every required finding answered.

### Map & distance mechanics (Leaflet + OSM, no key)

- **Geocoding:** addresses → lat/lng via a free geocoder (Nominatim), **cached** in
  `GeocodeCache` (unique by normalized address) so each address is geocoded once, ever;
  resolved lat/lng is also stored on the `RouteStop`. If the routing export includes
  coordinates, we use them directly and skip geocoding.
- **Distance / drive time:** estimated per day from the ordered stops — great-circle
  (haversine) distance between consecutive stops × a road-detour factor, drive time from an
  assumed average speed. Clearly labeled **"est."** Upgrade path: a real routing engine
  (OSRM) for exact road distance/time without changing the schema.
- **Tiles:** standard OSM tiles for MVP (low volume); swappable for Carto/Stadia later.

## Data model (Phase 1)

- **`RoutingMonth`** — one per branch per month (`periodKey` "2026-11"); status open →
  in_review → signed; attestation + signature. Unique `(branch, periodKey)`.
- **`RoutingUpload`** — each monthly routing export file; parsed into the rows below.
- **`RouteTechMonth`** — **the sign-off unit**: per tech per month totals (days, stops, $,
  avg stops/day, est miles, est drive min), status, `approved` + note + approvedAt.
- **`RouteDay`** — per tech per calendar day: stop count, $, est miles, est drive min, status.
- **`RouteStop`** — each stop: `seq`, customer, address, lat/lng (cached), dollars.
- **`RoutingFinding`** — AI/rule anomaly: severity, title, detail, question,
  requiresResponse, managerResponse, status — the forced-feedback substrate.
- **`GeocodeCache`** — address → lat/lng, shared across months/branches.

All additive/defaulted/nullable → `prisma db push`-safe. A runtime loader
(`ensureRoutingMonth`) opens the current month lazily.

## Required routing export columns (minimum)

Per stop row: **technician** (name or route #), **service date**, **stop sequence**,
**customer/site**, **address** (street, city, state, zip), **$ amount** (price/value of the
stop). Optional but ideal: **latitude/longitude**, **scheduled duration**, **drive
time/mileage** (if present we use them instead of estimating). A sample export (one month,
one branch) pins the parser exactly.

## Route profiles — the branch knowledge the AI learns

Each route carries durable, editable config (`lib/route-profiles.ts` defaults + the
`RouteProfile` table for confirmations/edits), so the system *understands* the branch
instead of grading everyone identically. Per route: canonical name, **kind**, Canopy
employee link, paired-crew links, and name aliases.

- **kind** `route` (graded on stops/day efficiency) · `commercial` (big accounts, few
  stops — not graded on stops/day) · `senior` (senior personnel/managers — schedule
  reviewed so nothing's missed, never graded on efficiency) · `exclude`.
- **aliases** merge stray names into the right route (e.g. a stop logged under `NATHAN`
  belongs to route 17 = `BRIAN`).
- **partners** link paired crews with overlapping jobs (e.g. `19 GUS` ↔ `16 JACOB`) so
  the AI treats their work as one unit and never flags the overlap as duplication.

Seeded defaults (confirmed 2026-10-24): route 17 = BRIAN (alias NATHAN); GUS 19 ↔ JACOB 16
(commercial, paired); TIM 22 / JASON 20 / TED 302 / ADAM 201 / COREY 404 / SENTR 47 = senior
(included, not efficiency-graded). These are the first entries in the knowledge layer; the
confirm-once matching UI grows it over time.

## Interactive optimization & the PestPac change-set (manager/admin)

Routing Approval is not just a review surface — managers/admins/super-admins can **act** on it:

- **Ask for insights / optimize.** The manager can ask Canopy to "build a more efficient day,
  week, or month." The AI proposes a rebalanced schedule that evens daily load and cuts the
  heaviest days (reducing overtime / late-stop risk), with before→after balance, heaviest-day,
  and modeled drive/overtime deltas.
- **Lock jobs in place.** Any stop a customer requires on a specific day/time is **locked**;
  the optimizer reworks everything else **around the locks** and never moves a locked job.
- **Proposed summary of changes → PestPac.** The output is a concrete change set ("move
  <customer> from Tue 11/10 → Mon 11/23"), reviewable, with a one-click **Download PestPac
  change set (.csv)** the routing dept implements in PestPac. The CSV is UTF-8 (BOM for Excel)
  with columns **Account, Customer, Service, Current Date, Proposed Date, Amount** — keyed on
  the PestPac **Account #** so the reschedule matches on import (M/D/YYYY dates). The file name
  is `canopy-changeset_route-<routeNo>_<period>.csv`. (Phase: a direct PestPac write-back is a
  later integration; the first version produces the reviewed change list + export. If PestPac
  requires an exact import layout, these columns are matched to that template.)
- **Non-destructive by design — always revertible.** Rebalancing is a **working draft held in
  the browser only**. It writes nothing back to Canopy: no API call, no DB write on rebalance
  or export. **Revert to original** clears the draft and every lock in one click, and the loaded
  month is untouched. Canopy overwrites routing data **only** when a new schedule is uploaded
  from outside Canopy (see Ingest, which replaces the month). Sign-off records the review; it
  does not alter the loaded stops.

Everything stays human-in-the-loop: the AI proposes, the manager approves per technician, and
nothing changes in PestPac — or in Canopy's loaded data — without an explicit, reviewed export
followed by a manual PestPac import.

## Fuel forecast (the routing ↔ fuel ↔ $ story)

Once routes are geocoded, each tech-month yields **estimated miles**. Combined with
**fleet MPG** (per-vehicle, derived from `FuelTransaction` gallons vs. odometer, or a branch
default) and a **$/gallon** input, Canopy forecasts the month's fuel spend per tech / per
branch:

```
forecast_fuel_$  =  est_miles / mpg  ×  forecast_price_per_gallon
```

- **Historical price** comes from the **Coast** fuel data already in Canopy
  (`FuelTransaction`, `coast_fuel_last_sync`) — a trailing average $/gallon and its trend.
- **Current price** is a fresh input (a recent-weeks Coast average, optionally blended with a
  live retail price for the branch's metro) so the forecast reflects today, not last quarter.
- Output: projected fuel spend for the month beside the routing, variance vs. the trailing
  actuals, and a per-tech "cost-to-serve" lens (fuel $ per stop / per $ produced). This is a
  first pillar of the longitudinal AI story (routing → mileage → vehicle → fuel → production).

Lands with/after Phase 3 (it needs the geocoded mileage estimate + the Coast history join).

## Phases

1. **Design + schema (now):** this doc + the models above (`prisma db push`-safe).
2. **Intake + dashboard:** upload parser (to the sample's columns) + the map/stops/summary
   dashboard + per-tech approval + month sign-off + manager-checklist/rhythm/miss wiring.
3. **AI findings:** day-size / drive-time / mileage anomaly detection + forced responses.
4. **Leadership rollup:** cross-branch routing-approval status.
5. **Fuel forecast:** est-miles × fleet MPG × forecast $/gallon (Coast history + current
   price), per tech/branch, with variance vs. trailing actuals (see *Fuel forecast* above).
6. **In tandem:** PestPac routing API replaces the upload; OSRM upgrades estimates to exact.

## Access

New catalog item `routing-approval` under My Branch (manager `edit`);
`routing-approval-oversight` for leadership. Nav item in the My Branch group; managers
branch-locked. Route `/routing-approval`.
