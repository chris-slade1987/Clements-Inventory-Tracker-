# Weather Ops

A forecast that tells managers **what the weather means for routing and service
completion**, not just what it is. Free data only (National Weather Service +
National Hurricane Center) — no API keys, no paid services.

## Surfaces

- **Dashboard tile** (`components/WeatherTile.tsx`, on `/my-branch`): current
  conditions, today's risk badge (green/yellow/red), the AI ops headline, a 5-day
  strip, an alert banner, and "updated X ago". A branch-locked manager sees their
  territory; an admin sees a compact row across all four with the worst-risk rollup.
- **`/weather` page — the "command deck"** (`app/(app)/weather/page.tsx`): an
  airline/NWS-ops-console styling on the CanopyOS brand — a forest-green **command band**
  (`.surface-dark` + `.bg-forest-grad`) with the station title, a posture lamp, a live
  **ET+Zulu clock with auto-sync** (`components/weather/CommandClock.tsx`, refreshes
  every 5 min, paused when hidden), and a cockpit **instrument strip** (temp · humidity ·
  wind · rain · advisories). Below, on the light canvas: admins get a **station board**
  (per-territory tiles with risk lamps); the selected/own station shows an **ops brief**,
  **advisories**, an **interactive radar scope** (OSM roads basemap + animated RainViewer
  overlay + branded office pins, `components/weather/WeatherRadarMap.tsx`), a **5-day
  outlook**, an **ops timeline** (6a–8p, flagged hours shaded, a pulsing NOW marker), and
  active NWS alerts. Status lamps use the brand semantic colors with a slow pulse.
- **Intel-deck styling** (liberties within the palette/type): a dark forest ground with a
  HUD grid, corner-bracketed panels, a classification/system bar, instrument **gauges**
  (`components/weather/Gauge.tsx` — temp/humidity/wind/rain with threshold zones), and a
  scrolling **advisory ticker**. Forecast conditions use custom thin line-art
  **weather glyphs** (`components/weather/WeatherGlyph.tsx`), not raster NWS icons.
- **Radar**: larger scope (520px), a **play/pause + frame scrubber**, and an
  `invalidateSize()` fix (plus `ResizeObserver` and `maxNativeZoom`) so tiles load at the
  default zoom instead of only after the user zooms.
- **`/weather/settings`** (admin only, `requireAdmin`): rule thresholds, forecast
  locations, and the fertilizer blackout calendar.

## Territories

The four branch slugs — `vero`, `stuart`, `orlando`, `naples` (reused from
`lib/management.ts`). A territory may have several forecast points (Orlando is big);
its risk is the **worst** across its points. Seed points are approximate branch-area
centers (`DEFAULT_LOCATIONS` in `lib/weather/service.ts`), admin-editable afterward.

## Data sources

| Source | Use | Endpoint |
| --- | --- | --- |
| NWS | hourly, 5-day, gridpoint detail, alerts | `https://api.weather.gov` |
| NHC | active tropical systems | `https://www.nhc.noaa.gov/CurrentStorms.json` |
| RainViewer | animated radar overlay (free, no key) | `https://api.rainviewer.com/public/weather-maps.json` + tile cache |

- A descriptive **User-Agent** with contact info is required by NWS or requests are
  blocked (`lib/weather/nws.ts`).
- `/points/{lat},{lon}` → gridId/gridX/gridY + forecast URLs + radarStation. These
  never change, so they're resolved **once on first fetch** and cached on the
  `WeatherLocation` row (no seed-time call — the sandbox can't reach NWS anyway).
- Wind comes back as strings ("5 to 10 mph") — parsed to the **high end**.
- **Alerts are filtered to land weather only** (`isOperationalAlert` in `rules.ts`):
  thunderstorm, tornado, flood/flash-flood, wind, heat, tropical/hurricane, freeze/cold,
  fog. Coastal/marine/aquatic/astronomical alerts (rip current, high surf, beach
  hazards, coastal/lakeshore flood, small craft, marine, storm surge, tsunami, air
  quality) are dropped **before the rules run**, so they never show and never force a
  red day. The branch cares about rain, heat, thunder/lightning, humidity, temperature,
  and wind — hourly data carries temp, rain %, **humidity %**, and wind.
- Every call retries with backoff (3 tries); on failure the last good snapshot is
  served with a **stale badge** — never an empty tile.

## Rules engine (deterministic, runs before the AI)

`lib/weather/rules.ts` is a **pure** module (unit-tested in `rules.test.ts`). It
computes flags from admin-editable thresholds, then the risk level. The AI only
*explains* this; it never sets the risk.

Flags: `RAIN_WINDOW`, `HEAVY_RAIN`, `FERT_ALERT_BLOCK`, `WIND_CAUTION`,
`WIND_NO_SPRAY`, `THUNDER`, `HEAT_HIGH`, `HEAT_EXTREME`, `NWS_WARNING`, `TROPICAL`,
`FERT_BLACKOUT` (reminder-only, never elevates risk).

Risk level:
- **Red** — `NWS_WARNING`, `TROPICAL`, `HEAT_EXTREME`, or `THUNDER` + rain covering
  more than half the 7am–5pm workday.
- **Yellow** — any other flag except `FERT_BLACKOUT`.
- **Green** — no risk-elevating flags.

Default thresholds (`DEFAULT_THRESHOLDS`): rain pop ≥ 50%, heavy rain ≥ 2.0"/24h,
wind caution ≥ 10 mph sustained / ≥ 15 mph gust, no-spray ≥ 15 mph sustained, heat
high 103–115°F, heat extreme > 115°F. Stored overrides live in `WeatherSettings`
(singleton JSON) and merge over the defaults.

## AI ops briefing

`lib/weather/briefing.ts` — reuses the app's Anthropic pattern (raw fetch to
`/v1/messages`, `ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL || claude-opus-4-8`, "return
ONLY JSON" + defensive extract). Input: territory, today's 7am–7pm hourly, the 5-day
summary, alerts, the computed flags, and the risk level. Output: `{headline, summary,
bestWorkWindow, byServiceLine{lawn,pest,termite}, crewSafety, lookAhead}`. It is
regenerated only when the **risk level or flag set changes** from the stored briefing
for that branch+day (saves tokens), plus the morning cron run. If the key is missing
or the call fails, a deterministic **fallback** (flags as plain guidance) is used so
the page always renders.

## Refresh

- **Refresh on read** (primary, works on any plan): `getLocationSnapshot` refreshes
  when the newest snapshot is older than 60 min, behind an in-process lock so
  concurrent requests don't double-fetch.
- **Hourly cron** (`0 * * * *` → `/api/weather/refresh`, `CRON_SECRET`-protected):
  the Canopy project is on **Vercel Pro** (it already runs sub-daily crons), so an
  hourly cron is allowed. It warms every location, regenerates briefings on change,
  and purges snapshots older than 30 days (briefings are kept forever).

## Data model (`prisma/schema.prisma`)

`WeatherLocation`, `WeatherSnapshot`, `WeatherBriefing`, `WeatherSettings`,
`FertBlackout`. Branch is a bare slug string; JSON is stored as `String?`
(SQLite-safe); no enums, no migrations — `prisma db push` + the idempotent
`ensureWeatherLoaded()` healer (`lib/weather-ensure.ts`, called from the authed
layout) seeds the four points in prod.

## Access & scoping

Server-enforced in `/api/weather` (not just hidden UI): admin / super-admin /
senior-leadership see every territory; a branch-locked manager sees only their own and
gets **403** for any other branch. Catalog: `weather` (My Branch, managers+) and
`weather-settings` (Settings, admin-only) in `lib/access-catalog.ts`; path rules in
`lib/access-paths.ts` (specific-first); nav item `WEATHER_NAV_ITEM` in `lib/nav.ts`.

## Diagnostics

`GET /api/weather/diagnostics` (admin): last fetch + risk per location, grid-resolution
status, provider config, last briefings, snapshot count, and a build tag.

## Out of scope (Phase 2)

Cross-referencing against scheduled stops (blocked on the WorkWave API token), a
weather overlay on the fleet GPS map, red-day email/text alerts, a paid lightning
feed, and forecast-vs-actual completion analysis (briefing history is retained for it).
