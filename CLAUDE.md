@AGENTS.md

# Clements Command & Control — project guide

Standalone, managers-only warehouse portal for Clements Pest Control. It tracks
**exactly two movements** and nothing else:

1. **Check-IN** — products received into a warehouse from a distributor
   (invoice upload + AI reading).
2. **Check-OUT** — products dispersed from a warehouse to a technician's truck.

Out of scope (do not build): per-stop or per-account chemical usage. We never
track what gets applied at a customer site.

Three warehouses: **Vero Beach (HQ)**, **Stuart**, **Orlando**.

## Architecture

- Next.js App Router + TypeScript + Tailwind v4. One codebase, UI + API routes.
- Prisma + SQLite locally (`.env` → `file:./dev.db`); Postgres in production.
- Installable PWA (`app/manifest.ts` + `public/sw.js`).
- Invoice reader calls Anthropic Claude vision when `ANTHROPIC_API_KEY` is set,
  otherwise falls back to a mock parser so the flow always demos.

## Core data rule

Everything stock-related is a row in `stock_movements`. **On-hand for a
product in a warehouse = SUM(quantity) of its movements** (check_in is
positive, check_out negative, adjustment either sign). Never mutate on-hand
directly and never hard-delete a movement — reconcile with reversals and
adjustments so the audit trail stays intact.

## Conventions

- Authenticated screens live under `app/(app)/` and share `AppShell` (nav).
- Shared UI primitives are in `components/ui.tsx`; reuse `btn`, `Card`,
  `PageHeader`, `EmptyState` instead of re-styling.
- Mobile-first: managers use this on phones. Keep tap targets large.

## Next.js 16 note

`cookies()`, `headers()`, and route `params` / `searchParams` are **async** —
`await` them. See `node_modules/next/dist/docs/` before using newer APIs.
