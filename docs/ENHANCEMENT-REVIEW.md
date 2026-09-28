# CanopyOS / Clements Command & Control — Enhancement Review

**Prepared for:** CEO + Engineering lead
**Scope:** High-leverage, low-effort improvements to the *existing* platform (no rewrites)
**Reviewed:** Next.js 16.2 App Router · React 19 · Prisma 6 (SQLite dev / Postgres Neon prod) · Vercel
**Launch runway:** ~4 days to branch managers + directors
**Method:** Every claim below is grounded in the code with `file:line` references, verified by reading the files.

---

## Executive summary

CanopyOS is a genuinely impressive single-codebase ERP for a mid-size pest-control company. It has grown to **75 Prisma models, 91 API routes, 100 pages, and ~70 `lib/` modules** covering inventory, fleet, fuel, HR, ATS/hiring, PTO, scorecards, training, insurance, and executive reporting. For a small team this is a lot of working software, and several parts are genuinely excellent.

### What's genuinely strong

- **The inventory ledger is textbook.** On-hand is *always* `SUM(StockMovement.quantity)`; nothing is mutated or hard-deleted (`lib/inventory.ts`, `prisma/schema.prisma:StockMovement`). The table is correctly indexed (`@@index([productId, warehouseId])`, `@@index([warehouseId])`, `@@index([type])`, `@@index([createdAt])`) and the reporting layer reads it efficiently via `groupBy` + `Promise.all` (`lib/reporting.ts:352`, `:532`). This is the healthiest part of the system.
- **The reporting layer avoids N+1.** `productLedgerByDivision` (`lib/reporting.ts:347-434`) fires four aggregate queries in parallel and joins in memory — the right pattern.
- **Deploy self-healing is real.** `scripts/deploy-db.ts` wraps **23** post-push seed steps in an isolation helper (`runStep`, line 30) so one bad seed can't blank the rest of the DB, and it routes DDL over a direct (non-pooled) connection to survive Neon/pgBouncer.
- **The docs-track-the-code discipline** (`AGENTS.md`, `docs/WORKFLOWS.md` 64-workflow registry) is unusually mature for a company this size.
- **The scorecard, ATS pipeline, and new-hire review lifecycles** are thorough and thoughtfully access-scoped.
- **Email degrades gracefully** — no provider configured logs the intent to `EmailLog` instead of throwing (`lib/email.ts:37-52`).

### Top 5 highest-leverage opportunities

| # | Opportunity | Impact / Effort |
|---|---|---|
| 1 | **A shared API-route wrapper** (`withRoute`): auth + JSON parse + error mapping in one place, adopted file-by-file. Kills raw-exception leakage in **54 routes** and removes ~4 lines of boilerplate from each. | High / S–M |
| 2 | **Stop leaking raw exception text to clients** — `catch (e) { error: e.message }` appears in **54** `route.ts` files (e.g. `app/api/pto/route.ts:145`, `app/api/sign/route.ts:32`, `app/api/review-sign/route.ts:52`). One-line fix per route, or free once #1 lands. | High / S |
| 3 | **Reconcile the docs to the deleted GPS feature.** The entire Verizon/GPS subsystem (`lib/verizon.ts`, `lib/gps*.ts`, `app/api/gps/**`, `/fleet/map`) **no longer exists**, yet `docs/WORKFLOWS.md` still lists **10 GPS rows as ✅ aligned** — a launch-gate violation by the project's own rule. | High / S |
| 4 | **Unify the "needs attention" surfaces** behind one read model. Five parallel systems today; the notification bell counts only *one* of them (`components/NotificationBell.tsx`). | High / M |
| 5 | **Add minimal CI + unit tests** on the highest-churn pure logic (reminders lead-window, auth predicates, ledger math). No `.github/` exists today. | High / S–M |

### One-line launch verdict

**Conditionally ready.** The platform is functionally rich and the core data model is sound. Before launch, close the small set of **correctness/trust blockers** (raw-error leakage, the GPS doc-drift launch-gate breach, and the `Setting`-vs-hardcoded escalation-list risk). Everything else — the consolidation themes — is high-value **post-launch** work that should be done incrementally, never as a big-bang rewrite.

---

## Prioritized recommendations

Ranked by impact-to-effort ratio. **Effort:** S = <1 day, M = 1–3 days, L = >3 days.

---

### R1 — Stop leaking raw exception text to clients

- **Problem / evidence.** 54 route handlers end with `catch (e) { return NextResponse.json({ error: (e as Error).message }, { status: 400 }) }`. Confirmed at `app/api/pto/route.ts:145`, `app/api/sign/route.ts:32`, `app/api/review-sign/route.ts:52`, and 51 others (`grep -rl "(e as Error).message" app/api`). A Prisma constraint violation, a null-deref, or a connection error is echoed verbatim to the browser — leaking schema details, table names, and stack fragments to branch managers, and giving them cryptic messages instead of actionable ones.
- **Proposed change.** Introduce a single `fail(e)` helper (or the `withRoute` wrapper in R3) that logs the real error server-side and returns a generic `{ error: "Something went wrong. Please try again." }` with a 500, while still allowing explicit user-facing 400s (`{ error: "Choose a start and end date." }`) to pass through. Adopt file-by-file.
- **Impact / Effort:** High / S.
- **Classification:** **Launch blocker** (data-leak + poor UX on the day managers first hit edge cases).

---

### R2 — A shared API-route wrapper (`lib/route.ts`)

- **Problem / evidence.** Every one of ~91 handlers re-implements the same preamble: **79** call `getSessionUser` inline, **58** do `req.json().catch(() => null)`, **57** have a bespoke `catch (e)` block, then hand-coerce fields with local `s()`/`dateOf()` helpers (e.g. `app/api/pto/route.ts:19-20`). There is no `middleware.ts` and no `zod` anywhere in the repo. This is the single highest-leverage consolidation target: the same four concerns are copy-pasted ~90 times, so a bug fixed in one place is unfixed in 89 others.
- **Proposed change.** Add a thin wrapper — not a framework:

  ```ts
  // lib/route.ts
  export function withRoute(handler, opts?: { auth?: "user" | "admin" | "public" }) {
    return async (req: Request, ctx) => {
      try {
        const user = opts?.auth === "public" ? null : await requireApiUser(opts?.auth);
        const body = req.method !== "GET" ? await req.json().catch(() => ({})) : {};
        return await handler({ req, ctx, user, body });
      } catch (e) {
        if (e instanceof HttpError) return NextResponse.json({ error: e.message }, { status: e.status });
        console.error("[route]", req.url, e);        // real error stays server-side
        return NextResponse.json({ error: "Something went wrong." }, { status: 500 });
      }
    };
  }
  ```

  Adopt incrementally: new routes use it immediately; migrate the highest-traffic existing routes (check-in, check-out, pto, sign) first. This subsumes R1 for every migrated file.
- **Impact / Effort:** High / M (wrapper is S; adoption is gradual).
- **Classification:** Wrapper = **launch nice-to-have**; full adoption = **post-launch**.

---

### R3 — Reconcile WORKFLOWS.md to the removed GPS/Verizon subsystem

- **Problem / evidence.** The GPS feature has been **deleted from the codebase**: `lib/verizon.ts`, `lib/gps.ts`, `lib/gps-detect.ts`, `lib/gps-webhook.ts` do **not exist**; `find app/api/gps` returns **0 routes**; there is **no `/fleet/map`, `/fleet/gps`, or `/fleet/gps/alerts` page**. Yet `docs/WORKFLOWS.md` still contains **10 rows** describing "GPS connector + auth (Verizon Reveal)", "GPS webhook receiver", "Fleet Live Map", "GPS detection engine", "GPS Alerts section", etc. — **all marked ✅ aligned** (`docs/WORKFLOWS.md:76-83`). By the project's own launch gate ("no ⚠️/❌/🆕 may remain open at launch", and canonical steps "derived by reading the code"), a registry that asserts ✅ for workflows that don't exist is a **gate breach** — the exact failure the discipline is meant to prevent.
- **Residual dead artifacts from the removal:**
  - `package.json` still declares `leaflet`, `react-leaflet`, and `@types/leaflet` — unused dependencies.
  - `app/layout.tsx:3` still imports `leaflet/dist/leaflet.css` **globally**, shipping map CSS to every page in the app.
  - `e2e/gps.spec.ts` (imports leaflet) and `e2e/gps-phase2.spec.ts` still run under `testDir: ./e2e` (`playwright.config.ts:10`) — they test removed features.
  - `lib/gps-ui.ts` `STATUS_META` (moving/idle/stopped/offline) is dead; only its `vehicleTitle()` helper is still used (`app/(app)/fleet/assignments/page.tsx`).
- **Proposed change.** Delete the 10 GPS rows from `WORKFLOWS.md` (or move them to a "Removed / parked" appendix with status noted); drop the three leaflet deps and the global CSS import; delete the two GPS e2e specs; trim `STATUS_META` from `lib/gps-ui.ts` and keep `vehicleTitle`.
- **Impact / Effort:** High / S.
- **Classification:** **Launch blocker** for the WORKFLOWS reconciliation (it's the launch gate); dead-code cleanup is a **quick win**.

---

### R4 — Externalize the hard-coded escalation & config lists into `Setting`

- **Problem / evidence.** The `Setting` key/value table exists and is used only **15 times**, while operationally critical config is hard-coded in source:
  - `INVENTORY_ESCALATION_EMAILS` — who gets pulled into a stock-out escalation — is a literal array in `lib/threads.ts:85-89`. If a name on that list leaves the company (Julie/Graham/Chris), the escalation silently mis-routes until a **code deploy** fixes it.
  - `BRANCHES` is a literal in `lib/management.ts:6-11`.
  - Anomaly/reminder thresholds are constants (`lib/anomaly.ts:7-9`, `lib/reminders.ts:44-47`) — though price-increase threshold *is* already Setting-backed (`lib/anomaly.ts:18-24`, a good template to follow).
- **Proposed change.** For launch, at minimum move `INVENTORY_ESCALATION_EMAILS` to a `Setting` (`inventory_escalation_emails`) with the current list as the seeded default and a fallback to the constant — so a director change doesn't require a deploy. The rest (branches, thresholds) can follow post-launch behind a small admin settings screen.
- **Impact / Effort:** High (correctness of escalations) / S.
- **Classification:** Escalation list = **launch nice-to-have** (leaning blocker if a listed person is mid-transition); the rest = **post-launch**.

---

### R5 — Unify the five "needs attention" surfaces behind one read model

- **Problem / evidence.** There are **five parallel** attention systems, and they don't share identity:
  1. `Alert` model — created by `lib/anomaly.ts`, `lib/savings.ts`, `lib/reorder.ts`, `lib/jobs.ts` (all four confirmed via `grep alert.upsert|alert.create`).
  2. `Reminder` model — `lib/manual-reminders.ts`.
  3. A **computed, non-persisted** `managerReminders()` — `lib/reminders.ts:49-337`, **16 kinds**, recomputed on every dashboard load.
  4. Threads/messages — `lib/threads.ts`.
  5. Per-domain "awaiting action" states (AuditFollowUp, pending PtoRequest, NewHireReview due, ScorecardReview due, outstanding DocumentAcknowledgment, Candidate/Interview).

  The **notification bell counts only #4** — `components/NotificationBell.tsx` hits `/api/threads/unread` and nothing else. A manager with an overdue license, a negative-stock alert, and three pending PTO requests sees a bell that says "0". The **same real event can appear as an Alert *and* a computed reminder *and* an email** with no shared key — e.g. a manual reminder becomes both a computed reminder (`lib/reminders.ts:314-333`) and an `Alert` upsert (`lib/jobs.ts:199-203`).
  - **Duplicated lead-window predicate** (`dueDate - leadDays*DAY <= now`) appears verbatim **3×**: `lib/reminders.ts:320`, `lib/manual-reminders.ts:63`, `lib/jobs.ts:192`.
- **Proposed change (incremental).** Don't merge the tables. Add **one read-only aggregator** — `lib/inbox.ts` `attentionSummary(user)` — that unions counts across Alert + Reminder + `managerReminders()` + per-domain states into a single typed list, and point the bell badge at it. First extract the lead-window predicate to `lib/reminders-shared.ts` and import it in all three sites (a 20-minute change). The unified *inbox page* can come later; the *count* is the high-value first step.
- **Impact / Effort:** High / M.
- **Classification:** Lead-window dedup = **quick win**; unified badge count = **post-launch** (fast follow).

---

### R6 — Fix `managerReminders()` recompute cost

- **Problem / evidence.** `managerReminders()` (`lib/reminders.ts:49`) runs on **every** load of `/my-branch` (`app/(app)/my-branch/page.tsx:42`) and `/fleet` (`app/(app)/fleet/page.tsx:26`). Internally it:
  - Awaits `warehouseStatus()` **inside a per-branch loop** (`lib/reminders.ts:127-141`) — a serial N+1 across branches on the all-branches view.
  - Runs ~10 more queries (vehicles, inspections, follow-ups, insurance, ATS ×3, branch docs, PTO, low-stock, manual reminders).
  - Worse, `reminderSummary()` (`lib/reminders.ts:340-349`) **runs the entire 16-kind engine just to produce five counts** — so any tile that shows "N reminders" pays the full cost.
- **Proposed change.** (a) Replace the `for` loop at `:128-141` with a single `Promise.all` over branches. (b) Give `reminderSummary()` a cheap path that runs `count()` queries instead of materializing every reminder, or memoize `managerReminders()` per request (React `cache()`) so a page that needs both the list and the summary computes once. This is contained to one file.
- **Impact / Effort:** Med–High / S.
- **Classification:** **Launch nice-to-have** (it works today; this is headroom as data grows).

---

### R7 — A shared signature/approval abstraction

- **Problem / evidence.** There are **4 signature data shapes** and **5 token schemes**, with copy-pasted capture routes:
  - Models: `PersonnelSignature` (`schema.prisma:1013`), `ScorecardSignature` (`:453`), `SignatureRequest` (`:1109`), inline `NewHireReview.{reviewer,employee,hr}Signed*` (`:1082-1090`), `DocumentAcknowledgment` (`:2057`) + `DocumentAckToken` (`:2074`).
  - Tokens: `signToken` (`:407`), `employeeToken` (`:1090`), `applyToken` (`:1736`), `SignatureRequest.token`, `DocumentAckToken`.
  - Routes: `app/api/sign/route.ts`, `app/api/review-sign/route.ts`, `app/api/scorecard-sign/route.ts`, `app/api/documents/ack/route.ts` — near-identical "validate token → check not already signed → capture name + statement → stamp" logic.
- **Proposed change (post-launch, incremental).** Extract a `lib/signing.ts` with `captureSignature({ token, signerName, agree })` that centralizes token lookup, the already-signed guard (currently duplicated 409 checks), and the timestamp stamp. Leave the four models in place; just funnel the *route logic* through one helper. A unified `Signature` table is a larger migration — do **not** attempt it pre-launch.
- **Impact / Effort:** Med / M.
- **Classification:** **Post-launch.**

---

### R8 — Email: batch the daily cron and de-duplicate the base-URL helper

- **Problem / evidence.** `/api/cron/daily` runs **7 email jobs strictly sequentially** under `maxDuration = 20` (`app/api/cron/daily/route.ts:18-24`). Each job sends **one email per item per recipient** in a loop (`lib/jobs.ts:21-35`, `:97-129`, etc.). As employee/vehicle/review counts grow, the sequential Resend round-trips risk blowing the 20-second budget and timing out the whole run (later jobs silently never execute).
  - The base-URL helper `process.env.APP_URL || process.env.NEXT_PUBLIC_APP_URL || ""` is copy-pasted at **14 sites** (`lib/threads.ts:10`, `lib/jobs.ts:10`, `app/api/pto/route.ts:22`, `app/api/review-sign/route.ts:11`, …).
  - **Branding drift:** the `lib/` tree has **21** "Canopy OS" strings and **10** "CanopyOS" (`lib/email.ts:10` uses "Canopy OS"; `lib/jobs.ts:307` uses "CanopyOS" in the same file that uses "Canopy OS" elsewhere). Managers will see both spellings in their inbox.
- **Proposed change.** (a) Extract `lib/app-url.ts` `appUrl()` and one `BRAND = "CanopyOS"` constant; replace the 14 duplicates and normalize the spelling. (b) Bump `maxDuration` on `/api/cron/daily` and/or run the 7 jobs with bounded concurrency (`Promise.allSettled`) so one slow job doesn't starve the rest. (c) Post-launch: add a per-recipient **daily digest** so a manager with 8 due items gets one email, not eight.
- **Impact / Effort:** Med / S (helper + branding); Med / M (digest).
- **Classification:** Base-URL + branding = **quick win**; cron hardening = **launch nice-to-have**; digest = **post-launch**.

---

### R9 — Central access enforcement (defense in depth)

- **Problem / evidence.** There is **no `middleware.ts`**. Authorization is enforced ad-hoc: `requireAdmin()` redirects (`lib/auth.ts:183-187`), pages call scattered predicates from a large "predicate zoo" (`isSuperAdmin`, `isTeamScopedAdmin`, `canViewExec`, `canManageSales`, `branchLocked`, `scopedBranch`, `isBoardObserver`, `canObserveBoard` — `lib/auth.ts:62-127`), and `AppShell` nav-hiding is cosmetic, not authZ. That the team **already had to close company-wide read leaks** in a "launch hardening" pass (commit `f371c4d "Launch hardening (Phase 1)… close exec leaks"`, and the "Roles & access control" row in WORKFLOWS) is direct evidence the per-page model leaks under change.
- **Proposed change (incremental, not a rewrite).** Add a lightweight `middleware.ts` that enforces the *coarse* rule only — "must be authenticated to reach `/(app)/**`; board observers and employees are confined to their allowed path prefixes" — as a backstop, while keeping the fine-grained per-page checks. Then, post-launch, add a single `assertCanView(user, resource)` helper used by both pages and routes so the predicate logic lives in one testable place (see R10).
- **Impact / Effort:** High / M.
- **Classification:** Coarse middleware backstop = **launch nice-to-have**; helper consolidation = **post-launch**.

---

### R10 — Minimal CI + unit tests on high-churn pure logic

- **Problem / evidence.** There is **no `.github/`** (no CI at all) and **no unit tests** — only 8 Playwright e2e specs (`e2e/`), two of which (`gps*.spec.ts`) test **removed** features (R3). The highest-churn, highest-risk logic is pure and trivially unit-testable but untested: the reminders lead-window predicate (`lib/reminders.ts:320`), the auth predicates (`lib/auth.ts:62-127`), ledger math (`lib/inventory.ts`), PTO business-day counting, and the anomaly thresholds (`lib/anomaly.ts`).
- **Proposed change.** Add a `.github/workflows/ci.yml` that runs `tsc --noEmit` + `eslint` + a handful of `vitest` unit tests on the pure functions above. TypeScript typecheck alone in CI would catch a large class of regressions for near-zero effort. Delete the dead GPS specs so the e2e suite is green.
- **Impact / Effort:** High / S (typecheck+lint CI) → M (unit tests).
- **Classification:** CI = **launch nice-to-have**; unit tests = **post-launch** (start with reminders + auth).

---

### R11 — Data-model hygiene (schedule, don't rush)

- **Problem / evidence.** The schema is largely healthy (75 models, 96 `@@index`, 20 `@@unique`), but two patterns will bite later:
  - **JSON-in-string columns** are pervasive: `BranchAudit.facility`/`ratings` (`schema.prisma:1318-1320`), `PersonnelRecord.details` (`:992`), `VehicleInspection.ratings` (`:828`), quiz `questions` (`:1140`), scorecard `responses` (`:1837`), checklist `items` (`:1944`). These are unqueryable and unvalidated — fine for form snapshots, risky if ever filtered/reported on. On Postgres they should be `Json` columns, not `String`.
  - **Enums-as-free-strings:** `Alert.status` ("open" | "dismissed"), `Alert.type`, `severity`, and many review statuses are plain `String` with the allowed values only in a comment (`schema.prisma:218-233`). Nothing prevents a typo'd status from silently never matching a filter. Note the schema comment on `Alert.status` lists only `open | dismissed` while routes/UI reference acknowledge states — worth a quick audit.
- **Proposed change.** Post-launch only: migrate the JSON-string columns to `Json` on Postgres (SQLite dev stays `String`), and lift the most safety-critical status strings (`Alert.status`, review statuses) into TS union types validated at the write boundary (or Prisma enums). **Do not** attempt schema migrations in the 4-day window.
- **Impact / Effort:** Med / L.
- **Classification:** **Post-launch.**

---

### R12 — Observability beyond `console` + `EmailLog`

- **Problem / evidence.** There is no error tracking (`grep sentry` → none). Production errors surface only as Vercel `console` logs; the only structured audit trail is `EmailLog` (`lib/email.ts:54-66`) and the `GpsSyncLog`-style tables. When a manager reports "check-out failed" on launch day, there's no way to see the real exception (which R1 correctly hides from the client — so it must be visible *somewhere*).
- **Proposed change.** Wire a free-tier Sentry (or a single structured `logError()` that writes to a small `ErrorLog` table) into the `withRoute` wrapper (R2). One integration point covers all routes once adopted.
- **Impact / Effort:** Med / S.
- **Classification:** **Launch nice-to-have** (pairs naturally with R1/R2).

---

## Quick wins (each < 1 day)

| Win | Where | Effort |
|---|---|---|
| Delete the 10 GPS rows from the workflow registry (closes the launch-gate breach) | `docs/WORKFLOWS.md:76-83` | S |
| Drop `leaflet`, `react-leaflet`, `@types/leaflet`; remove the global `leaflet/dist/leaflet.css` import | `package.json`, `app/layout.tsx:3` | S |
| Delete the two dead GPS e2e specs so the suite is green | `e2e/gps.spec.ts`, `e2e/gps-phase2.spec.ts` | S |
| Extract the lead-window predicate to one shared function (currently copied 3×) | `lib/reminders.ts:320`, `lib/manual-reminders.ts:63`, `lib/jobs.ts:192` | S |
| Extract `appUrl()` and replace the 14 copy-pasted base-URL helpers | 14 sites incl. `lib/threads.ts:10`, `lib/jobs.ts:10` | S |
| Normalize branding to one spelling ("CanopyOS") — 21 vs 10 today | across `lib/` | S |
| Add a `fail(e)` helper and swap it into the 5–10 most-used routes (check-in, check-out, pto, sign) to stop error leakage there first | `app/api/**` | S |
| Move `INVENTORY_ESCALATION_EMAILS` to a `Setting` with the array as default | `lib/threads.ts:85` | S |
| Fix the `warehouseStatus` serial loop → `Promise.all` | `lib/reminders.ts:127-141` | S |
| Fix `CLAUDE.md` "Three warehouses" — code ships **four** (Naples added) | `CLAUDE.md:15` vs `lib/management.ts:6-11` | S |
| Add a `.github/workflows/ci.yml` running `tsc --noEmit` + `eslint` | new file | S |

---

## Thematic architecture assessment

Five structural themes, each with a **pragmatic, incremental** migration path. The unifying principle: **add a thin shared seam, adopt it file-by-file, delete the duplication as you go** — never a big-bang rewrite.

### Theme A — API handlers are 90 copies of the same preamble

**State:** 79 routes inline `getSessionUser`, 58 inline `req.json().catch`, 57 have bespoke `catch (e)`, no `zod`, no `middleware.ts`.
**Migration path:**
1. First PR: add `lib/route.ts` (`withRoute` + `HttpError`) and `lib/http.ts` (`fail`). Zero existing routes change.
2. Convert the four hottest routes (check-in, check-out, pto, sign) as the reference implementation.
3. Every *new* route uses the wrapper. Migrate the rest opportunistically whenever a route is touched. No deadline, no coordinated cutover.
4. Optionally add `zod` schemas per route *inside* the wrapper — but only where input coercion is already fiddly (PTO, check-out). Don't zod-ify trivial routes.

### Theme B — Five "attention" systems, one badge

**State:** Alert + Reminder + computed `managerReminders()` + Threads + per-domain states, unified nowhere; the bell counts only Threads.
**Migration path:**
1. First PR: extract the lead-window predicate (dedup) + add `lib/inbox.ts` `attentionSummary(user)` that *unions counts* across the existing systems (read-only, no schema change).
2. Point `NotificationBell` at the new count endpoint.
3. Later: build a `/inbox` unified list view reusing the same aggregator.
4. Much later (optional): give Alert/Reminder a shared `sourceKey` so an event has one identity across surfaces. This is the only part that touches data, and it's last.

### Theme C — Access control is per-page, no backstop

**State:** predicate zoo in `lib/auth.ts:62-127`, redirect-based, nav-hiding is cosmetic; leaks already had to be closed once.
**Migration path:**
1. First PR: `middleware.ts` enforcing the coarse prefix rule (auth required; observers/employees confined) as a backstop — this alone would have caught the earlier exec leaks.
2. Later: a single `assertCanView(user, resource)` + `assertCanEdit(...)` that both pages and routes call, so the predicates live in one unit-tested module.
3. Keep the existing predicates as the *implementation* of that helper — no behavior change, just one call site to reason about.

### Theme D — Signatures & approvals reimplemented per feature

**State:** 4 signature models, 5 token schemes, 4 near-identical capture routes.
**Migration path:**
1. First PR: `lib/signing.ts` `captureSignature()` centralizing token lookup + already-signed guard + timestamp. Route bodies shrink to a call.
2. Leave the four models untouched — this is logic consolidation, not a data migration.
3. A unified `Signature` table is explicitly **out of scope** until well after launch, if ever.

### Theme E — Config hard-coded instead of in `Setting`

**State:** `Setting` used 15×; escalation emails, branch list, thresholds are literals.
**Migration path:**
1. First PR: escalation emails → `Setting` (correctness-critical).
2. Later: a small admin "Settings" screen backing branches + thresholds, each with the current constant as the fallback default. The price-increase threshold (`lib/anomaly.ts:18-24`) is already the pattern to copy.

---

## What NOT to do (over-engineering traps)

Given a small team and a 4-day runway:

1. **Do not unify the five attention systems into one table before launch.** The *count aggregator* (read-only) is the 80/20 win; merging `Alert` + `Reminder` schemas is a data migration with acknowledgment/dismissal semantics to preserve — post-launch, carefully.
2. **Do not build a single `Signature` table now.** Four models with live tokens and acknowledgment history in production is a migration minefield. Consolidate the *route logic* (R7), not the data.
3. **Do not migrate the JSON-string columns this week.** They work; they're form snapshots. Postgres `Json` migration is a scheduled post-launch task (R11), not a launch item.
4. **Do not add zod everywhere at once.** Add it only where coercion is already error-prone (PTO, check-out), inside the wrapper. Blanket schema validation on 91 routes is churn without payoff.
5. **Do not attempt a real auth framework (NextAuth, RBAC library) pre-launch.** The scrypt sessions in `lib/auth.ts` are sound. A coarse `middleware.ts` backstop is the right-sized fix; a framework swap is not.
6. **Do not "clean up" the deploy `runStep` isolation.** It looks defensive but it's earned — it's the reason a bad seed can't blank the DB. Leave it (and extend the same pattern if new seeds are added).
7. **Do not rewrite the reminders engine.** It's correct and readable; it just needs the `Promise.all` fix and a cheap summary path (R6), not a redesign.

---

## Appendix — launch checklist derived from this review

**Before launch (blockers + high-value nice-to-haves):**
- [ ] R1 — stop leaking `e.message` (at minimum on check-in/out, pto, sign, review-sign)
- [ ] R3 — reconcile WORKFLOWS.md GPS rows (launch-gate) + drop leaflet deps/CSS + delete GPS specs
- [ ] R4 — escalation emails → `Setting`
- [ ] Quick wins: lead-window dedup, `appUrl()`, branding normalize, warehouse `Promise.all`, `CLAUDE.md` warehouse count
- [ ] R10 (partial) — CI running `tsc --noEmit` + `eslint`
- [ ] R12 — one error-tracking sink so hidden errors are visible to engineering

**Fast-follow (weeks 1–4 post-launch):**
- [ ] R2 — `withRoute` wrapper + migrate hot routes
- [ ] R5 — unified attention badge count
- [ ] R6 — reminder summary cheap path / request memoization
- [ ] R8 — daily digest emails + cron concurrency
- [ ] R9 — coarse `middleware.ts` backstop

**Scheduled (quarter):**
- [ ] R7 — shared signing helper
- [ ] R9 — `assertCanView` consolidation + auth unit tests
- [ ] R11 — JSON→Json columns + status unions

---

## Update — implemented (2026-09-28, overnight)

The entire **Before launch** checklist plus most **fast-follow** items shipped to `main`:

**Done**
- **R1 — error leakage.** `lib/http.ts` (`fail()` + `HttpError`) logs every error server-side and returns safe messages (Prisma/internal → generic 500; intentional validation messages preserved). Swept all **42** raw-`e.message` route returns + the unauthenticated login route.
- **R3 — GPS reconcile.** Deleted the 8 stale GPS rows + fixed the summary counts and the driver-assignment mentions in `WORKFLOWS.md`; dropped `leaflet`/`react-leaflet`/`@types/leaflet`, the global leaflet CSS import, the dead "GPS" column, the dead `STATUS_META`/`lastSeen`, and the two GPS e2e specs.
- **R4 — escalation config.** Inventory-escalation recipients now read from the `inventory_escalation_emails` Setting (default seeded, admin-editable via the settings API, which is now **admin-gated**).
- **R6 (part) / R8 (part).** Warehouse status checked with `Promise.all`; the daily cron runs its 7 jobs with `Promise.allSettled` (`maxDuration` 20→60).
- **R9 — coarse backstop.** `proxy.ts` (Next 16's renamed middleware) redirects signed-out visitors off app pages.
- **R10 — CI.** `.github/workflows/ci.yml` runs `tsc --noEmit` (hard gate) + `eslint` (informational until the pre-existing lint backlog clears).
- **R12 (minimal).** `fail()` logs all API errors to the server (visible in Vercel logs) — the "one sink." Sentry remains a drop-in upgrade inside `fail()`.
- **Quick wins.** Lead-window predicate deduped (`lib/reminders-shared.ts`); base-URL helper deduped to `appUrl()` (13 sites); branding normalized to "CanopyOS"; `CLAUDE.md` warehouse count fixed (three→four).

**Deliberately deferred (post-launch, per the "what NOT to do" guidance above)**
- **R2 (full wrapper adoption)** — `fail()` already delivers the security win; the `withRoute` migration of ~90 routes is post-launch churn.
- **R5 — unified attention badge** — high-value but the count would ride the 2-min notification poll; wants the cheap-count path (R6 full) and testing against the running app first.
- **R7 — signing consolidation**, **R11 — JSON→Json columns / status enums**, and **unit tests** — scheduled work, not launch-week changes.
