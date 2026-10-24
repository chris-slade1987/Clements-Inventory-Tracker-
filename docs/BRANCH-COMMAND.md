# Branch Command — weekly branch oversight (design + spec)

**Status:** Phase 1 shipped + weekly checklist consolidated in · **Owner:** Chris / Director of Field Ops
**Supersedes:** the 6-item signed weekly oversight checklist (`seed-checklists.ts` template `"weekly"`).
`/checklists` and `/checklists/weekly` now redirect here; the Friday miss-penalty keys off a signed
`BranchWeek` anchored to go-live **Mon Oct 26, 2026** (first due Friday **Oct 30, 2026**). First weeks
will be pre-loaded with data for managers.

Branch Command is the branch manager's **weekly cockpit**. Instead of making managers
pull and decode PestPac reports (the "42-tab" problem Rentokil-Terminix publicly
described), Canopy is **fed the data**, presents a **live scoreboard** across seven
oversight domains, and layers AI on top to **guide the manager and force written
feedback** before they can sign the week off.

## Principles

1. **Feed, don't fetch.** Managers confirm and react to numbers Canopy already shows;
   they do not re-key data. (CANOPY-VISION §4 — "be the spine.")
2. **Source-agnostic plumbing.** Every metric carries a `source` (`upload` | `manual` |
   `api`). The weekly manual report upload is a *bridge*; a future PestPac API feed and
   the Claude routing/logistics work write to the **same** `WeeklyMetric` / `TechWeek`
   tables with no change to the dashboard or AI layer.
3. **Forced feedback = real oversight.** A week cannot be signed until every red/amber
   finding has a written explanation, every technician card is marked reviewed, and every
   domain is checked off. Signing then means "I've seen it, I understand it, here's why."
4. **The AI learns.** Manager responses to findings are stored structured and read back as
   context the following week, so the assistant stops re-asking answered questions and
   starts recognizing patterns.

## The seven domains (from the weekly-oversight research)

| # | Domain | Example metrics | Benchmark targets |
|---|--------|-----------------|-------------------|
| 1 | **Production & pacing** | MTD production vs. budget; weekly production | on pace to monthly budget |
| 2 | **Route & schedule integrity** | stops/day; unserviced rescheduled <7d; next-week schedules ready | 8–14 stops/day recurring; 6–10 termite/WDO |
| 3 | **Customer retention** | cancellations; save-calls; callback / re-treat rate | callback <3% good, >6% alarm |
| 4 | **Technician oversight** | per-tech production vs. pace, unserviced, cancellations, callbacks | revenue/tech ~$150–220k/yr; utilization 75%+ |
| 5 | **Compliance & safety (FL 482)** | ID cards/licenses current; certified-operator supervision; approved products; use-records complete | 100% |
| 6 | **Inventory & finance** | disbursements logged; receipts scanned; Friday deposit | complete |
| 7 | **Sales & lead hygiene** | lead follow-ups; 60+ day leads closed-lost | no stale leads |

## Data model (Phase 1)

- **`BranchWeek`** — one per branch per ISO week. `status` open → in_review → signed;
  attestation + signature; `itemResults` (domain checkoffs). Unique `(branch, periodKey)`.
- **`WeeklyReportUpload`** — each dropped PestPac export; parsed into the tables below.
- **`WeeklyMetric`** — normalized branch-level number: `domain`, `key`, `value`, `target`,
  `unit`, `status` (good|warn|alarm|info), `source`. Unique `(branchWeekId, key)`.
- **`TechWeek`** — per-technician weekly row: production/stops/unserviced/cancellations/
  callbacks, `status`, `reviewed`, `managerNote`.
- **`CommandFinding`** — AI/rule anomaly: `severity`, `title`, `detail`, `question`,
  `requiresResponse`, `managerResponse`, `status` (open|answered|dismissed). The
  forced-feedback + learning substrate.

All additive/defaulted/nullable → `prisma db push`-safe. A runtime loader
(`ensureBranchWeek`) lazily creates the current open `BranchWeek` per branch.

## Surface

`/branch-command` — manager's weekly home, branch-scoped (admins/leadership get a branch
picker + the leadership scoreboard). Top-to-bottom: week selector + status + Friday
countdown → **upload panel** → **7-domain scoreboard** → **AI findings** (required
responses) → **per-technician review cards** → **domain checkoffs** → **attest & sign**.
Brand kit throughout (forest-green chrome, Helvetica Neue 300, status chips, no emoji),
mobile-first.

## Phases

1. **Plumbing (now):** schema, dashboard shell with all sections (manual entry works),
   save/sign API, access-catalog + nav, runtime loader, this doc.
2. **Weekly report intake:** the exact PestPac export list + upload parsers → metric tables.
3. **AI guidance:** anomaly detection + question/forced-feedback engine + learning log.
4. **Leadership scoreboard:** green/amber/red across all four branches.
5. **In tandem:** Claude routing/logistics feeds the Route domain; PestPac API replaces upload.

## Access

New catalog item `branch-command` under My Branch (manager `edit`; leadership rollup under
`branch-command-oversight`). Nav item in the My Branch group. Managers branch-locked.
