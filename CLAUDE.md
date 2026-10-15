@AGENTS.md

# Clements Command & Control — project guide

Standalone, managers-only warehouse portal for Clements Pest Control. It tracks
**exactly two movements** and nothing else:

1. **Check-IN** — products received into a warehouse from a distributor
   (invoice upload + AI reading).
2. **Check-OUT** — products dispersed from a warehouse to a technician's truck.

Out of scope (do not build): per-stop or per-account chemical usage. We never
track what gets applied at a customer site.

Four warehouses/branches: **Vero Beach (HQ)**, **Stuart**, **Orlando**, **Naples**.

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

## Brand & design — always follow the brand kit

Any UI, artifact, slide deck, course material, diagram, email, or graphic for
this project MUST follow **`docs/BRAND_KIT.md`** (the canonical CanopyOS visual
system: forest-green chrome + light content canvas, Helvetica Neue weight 300,
thin 1.6 line icons, the exact color tokens/gradients, the component recipes, the
"Buzz" celebration mascot, and motion rules). Read it before producing anything
visual. No emoji in product/content (Buzz is the one sanctioned exception). The
live tokens live in `app/globals.css` / `components/ui.tsx`; if they change, update
`docs/BRAND_KIT.md` in the same change.

## Docs track the code

Every change that adds or alters a workflow MUST, in the same change, update
`docs/WORKFLOWS.md` and reconcile `prisma/data/manager-manual.md` (and flag the handbook in
`prisma/data/handbook-suggestions.md` — never reword policy). The manual/handbook are
launch-gated on a clean registry. See the **"Docs track the code"** directive in `AGENTS.md`.

## Access Rights registry tracks the code

The **Settings & Admin → Access Rights** screen (super admins only — Chris, Julie, April)
is driven by `lib/access-catalog.ts` (`MODULES` + each level's `DEFAULT_GRANTS`) and resolved
by `lib/access.ts`. **Any change that adds, renames, merges, moves, or removes a page, route,
or tool, or that changes who can reach one, MUST update `lib/access-catalog.ts` in the SAME
change** — add/rename/remove the item under the right module and set the affected levels'
default grants — so the admin screen always mirrors the real portal. This is non-negotiable:
the Access Rights matrix is only trustworthy if it stays in lockstep with the code. When you
also add a new access level, add it to `LEVELS` and `DEFAULT_GRANTS` and to `deriveLevelKey()`.

## Next.js 16 note

`cookies()`, `headers()`, and route `params` / `searchParams` are **async** —
`await` them. See `node_modules/next/dist/docs/` before using newer APIs.
