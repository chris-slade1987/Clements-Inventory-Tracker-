# CanopyOS — Navigation & Information-Architecture Audit

Audit date: 2026-10-25. Scope: (1) consolidate the Executive area into one dashboard;
(2) a full navigation audit to make the portal easier to navigate and show data in
fewer places — **without jamming unrelated things together**. Grounded in `lib/nav.ts`,
`components/AppShell.tsx`, `lib/access-catalog.ts`, and the `/management`, `/executive`,
`/field-ops`, `/hr` pages.

---

## Part 1 — The Executive area: four dashboards slicing one dataset

### What's there today
Five+ separate pages all read the **same Monthly Board Report (MBR)** dataset and show
overlapping headline numbers (revenue, EBITDA, book value, per-branch production):

| Page | Nav label | What it is | Overlap |
|---|---|---|---|
| `/management` | "Company & Branch KPIs" | Operating budget-vs-actual KPIs (role-scoped) | headline KPIs, branch production, sales funnel |
| `/executive` | "Executive — Operating" | Leadership operating read + branch P&L + FY forecast | ~same as `/management`, leaner |
| `/management/board` | "Board — Financial statements" | Full P&L / balance sheet / cash flow / SG&A | headline KPIs, book value |
| `/management/benchmarking` | "Branch Benchmarking" | Cross-branch league of the same metrics | per-branch production, pacing |
| `/management/sales` | "Sales & Attrition" | Sales pipeline + attrition/revenue | funnel also on `/management`; team hub at `/sales` |
| `/management/insights` | "Insights" | AI Q&A over the same data | duplicates the always-docked Canopy Copilot |

**The structural problem:** the "Executive" center button points at `/executive`, while
the near-identical `/management` is deliberately routed into the "Company" center. Two
almost-identical operating dashboards in two different centers with three confusingly
similar names ("Executive — Operating," "Company & Branch KPIs," "Board — Financial
statements") is exactly why it "feels separated."

### Recommendation — ONE Executive dashboard, tabbed

Collapse the four KPI dashboards into a single `/executive` with a tab bar (one page,
one URL, role-scoped):

- **Overview** — headline KPIs, pacing to budget, FY forecast, the sales funnel snapshot. (= today's `/management` + `/executive` summary.)
- **Branches** — per-branch P&L + the cross-branch benchmarking league together. (= `/executive` branch P&L + `/management/benchmarking`.)
- **Financials** — full P&L, balance sheet, cash flow, SG&A detail, book-value trend. (= `/management/board`.)
- **Sales & Attrition** — pipeline + attrition. (= `/management/sales`.)

Then:
- **Insights → the docked Copilot.** Retire the standalone `/management/insights` page; its "Insights" nav item opens the Copilot (already on every screen). One AI entry point, not two.
- **`/management` and `/management/board` become redirects** into `/executive?tab=…` (preserve bookmarks). `/management/branch-pnl` is already a dead redirect — drop it from nav.
- **Role-scoping is preserved inside the one dashboard:** a branch manager who opens it sees their branch (as `/management` does today); execs see company-wide with the branch switcher. No one loses a view — they just stop living on four pages.

**Result:** the Executive center goes from ~13 nav items to ~5 (Executive dashboard,
Scorecards, Branch Audits, Compliance, People/HR), and the "Executive vs Company KPIs"
split disappears.

---

## Part 2 — Full navigation audit (make it easier; don't jam)

### A. The URL tree doesn't match the centers (biggest navigability issue)
Many `/management/*` pages are routed by `AppShell` into a *different* center than their
URL implies, which is disorienting:

| Page (URL) | Routed to center | Really belongs to |
|---|---|---|
| `/management/training*`, `/management/certifications*` | Company | **Training Center** (own module) |
| `/management/documents`, `/management/intake` | Company | Documents (Company) — but two entries for one tool |
| `/management/people/*` | mixed | **People / HR** (own module; `/hr` is its real home) |
| `/management/email-log`, `/management/login-audit` | management | **Settings & Admin** |
| `/management/system-map` | management (Executive) | **Settings & Admin** (admin utility) |

**Recommend:** align URLs to their module over time (e.g. People under `/hr` or `/people`,
admin logs under `/settings`). Lower-risk first step: keep URLs but fix the **nav grouping
+ labels** so each item appears under the center it behaves like. This removes the "why is
this under Executive?" confusion without a URL migration.

### B. Fold *related* things (never unrelated)
- **Insurance → a tab in the Compliance Command Center.** Both are licenses / policies /
  renewals; they already overlap. One "Compliance & Insurance" home with a Renewals view.
- **Document Intake → one entry.** `/management/intake` and the Documents "Add" tab are the
  same component — keep only the Documents "Add" tab; drop the separate Intake nav item.
- **Sales, made unambiguous (two surfaces, clearly split):** `/sales` = the **Sales Team**
  operations hub; the **Sales & Attrition** metrics become the Executive dashboard's Sales
  tab. The funnel stays on the Executive Overview. No third standalone sales page.

### C. Keep the command-center landing pattern — it's the model
`/field-ops` and `/hr` already do the right thing: a role lands on **one page that rolls up
their whole domain** (queues + status) and links into the detail. This is "see the data in
fewer places" done well. Recommend making this the template — and the new consolidated
**Executive dashboard is the leadership command center** in the same spirit. Branch Command
(the manager's weekly cockpit) is the manager equivalent. Don't break these up.

### D. Thin / low-value pages
- `/management/insights` — fold into Copilot (above).
- `/management/system-map` — keep for admins, move to Settings; not an Executive nav item.
- `/management/branch-pnl` — legacy redirect; remove from nav (keep the redirect).

### E. Naming & labels
Several near-duplicate labels ("Executive — Operating," "Company & Branch KPIs," "Board —
Financial statements," "Branch Benchmarking") collapse into tab names under one "Executive"
dashboard (Overview / Branches / Financials / Sales). Clearer and fewer.

### F. What NOT to merge (deliberately kept separate)
Per the directive — don't combine unrelated things just to cut pages:
- **Inventory**, **Fleet**, **Routing Approval**, **Weather Ops**, **SOPs**, **Scorecards**,
  **Branch Audits** stay distinct — they are different jobs, not slices of one dataset.
- **Branch Command** stays the manager weekly cockpit; it is not merged into the Executive
  dashboard (different audience + the forced weekly sign-off).
- **People/HR** stays its own module (consolidating its *landing* into `/hr` is fine; the
  roster/ATS/PTO detail pages remain).

---

## Proposed before → after (nav count)

| Center | Today | After |
|---|---|---|
| Executive | 13 items (4 KPI dashboards + sales + insights + audits + scorecards + compliance + insurance + system-map + people + oversight) | ~5 (Executive dashboard [tabs: Overview/Branches/Financials/Sales] · Scorecards · Branch Audits · Compliance & Insurance · People/HR) |
| Company (My Branch) | 14 | unchanged (already coherent) |
| Inventory / Fleet | lean | unchanged |

---

## Phased implementation (low-risk first)

- **P1 — Executive consolidation (the ask):** build the tabbed `/executive` (Overview /
  Branches / Financials / Sales) by composing the existing page bodies as tab panels;
  redirect `/management` + `/management/board` into it; collapse the Executive nav to the
  5 items. Role-scoping preserved. Highest value, self-contained.
- **P2 — Dedupe + fold related:** Insights→Copilot; Insurance→Compliance tab; single Intake
  entry; drop branch-pnl/system-map from Executive nav. Update `lib/access-catalog.ts` +
  `lib/access-paths.ts` + `lib/nav.ts` in lockstep (per CLAUDE.md).
- **P3 — URL/module realignment:** move admin logs to Settings; consider People under `/hr`.
  Larger (URL migration + redirects) — do last, behind redirects.

Each phase ships independently with CI green and the access-catalog/nav kept in lockstep.
