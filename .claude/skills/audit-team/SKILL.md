---
name: audit-team
description: >-
  Run the Agent Audit Team — a standing panel of parallel, read-only domain
  auditors that first read the repo's git history + docs/WORKFLOWS.md + prior
  audit reports to understand what's already been built and improved, then
  surface prioritized UX and workflow enhancements for the Clements portal and
  save a dated report that future audits build on. Use whenever the user asks to
  "run an audit", "audit the site", "run the audit team", review the app for
  improvements, or wants enhancement/insight ideas for what to build next.
---

# Agent Audit Team

A repeatable, continuous-improvement audit. The team is **read-only** — it
diagnoses and recommends; it never edits, writes app code, or commits (except
the audit report file). Implementation only happens if the user then asks.

## The roster
Spawn these four domain auditors **in parallel** (one message, multiple `Agent`
calls, background, `general-purpose`). Refer to them collectively as the
**Agent Audit Team**; name each member in your summary so the user can follow up:

1. **Nav & UX Auditor** — navigation, information architecture, access/roles,
   and cross-cutting UX quality (empty/loading/error states, forms, a11y,
   mobile, consistency of `components/ui.tsx`, PWA). Core files: `components/AppShell.tsx`,
   `lib/nav.ts`, `lib/access*.ts`, `app/(app)/layout.tsx`, `lib/auth.ts`.
2. **Inventory & Fleet Auditor** — `app/(app)/check-in|check-out|reconcile|inventory|reports|alerts|dashboard/**`,
   `/manage/**`, `app/(app)/fleet/**` and their libs. Core rule: on-hand = SUM(stock_movements).
3. **Management & Sales Auditor** — `app/(app)/management/**` (KPI dashboard, scorecards,
   audits, insights, board, sales/attrition), `app/(app)/executive/**`, the Sales Team
   module (`app/(app)/sales/**`, `app/(app)/me/sales/**`, `components/GoalPlanner.tsx`,
   `FocusPlan.tsx`, `SalesFunnelCard.tsx`, `BranchDashboard.tsx`, `lib/sales*.ts`,
   `lib/branch-pnl.ts`, `lib/management.ts`).
4. **People & Self-Service Auditor** — `app/(app)/hr/**`, `app/(app)/management/people/**`,
   `app/(app)/reviews/**`, the Employee Hub `app/(app)/me/**`, training
   (`app/(app)/management/training*/**`, `lib/training*.ts`), onboarding, and the
   PTO/handbook/ATS libs.

## Process (every run)

### 1. Establish history first (so the team builds on prior work, not re-litigates it)
Before spawning, gather the context every auditor must read, and pass it into each prompt:
- `git log --oneline -40` (and `git log --since=<last audit date>` when a prior audit exists) — what shipped recently.
- `docs/WORKFLOWS.md` — the workflow registry + reconciliation status (✅ aligned · ⚠️ stale · ❌ contradicts · 🆕 missing). Open ⚠️/❌/🆕 rows are prime audit targets.
- `docs/audits/` — every prior audit report. The newest is the baseline: the team must note, for each prior recommendation, whether it is now **Done / Partially done / Not done / Superseded**, and must NOT re-recommend shipped work as if new.
- `docs/PUNCH_LIST.md`, `docs/ENHANCEMENT-REVIEW.md` if present.

Tell each auditor: "First read the history context above; then audit YOUR domain for genuinely new UX/workflow improvements; explicitly flag the status of any prior recommendation in your area."

### 2. Each auditor returns (strict format)
For every finding: (1) one-line title, (2) why it hurts the user/workflow, (3) file(s), (4) concrete suggested improvement, (5) effort **S/M/L**. Grouped by area. Then **Top 5 highest-impact** and **Top 5 quick wins** for the domain, plus a short **"status of prior recommendations"** list. Honest and specific; skip trivial nitpicks; stay in-domain (no overlap).

### 3. Lead synthesis (you)
When all four report:
- De-duplicate and merge into **one ranked plan**: a **Now / Next / Later** (or P0/P1/P2) list by impact-vs-effort, each item one line with its domain + effort, plus a short **Quick wins** block and a **Prior-recommendation status** roll-up (what's been done since the last audit — the "what improvements we've made" view the user asked for).
- Keep the chat summary tight (the top ~10–15 items); put the full detail in the report file.

### 4. Save the report (the audit trail = continuity)
Write the full synthesized report to **`docs/audits/YYYY-MM-DD-audit.md`** (use today's date; add `-2`, `-3` if multiple in a day). Structure:
```
# Site Audit — <date>
Baseline commit: <git short sha>   ·   Prior audit: <filename or "none">
## Progress since last audit (what we shipped / fixed)
## Ranked plan — Now / Next / Later
## Quick wins
## Full findings by domain
## Prior recommendations — status (Done / Partial / Not done / Superseded)
```
This file is what the next run reads to know what's been improved. Tell the user the report's path and offer to implement the top items. Committing the report is optional tooling (develop on the project's working branch); it does not require a deploy.

## Guardrails
- Read-only diagnosis. No app-code edits, no schema changes, no commits beyond the report — unless the user explicitly says "implement".
- Respect `docs/BRAND_KIT.md` and `CLAUDE.md`/`AGENTS.md` conventions when proposing UI changes (and remember the sanctioned sales-module emoji exception).
- Don't duplicate work already in flight (check running agents / recent commits).
- Favor high-signal, implementable recommendations over exhaustive nitpicking.
