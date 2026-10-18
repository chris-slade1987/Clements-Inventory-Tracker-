# Notes, Tasks & Projects — research + proposal

*CanopyOS · prepared for leadership + build · 2026-10-18*

An all-in-one place for anyone at Clements to capture **notes**, create **tasks with
deadlines**, assign them to people, and group them into **projects** that are tracked
and shared — without bolting on a separate project-management tool. This researches how
ServiceNow, Salesforce, and SAP solve it, pulls out the patterns worth copying, and
proposes a design that fits what Canopy already has.

---

## 1. How the big platforms do it

### ServiceNow — "everything is a Task," projects group tasks, one "My Work" inbox
- The core abstraction is a universal **`task` table**: incidents, problems, changes, project tasks and more all *extend* it, so assignment, due dates, state, priority, and work notes behave the same everywhere.
- **Project Portfolio Management (PPM/SPM)** adds **Projects** that contain **project tasks** with planned start/end dates; task status auto-colors green/yellow/red by proximity to the due date (with manual override).
- **"My Work"** is a single workspace showing every item assigned to you across apps (project tasks, incidents, etc.), with overdue widgets and date filters. Only things that extend the Task table show up there — the payoff of one primitive.

### Salesforce — Tasks as a first-class "Activity" on any record; Slack Lists for lightweight projects
- A **Task** (one of the "Activities," with Events) carries subject, due date, priority, status, comments, an assignee, and can be **linked to any record** (contact, account, custom object). Tasks roll up into an activity timeline and into reports/dashboards of open work.
- Salesforce has no heavy native PM; lightweight project tracking increasingly lives in **Slack Lists** — a template with **Task · Status · Assignee · Due Date** columns, saved views that filter/sort by due date, and the ability to **turn any message into a list item**.
- The Slack↔Salesforce link pushes **real-time alerts** on task assignment, status changes, and due-date changes.

### SAP — a unified Task Center inbox, lightweight Ruum, heavyweight Project System
- **SAP Task Center** is a **unified inbox** that aggregates tasks and approvals from across the suite (S/4HANA, SuccessFactors, Concur, Ariba, Build Process Automation) into one place to search, filter, and act on — or jump to the source app.
- **SAP Ruum** is the lightweight, no-code project/task tool (boards, checklists, automations) — the "all-in-one organizer" end of SAP's range.
- **SAP Project System (PS)** / S/4HANA Project Management is the heavyweight end: work-breakdown structures, milestones, scheduling, cost — more than an internal ops portal needs.

### The patterns worth copying
1. **One universal task primitive.** A single Task record everything can be — a standalone to-do, a project task, or an item spun off a record — so tracking, assignment, and due dates work identically everywhere (ServiceNow).
2. **Projects group tasks.** A lightweight project with an owner, members, a due date, and a progress roll-up (all three).
3. **A unified "My Work" / Task Center.** One screen for everything assigned to me, with overdue/upcoming and date filters (ServiceNow + SAP).
4. **Assignment drives notification.** Assign → the assignee is alerted; due-date and status changes alert too (Salesforce + Slack).
5. **Capture from anywhere.** Turn a message/record/finding into a task in one click (Slack Lists, ServiceNow).
6. **Stay lightweight.** Ruum, not Project System — boards and checklists, not Gantt-and-cost, for an ops team.

---

## 2. Why Canopy is already most of the way there

This isn't a new silo — it's the **connective layer** over machinery we already shipped:

| Leader pattern | Canopy already has |
|---|---|
| Universal task primitive | task-shaped records everywhere (SOP assignments, checklist items, reminders, focus-plan actions, audit follow-ups) — ready to generalize |
| Unified "My Work" inbox | the **unified Needs-attention model** (Theme 3) + the role command centers + the **operating-rhythm ribbon** |
| Assignment → notification | the **Inbox spine** (`postSystemThread`) + email amplifier (shipped with the Copilot/HR work) |
| Deadlines chased automatically | the **detect-then-act nudge engine** + daily cron |
| Activity log / work notes | the **coaching-thread pattern** (`SalesFocusComment`, `ScorecardComment`) |
| Capture from anywhere | the **Canopy Copilot** ("add a task," "what's on my plate") + inline `<AskCanopy>` entry points |

So the build is mostly: add the **Task + Project** models, a **My Work hub**, and **wire them into the four systems above** — not invent a PM tool from scratch.

---

## 3. Proposed design

### Data model (additive, `prisma db push`-safe, nothing hard-deleted)
- **`WorkItem`** (the universal task) — `id, title, notes?, status (todo|in_progress|blocked|done|cancelled), priority (low|normal|high|urgent), creatorId, assigneeType (person|branch|role), assigneeId?, branch?, startDate?, dueDate?, projectId?, sourceType?/sourceId? (what it spun off from), order, completedAt?, createdAt, updatedAt`.
- **`Project`** — `id, name, description?, ownerId, status (active|on_hold|done|cancelled), dueDate?, branch?, color?, createdAt`.
- **`ProjectMember`** — `projectId, userId, role (owner|member|viewer)`.
- **`WorkItemComment`** — the notes/activity log on a task (mirrors `SalesFocusComment`); status changes can post a system entry so the thread is the audit trail. (Projects can reuse the Inbox thread for discussion.)

### Surfaces
- **"My Work" hub** (new universal top-nav item for everyone): everything assigned to me — standalone + project tasks + items spun off records — grouped **Overdue · Today · This week · Upcoming · Done**, list view first (board later). The ServiceNow My-Work / SAP Task-Center pattern.
- **Projects**: a projects list + a project page (its tasks, members, owner, due date, a simple progress bar). **"Send to people" = add members + assign their tasks**, which notifies them (Inbox + email) and gives them a shared in-portal project page — no external PM tool.
- **Quick capture**: a global **"+ New task"**; **"Add to tasks / a project"** from a record or an audit finding; and the **Copilot** creates tasks/projects on request (propose → you confirm).
- **Notes**: a personal notes space (lightweight) where a note can be promoted to a task with a due date — so "jot it down" and "track it" are one tool.

### Integration (the all-in-one glue)
- **Needs-attention + rhythm ribbon** — assigned tasks and due projects flow into "what needs me today" on every role's command center (register a task source, exactly like we did for SOPs).
- **Inbox + email** — assignment, reassignment, due-soon, overdue, and completion route through `postSystemThread` + the email amplifier.
- **Nudges + cron** — due dates drive the existing daily nudge engine (due-soon reminder, overdue escalation to the assigner), idempotent and dismissible.
- **Copilot** — a `get_my_work` read tool and a `create_task` / `create_project` **action** (human-in-the-loop: the Copilot drafts, you confirm) so "remind me to…", "assign this to Marcus by Friday," and "what's on my plate this week?" all work in the panel.

### Guardrails (consistent with the vision)
- **Assigning to a person notifies them** (outward-facing) — intended, but **access-scoped**: anyone creates personal tasks + projects; assigning to *others* / cross-branch is role-gated (managers → their branch team, super-admins → anyone). Access-catalog entry for the new pages, in the same change.
- **Append-only** activity; tasks are **cancelled/archived, never hard-deleted** (ledger discipline).
- **Lightweight by charter** — list + board + reminders, not Gantt/cost/dependencies. Be the organizer, not a second ERP PM module.

---

## 4. Scope — v1 vs. later
**v1 (recommended):** `WorkItem` + `Project` + `ProjectMember` + `WorkItemComment`; the **My Work hub** (list, grouped by due horizon); **projects list + project page** with assign-and-notify; **quick-add** + record→task capture; **Copilot create/query**; and the **Needs-attention + Inbox + nudge** wiring. Notes space as a light add-on.

**Later:** board (kanban) + drag-reorder; milestones/sub-tasks/dependencies; recurring tasks; saved views/filters; project templates (e.g. "new-vehicle onboarding" seeded from an SOP); calendar view; cross-branch portfolio roll-up for leadership.

---

## 5. Decisions needed before build
1. **v1 depth** — lightweight (My Work list + projects + assign/notify + Copilot), or also a **kanban board** in v1? *(Recommend: lightweight first; board next.)*
2. **Who can assign to whom** — anyone→anyone, or **scoped** (managers→their team, leadership→anyone)? *(Recommend: scoped.)*
3. **Placement / name** — a universal top-nav **"My Work"** for everyone + a **Projects** area (recommended), vs. folding it into the Employee Hub.
4. **Notes** — include the lightweight personal-notes space in v1, or tasks/projects only to start?

---

*Bottom line: the leaders all land on one task primitive, projects that group it, a single "my work" inbox, and assignment that notifies — and Canopy already owns the inbox, the nudges, the needs-attention queue, the activity-thread pattern, and the Copilot to drive it. Phase 1 is adding the Task + Project records and a My Work hub, then plugging them into those systems so it's genuinely all-in-one rather than a bolt-on.*
