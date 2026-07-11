# Clements Command & Control

Standalone warehouse **check-in / check-out** portal for Clements Pest Control.
Managers receive products into a warehouse from a distributor (Check-In) and
disperse products from a warehouse to a technician's truck (Check-Out). No
customer/site usage tracking.

Three warehouses: **Vero Beach (HQ)**, **Stuart**, **Orlando**.

## Stack

- **Next.js (App Router) + TypeScript + Tailwind CSS** — one codebase for UI + API.
- **Prisma + SQLite** for the local sandbox (zero external setup). Swap to
  Postgres for production.
- **Installable PWA** — manifest + service worker, "Add to Home Screen" on phone.
- **Invoice reader** — Anthropic Claude vision (Check-In), with a built-in mock
  parser fallback so the flow demos without an API key.

## Run it locally

```bash
npm install          # installs deps and generates the Prisma client
npm run dev          # start the dev server
```

Open <http://localhost:3000>. You'll land on the Dashboard, with a nav for
Dashboard, Check-In, Check-Out, Reconcile, Reports, and Alerts.

> The database and seed data arrive in the next step (Prompt 1). Once seeded:
>
> ```bash
> npm run db:reset   # create the SQLite schema and load sample data
> ```

## Project layout

```
app/
  (app)/            # authenticated screens, wrapped in the nav shell
    dashboard/  check-in/  check-out/  reconcile/  reports/  alerts/
  offline/          # PWA offline fallback
  manifest.ts       # PWA web app manifest
components/         # AppShell (nav), shared UI primitives
lib/                # prisma client, nav config
prisma/             # schema + seed
public/
  sw.js             # service worker
  icons/            # app icons (generated from icon.svg)
scripts/            # icon generation
```

## Environment

`.env` holds sandbox-safe defaults and is committed so the app runs on a fresh
clone. Real secrets (production `DATABASE_URL`, `AUTH_SECRET`,
`ANTHROPIC_API_KEY`) go in `.env.local` or your host's env — see `.env.example`.

## Features

- **Check-Out** — disperse stock to a technician (search or barcode scan, live
  on-hand, negative-stock guard).
- **Check-In** — upload a distributor invoice; Claude vision (or the mock
  parser) extracts line items for review before posting.
- **Dashboard & Reports** — purchased / dispersed / on-hand per warehouse, with
  filters and CSV export.
- **Reconcile** — reverse, correct, or adjust any movement; nothing is deleted.
- **Alerts** — automated anomaly checks (price increases, duplicate invoices,
  negative stock, quantity spikes).
- **Help** — in-app guide to the two workflows and installing the PWA.

## Regenerating icons

```bash
node scripts/gen-icons.mjs   # rebuilds PNGs from public/icons/icon.svg
```

## Going live

See [DEPLOY.md](./DEPLOY.md) for Vercel + Supabase (Postgres, storage) setup and
the SQLite → Postgres migration.
