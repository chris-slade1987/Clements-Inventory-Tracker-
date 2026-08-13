# Manager Bonus Scorecard — Review & Automation Plan

Review of the quarterly branch-manager bonus scorecard and how to build it into
the platform. Current card: 10 metrics, **binary Met/Not-Met**, weighted to 100%.

| Metric | Weight | Direction | Auto-scorable today? |
|---|---|---|---|
| Production | 15% | higher better | ✅ from MBR budget |
| Unserviced % | 15% | lower better | ❌ needs source (routing) |
| Annual Value of Total Sales | 15% | higher better | ✅ from MBR budget |
| Annual Value of Cancellations | 15% | lower better (ceiling) | ✅ from MBR budget |
| Fuel Cost % of Production | 10% | lower better | ✅ from MBR budget |
| Chemical Cost % of Production | 10% | lower better | ✅ (prefer consumption-based) |
| Vehicle Inspection Reports | 5% | complete | ❌ needs source / manual |
| Warehouse Inspection Reports | 5% | complete | ❌ needs source / manual |
| Quality Control Reports | 5% | complete | ❌ needs source / manual |
| Onboarding / CEU Training | 5% | complete | ❌ needs source / manual |

## Key recommendations

1. **Move financial/cost/production metrics from binary to tiered partial credit;
   keep compliance items binary.** Binary creates cliff effects (99% of target
   pays the same as 60%), concentrates gaming at the threshold, and makes payouts
   swing on noise. Suggested tiers (higher-is-better): <90% = 0%, 90–99% = 50%,
   100–109% = 100%, ≥110% = 120% (capped); invert for lower-is-better.
2. **Decide the payout mechanic:** weighted score → % of a target bonus pool
   (smooth, recommended) vs. a discrete table. Consider **gates**: a safety or
   lapsed-licensing failure caps the whole bonus.
3. **Trim financial redundancy.** Production, Total Sales, and Cancellations all
   track net recurring revenue — the plan may pay 3× for one outcome. Confirm they
   measure genuinely different things or consolidate and reallocate weight.
4. **Counterbalance the cost-ratio gaming risk.** Fuel % and Chemical % as a % of
   production can be "hit" by under-treating (skipping/under-dosing), which later
   shows as callbacks and cancellations. Add **callback/redo rate** and
   **customer retention rate** as guardrails.
5. **Chemical cost should be consumption-based** (truck check-OUTs), not purchases
   — bulk buys distort a quarter. This app already tracks movements, so this is
   feasible and more accurate.
6. **Cancellations: confirm it's a not-to-exceed ceiling**, express as a
   retention/attrition **rate** alongside $ so branch size is normalized.

## Definitions to pin down (per metric)
- **Production** — serviced recurring revenue vs. annualized new-sale value? gross/net? recurring only or incl. one-time? branch attribution (service location vs. billing)?
- **Unserviced %** — numerator (missed only? incl. reschedule/weather/no-access?), denominator (all scheduled? recurring only?), visits or $, source of truth (route software, GPS-verified?), target %.
- **Annual Value of Total Sales** — annualized recurring contract value of new agreements? net of never-started cancels? new logos only or incl. upsells?
- **Annual Value of Cancellations** — confirm lower-is-better ceiling; define cancellation (voluntary/non-pay/move; net of win-backs); $ or rate.
- **Fuel %** — denominator production vs. total revenue? normalize for fuel-price swings?
- **Chemical %** — which SKUs; **consumption (check-outs) vs. purchases**; handle inventory build/draw.
- **Vehicle / Warehouse / QC Inspections** — cadence, "complete" definition, pass threshold (100% vs ≥95%), source. For QC: score completion or pass-rate/results (recommend results).
- **Onboarding/CEU** — whose training (techs/manager/both), % current vs. module count, LMS vs. manual, threshold; consider making lapsed licensing a **gate**.

## Additions a best-in-class field-services scorecard would include
Retention rate (top priority), callback/redo rate (counterbalance to cost gaming),
online reviews (volume + stars), AR/collections (% current / DSO), technician
turnover; treat **safety** and **licensing** as gates. Keep total to ~10–12 lines.

## Live in-app scorecard (the manager's ask)
Per-metric row: name, weight, direction, **Target / Actual-to-date / % of target**,
**projected end-of-quarter (run-rate)**, tier chip (Not Met/Threshold/Target/Stretch),
**points earned vs available**, pace-vs-plan indicator. Header: composite score to
date + projected composite + **estimated payout at current pace**, data-provenance
per metric (Auto vs. Manual/awaiting entry), stale-data flags. Drill-down to monthly
numbers. Manual-entry/attestation path for the 5 non-integrated metrics. Freeze +
capture signatures at quarter close (immutable record). Mobile-first.

## Open decisions for the owner
**Scoring:** binary vs tiered? payout mapping (pool % vs table)? any gates?
target bonus amount and does it vary by branch size?
**Unserviced %:** formula, visits vs $, source system, target %.
**Inspections/QC/CEU:** cadence, threshold, source (or manual for now); QC = completion vs results; CEU scope; licensing as a gate?
**Financials:** Production vs Total Sales distinct or consolidate? Cancellations ceiling + definition + add retention rate? Fuel/Chemical denominator + fuel-price normalization + chemical consumption-based? Branch attribution rule?
**Additions:** add retention, callback rate, reviews, AR, tech turnover? safety as a gate? (rebalance weights to 100%).

## Sign-off delivery & recovery (as built)

When a supervisor **publishes** a scorecard, the branch manager is emailed a
secure, no-login link (`/scorecard-sign/[token]`) to review and sign; the manager
can also sign in-app from **My Branch › Scorecard**. Email is sent through
`sendManagerSignEmail` (`lib/scorecard.ts`) and **every attempt is logged to
`EmailLog`** — sent, `skipped_no_provider` (no `RESEND_API_KEY`),
`skipped_no_address` (no manager email on file), or `error` (provider rejected,
e.g. an unverified sending domain).

To ensure a silent email failure can never strand a review, the admin's published
panel always shows the manager's resolved email, the **last delivery status**, and
a **copyable secure sign link**, plus two recovery actions:

- **Resend signature email** (`resend`) — reuses the live `signToken` (mints a new
  one only if it was cleared) and re-emails the manager, reporting the send status.
- **Un-publish to edit** (`unpublish`) — returns a still-unsigned review from
  `final` to `draft`, clearing the supervisor signature + token so it can be
  corrected and re-published. (The archived case is still handled by `reopen`.)

**Sandbox testing without a verified domain:** set `EMAIL_FROM` to
`onboarding@resend.dev` and `EMAIL_TEST_REDIRECT` to your own address — every
outbound email is then rerouted to that one inbox (original recipient preserved in
the subject, e.g. `[test → jcolontrelle@…] Signature needed…`), so the full
publish → sign → finalize → HR-bonus flow can be exercised end-to-end without
touching personnel data. Remove `EMAIL_TEST_REDIRECT` (and verify a real domain)
to send to actual recipients.

Prerequisites for live delivery are environment config, not code: `RESEND_API_KEY`
with a **verified sending domain** and a correct `HR_EMAIL`. `APP_URL` is
preferred for the link origin, but is **no longer required** — the sign link now
falls back to the live request host, so both the emailed link and the admin's
copyable link are always absolute. Delivery is auditable at
**`/management/email-log`** (admin only).

## Bonus payout (as built)

The quarterly manager bonus is a fixed **$1,500** pool (`MANAGER_BONUS_TARGET`)
paid **linearly by weighted score** (`bonusEarned` = `round(score/100 × 1500)`):
a 75% card earns **$1,125**, a 100% card earns the full $1,500. The dollar figure
is shown on the manager's sign page header (next to the score %) and spelled out
in the HR bonus email's subject and body, so payroll can act on it directly. This
resolves the "target bonus amount" open decision below; the payout mapping is the
smooth pool-% approach (not a discrete table), with no gates wired yet.
