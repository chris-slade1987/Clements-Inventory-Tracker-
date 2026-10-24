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

## Phases

1. **Design + schema (now):** this doc + the models above (`prisma db push`-safe).
2. **Intake + dashboard:** upload parser (to the sample's columns) + the map/stops/summary
   dashboard + per-tech approval + month sign-off + manager-checklist/rhythm/miss wiring.
3. **AI findings:** day-size / drive-time / mileage anomaly detection + forced responses.
4. **Leadership rollup:** cross-branch routing-approval status.
5. **In tandem:** PestPac routing API replaces the upload; OSRM upgrades estimates to exact.

## Access

New catalog item `routing-approval` under My Branch (manager `edit`);
`routing-approval-oversight` for leadership. Nav item in the My Branch group; managers
branch-locked. Route `/routing-approval`.
