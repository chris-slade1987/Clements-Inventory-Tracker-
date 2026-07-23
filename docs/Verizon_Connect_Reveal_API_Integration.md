# Verizon Connect Reveal — API Integration Reference

App: **Clements Command & Control** · Company: Clements Pest Control Services LLC
Region: **US** · Set up July 2026.

> **Secrets policy:** the App ID, REST username, and REST password are NEVER committed.
> They live only as Vercel environment variables and are read server-side via `process.env`.
> This doc uses the env-var names as placeholders in place of the real values.

## Environment variables (set in Vercel — all environments)
| Var | Meaning | Example / notes |
|---|---|---|
| `VERIZON_APP_ID` | Application ID (`atmosphere_app_id`) | `fleetmatics-p-us-…` (the `-us-` segment = US data center) |
| `VERIZON_REST_USERNAME` | Reveal **REST integration** username | `REST_…@…` (NOT the developer-portal login) |
| `VERIZON_REST_PASSWORD` | Reveal REST integration password | set in Vercel only; keep out of repo |
| `VERIZON_REGION` | Data center | `us` (default) or `eu` |

Base host is derived from region: `https://fim.api.${VERIZON_REGION}.fleetmatics.com`
(US = `https://fim.api.us.fleetmatics.com`, EU = `https://fim.api.eu.fleetmatics.com`). Port 443 (https).

## Authentication (two steps — server-side only)

### Step A — get a token (compulsory for all integrations)
```
GET https://fim.api.${region}.fleetmatics.com/token
Headers:
  Authorization: Basic <base64(`${VERIZON_REST_USERNAME}:${VERIZON_REST_PASSWORD}`)>
  Accept: application/json
```
Returns the authorization token. **Token lifetime: 20 minutes** — refresh by calling `/token`
again (refresh when within ~2 min of expiry, or on a 401). Cache the token in memory server-side.

### Step B — call data APIs — attach on EVERY request
```
Headers:
  Accept: application/json
  Content-Type: application/json
  Authorization: Atmosphere atmosphere_app_id=${VERIZON_APP_ID}, Bearer <token>
```

## Subscribed APIs & endpoints (app activated on all base APIs)
Base URLs:
- Customer Meta Data (CMD) suite: `https://fim.api.${region}.fleetmatics.com/cmd/v1`
- Real-time Aggregated Data (RAD) suite: `https://fim.api.${region}.fleetmatics.com/rad/v1`

| Purpose | Method + Path |
|---|---|
| List vehicles (metadata) | `GET /cmd/v1/vehicles` |
| Vehicles by group | `GET /cmd/v1/vehicles/group/{groupid}` |
| Single vehicle (metadata) | `GET /cmd/v1/vehicles/{vehiclenumber}` |
| Vehicle location/GPS + status history (≤30 days) | `GET /rad/v1/vehicles/{vehiclenumber}/status/history` |
| Vehicle history / trips (journeys & stops per day) | `GET /rad/v1/vehicles/{vehiclenumber}/segments` |
| Trips by driver | `GET /rad/v1/drivers/{drivernumber}/segments` |
| Token | `GET /token` |

## Important constraints
- **No standalone Alerts REST API.** Reveal alerts are delivered via **webhooks** — create webhook
  endpoints and submit their URLs to Verizon Connect in **Reveal → Admin → Integrations**. Our own
  AI-generated GPS alerts are computed locally from the stored status-history + segments.
- **No confirmed distinct "live current position" endpoint** in the current subscription. Use the
  latest entry from `/rad/v1/vehicles/{n}/status/history` as the near-real-time position; true push
  requires the webhook feed (or an additional API subscription — confirm in the portal catalog).
- Other activated base APIs available later: Fleet, Driver, Driver Assignment, Driver Safety,
  Geofence, Group, Logbook, User, Vehicle Update, Non-Powered Assets (+ GPS History/Update),
  Attribute, Video Event.
- "Live access requests require explicit approval from the API provider and may take several days";
  the relevant APIs already show **Activated**.

## Developer portal
Akana portal: `https://vzc-us-prod-admin.apiportal.akana.com/` (developer-portal login is separate
from the REST integration credentials above).
