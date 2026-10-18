# Canopy Copilot — Phase 1 Plan

*CanopyOS vision Theme 5 · prepared for leadership + build · 2026-10-18*

The in-site assistant that any Clements user can ask — grounded in the company's
own manual, handbook, SOPs, training and live data, context-aware to the screen
and the person, and able to guide, draft, and (with a confirm step) complete real
work. This plan is the first shippable slice. It builds on the concept the COO
approved (docked panel, positive-first prompts, real logo, cite-everything).

---

## 1. What Phase 1 delivers (and what it defers)

**Delivers**
- A **docked "Ask Canopy" panel available to everyone**, role- and branch-scoped (today's `InsightsWidget` is leadership-only + KPI-only — this replaces it).
- A **knowledge base** over the core documents (Manager Manual, Employee Handbook, SOPs, Brand Kit) with **continuous re-indexing** when those change.
- **Live-data tools** so answers use real numbers (branch KPIs, what's-due, SOP status, metric definitions) — read-only and access-scoped.
- **Guide + draft + submit**, with a mandatory **preview-and-confirm** before any write; sensitive documents (write-ups, accident reports) are drafted and the real form is opened pre-filled for the manager to submit.
- **Citations on every grounded answer**, a **cite-or-decline** rule (no ungrounded guessing), and a **deterministic fallback** when no AI key is set.
- **Conversation logging + feedback + a "knowledge gaps" report** (the improvement loop).
- The four positive-first launch prompts from the approved concept, plus inline "Ask Canopy" entry points on the top workflows.

**Defers to Phase 2 / 3** (named here so scope stays honest)
- Phase 2: ingest **all** training-course bodies + every uploaded document + bulletins; richer tool set; the gaps report feeding content creation.
- Phase 3: the **field-diagnosis copilot** for technicians (entomologist + FL-482 skills), form **pre-fill + autonomous submit** for low-risk actions, photo-in help, voice.

---

## 2. Decisions carried in from the COO (already made)
- **Access model:** global "Ask Canopy" button for everyone **plus** context-aware inline entry points.
- **Capability ceiling:** guide + draft + submit — with the submit always behind a human preview/confirm.
- **Knowledge scope:** all company materials, **access-scoped** per user (refined below so sensitive personnel data is reached through live tools, never embedded in the shared index).
- **Tone & brand:** lead with the productive/positive; professional; real CanopyOS brand kit; no emoji (this is not the sales-motivation module).

---

## 3. Architecture at a glance

```
            ┌──────────────── Ask Canopy panel (every role) ───────────────┐
            │  suggested prompts · context chip · chat · citations · confirm │
            └───────────────┬──────────────────────────────────────────────┘
                            │  POST /api/copilot  (streaming, auth = requireUser)
                            ▼
        ┌─────────────────── agent loop (server) ───────────────────┐
        │ 1. resolve user role/branch/grants + current screen        │
        │ 2. RETRIEVE: embed question → top-k KB chunks, access-filt. │
        │ 3. TOOLS: Claude may call read-only, scoped data tools      │
        │ 4. ANSWER with citations; propose actions as confirm cards  │
        └───────┬───────────────────────────┬───────────────────────-┘
                │                            │
     ┌──────────▼─────────┐      ┌───────────▼───────────────┐
     │ Knowledge base      │      │ Live-data tools (existing  │
     │ KnowledgeChunk +    │      │ libs, scoped): metrics,    │
     │ embeddings (pgvector│      │ benchmarking, needs-       │
     │ in prod / FTS local)│      │ attention, SOP, scorecard, │
     │ ← continuous ingest │      │ people (perm-gated)        │
     └─────────────────────┘      └────────────────────────────┘
```

Two grounding layers, as described to the COO: **documents** (the knowledge base,
continuously re-indexed) and **live data** (tools). The model never answers from
general knowledge alone — it cites a company source or a live number, or it says
it doesn't know and points to who does.

---

## 4. What we reuse (don't rebuild)
- **`lib/insights.ts` + `app/api/insights/route.ts`** — the proven grounded-chat + Anthropic call pattern (system prompt, `ANTHROPIC_MODEL || "claude-opus-4-8"`, `hasInsightsKey()` fallback). Generalize it; retire the KPI-only `InsightsWidget`.
- **`lib/metrics-registry.ts`** (canonical definitions), **`lib/benchmarking.ts`**, **`lib/needs-attention.ts`** + **`lib/rhythm.ts`**, **`lib/sop.ts`** (`sopsNeedingAttention`), **`lib/scorecard*.ts`**, **`lib/reminders.ts`** — become the live-data tools, already scope-aware.
- **`lib/access.ts` / `lib/access-catalog.ts` / `lib/access-paths.ts`** + `requireUser()` (live `employeeId`, role, branch) — the one source of truth for what a user may see; retrieval + tools enforce it.
- **Corpora already in the DB:** `PolicyDocument` (manual, handbook), `ChecklistTemplate`/SOPs, `Course`/`Module`, `BulletinPost`, Document Center (`lib/documents.ts`), and `docs/BRAND_KIT.md`.
- **`app/api/cron/daily`** — add the nightly re-index pass here.
- **Deterministic-fallback discipline** and **SQLite-local / Postgres-prod** split (the `deploy-db.ts` `VERCEL_ENV` guard pattern).

---

## 5. Component 1 — Knowledge base & continuous ingestion

**Corpus registry (`lib/copilot/corpus.ts`).** One loader per source type, each
yielding normalized records: `{ sourceType, sourceId, title, sectionTitle, href, accessTag, text }`.
Phase 1 sources: Manager Manual + Employee Handbook (`PolicyDocument` bodies from
`prisma/data/*.md`), SOP templates (`ChecklistTemplate` where `kind="sop"` + the
weekly/monthly checklists), and the Brand Kit / key `docs/*.md`.

**Chunking.** Split on headings into ~500–800-token passages, each keeping its
document title, section heading, and a deep-link `href` (e.g. `/resources/manual#progressive-discipline`)
so citations link back to the exact place.

**`accessTag`** — the audience key that retrieval filters on, derived from the
existing access model: e.g. `all` (handbook), `manager` (manual), `branch:<x>`
(a branch SOP), `superadmin`. Chunks are only ever retrieved for users whose
grants include the tag.

**Embeddings + store (`KnowledgeChunk`).** `contentHash` per chunk; embed and
upsert only when the hash changes (cheap re-indexing). Vector search behind an
interface with two backends:
- **Prod (Neon Postgres):** `pgvector` column + cosine similarity.
- **Local (SQLite):** in-memory cosine over the (small) chunk set, or Postgres
  full-text as a fallback — so local dev and the preview build never need the
  vector extension (mirrors the `deploy-db` non-prod guard).

**Continuous learning = continuous ingestion.** Re-index triggers:
1. **On change** — hooks where content is published: document upload (`/api/management/upload`, Document Center), SOP publish/version, manual/handbook version bump (`prisma/seed-documents.ts`), course create/edit.
2. **Nightly** — a `reindexKnowledge()` step in `app/api/cron/daily` catches anything missed and re-embeds changed hashes.
3. **Deploy** — a `deploy-db.ts` step seeds/refreshes the core-doc index on release (prod only, same guard as the other seeds).

> **Privacy refinement (honoring "all materials, access-scoped"):** *documents,
> policies, training and SOPs* go into the embedded index. *Individual personnel
> data* (a person's record, PTO, discipline history, pay) is **never embedded** —
> it's reached only through the live, permission-checked tools in Component 3. So
> sensitive per-employee data is answered in real time under that user's grants
> and is never sitting in a shared vector index.

---

## 6. Component 2 — Retrieval & access-scoped grounding

On each turn (`lib/copilot/retrieve.ts`):
1. Resolve the user (role, branch, grants) and the **current screen** (the panel sends the pathname + any entity id).
2. Embed the question; fetch top-k chunks **filtered to the user's `accessTag` set**.
3. Assemble the prompt: system prompt (identity, company, guardrails, cite-or-decline, brand voice) + retrieved passages with their source refs + conversation + the current-screen context.
4. Return citations as structured refs the panel renders as source chips linking to the real page.

**Cite-or-decline:** if retrieval + tools don't support an answer, the model says
so and points to the owner (e.g. "I don't see this in the handbook — check with
HR"), rather than guessing. This is enforced in the system prompt and verified in
the eval set (§12).

---

## 7. Component 3 — Live-data tools (read-only, scoped)

Anthropic **tool use**: the model may call these; the server runs each under the
caller's grants and returns JSON. All **read-only** in Phase 1.

| Tool | Returns | Backed by |
|---|---|---|
| `get_branch_kpis` | the user's branch KPIs vs budget | `lib/branch-pnl.ts`, `lib/management.ts` |
| `get_metric_definition` | canonical definition/source/owner | `lib/metrics-registry.ts` |
| `get_branch_benchmarking` | league-table standing (exec/mgr scope) | `lib/benchmarking.ts` |
| `get_needs_attention` | the user's open items (role-scoped) | `lib/needs-attention.ts` |
| `get_this_month_tasks` | rhythm "this month" items | `lib/rhythm.ts` |
| `get_sop_status` | open/overdue SOPs for the branch | `lib/sop.ts` |
| `get_scorecard` | the user's own / their branch scorecard | `lib/scorecard*.ts` |
| `lookup_employee` | a record, **permission-gated** | `lib/people.ts` (branch-lock + grant check) |

Each tool re-checks scope server-side — a tool is never trusted to be safe just
because the model called it.

**Actions (guide + draft + submit).** Phase 1 draws a clear line:
- **Sensitive writes** (write-up, accident report): the copilot **drafts** the
  content and returns an **"Open the form, pre-filled"** action; the manager
  reviews and submits in the real screen. The copilot does **not** call the write
  API itself.
- **Low-risk, bounded actions** (e.g. "flag Truck 18 for service," "remind me
  Friday," "dismiss this reminder"): the copilot renders a **confirm card**; on
  the user's explicit click the panel calls the existing endpoint. The model
  proposes; the human clicks; the server authorizes.
- **No autonomous consequential writes, ever.** (Vision §4 guardrail.)

---

## 8. Component 4 — The Copilot API (agent loop)

`app/api/copilot/route.ts` (streaming). Per request: `requireUser()` → build
context → Claude call with the tool schema and retrieved passages → run any tool
calls (scoped) → stream the grounded answer + citations + any proposed
action cards. Reuses the `insights.ts` Anthropic plumbing and the
`hasInsightsKey()`-style fallback (no key → a deterministic "here's the relevant
SOP/section + links" response from retrieval alone, so the panel still helps).

---

## 9. Component 5 — UI (the docked panel)

Promote `InsightsWidget` → **`components/CanopyCopilot.tsx`**, rendered in
`AppShell` for **all** authenticated users (role-scoped content), replacing the
leadership-only widget.
- **Docked right-hand panel** with a persistent launcher (matches the approved concept and the CRM/ERP pattern).
- **Suggested prompts by role + screen** (`lib/copilot/prompts.ts`) — never a blank box; the positive-first set from the concept, with per-screen variants.
- **Context chip** — the panel sends the current pathname + entity so answers are about what the user is looking at.
- **Citations** as source chips; **confirm cards** for actions; **Recent / New conversation** controls; **thumbs up/down** feedback.
- **Inline "Ask Canopy" entry points** — a reusable `<AskCanopy task=… context=… />` button placed on the top workflows (weekly checklist, this-month tasks, personnel/write-up, branch KPI) that opens the panel primed.
- Brand kit exact (forest chrome, Helvetica Neue 300, thin 1.6 icons, real `canopyos-icon.png`), mobile full-screen sheet, `prefers-reduced-motion`, focus-visible, Escape-to-close.

---

## 10. Component 6 — Trust, governance & the improvement loop
- **Access-scoped** retrieval + tools; **cite-or-decline**; **HITL** for every write.
- **Logging:** `CopilotConversation` / `CopilotMessage` (question, retrieved sources, tools used, whether grounded) — never hard-deleted (ledger discipline).
- **Feedback:** thumbs up/down + optional note on each answer.
- **Knowledge-gaps report:** questions answered with low/no grounding roll up into a report (surfaced to super admins) telling leadership **which SOP or document to write next** — the self-improving loop the COO asked for.
- **Docs-track-the-code:** `docs/WORKFLOWS.md` rows; `lib/access-catalog.ts` entry for the Copilot surface + any admin "Copilot settings / gaps" page; manual reconciled; this plan kept current.

---

## 11. Data model additions (all additive / `prisma db push`-safe)
- `KnowledgeChunk` — `sourceType, sourceId, sectionTitle, href, accessTag, content, contentHash, embedding (vector in prod / nullable), updatedAt`; indexed by `sourceType+sourceId` and `accessTag`.
- `CopilotConversation` — `userId, startedAt, screen`.
- `CopilotMessage` — `conversationId, role, content, sourcesJson, toolsJson, grounded (bool), createdAt`.
- `CopilotFeedback` — `messageId, rating, note, createdAt`.

(No changes to existing tables; nothing hard-deleted.)

---

## 12. Config, environment & validation
- **`ANTHROPIC_API_KEY`** — already used; the agent loop + the existing surfaces share it.
- **Embeddings provider** — see decision in §13. The embeddings host must be allowed by the environment's **network policy** (outbound). Local/preview use the non-vector fallback so they never call it.
- **Eval set** — a fixed list of real questions (write-up policy, "what's due this month," "fuel % over budget," "which SOP for a spill," plus a few the KB should *not* answer) run as a build check: must cite the right source and must decline the out-of-scope ones. Extends the existing `scripts/` build-check pattern.
- **Build gate** (every slice, non-negotiable): `rm -rf .next && npx prisma generate && npx tsc --noEmit && npx next build`, plus `npx prisma validate`.

---

## 13. Decisions needed before build
1. **Embeddings provider / data processor.** Semantic retrieval needs an
   embeddings model, which means document text is sent to that provider.
   - *Recommended:* start **1a with Postgres full-text retrieval only** (no new
     vendor, no document text leaves our stack), then turn on **Voyage AI
     embeddings** (Anthropic's recommended partner) via `pgvector` once you
     approve the processor. This de-risks and keeps the first slice fully
     in-house. **Need: your approval of an embeddings provider (Voyage, or an
     alternative you prefer), or "FTS-only for now."**
2. **Sensitive personnel data** — confirm the refinement in §5: policies/training/
   SOPs are embedded; **individual employee records are reached only via live,
   permission-checked tools, never embedded.** (Recommended; privacy-safer.)
3. **Submit boundary** — confirm §7: sensitive writes draft + open the real form;
   only low-risk bounded actions get one-click confirm cards. (Recommended.)

---

## 14. Build breakdown (how it ships)
Parallel-agent waves with clean file ownership, same discipline as the Theme 2/3/6/10 batch:
- **Wave A — Knowledge base + retrieval.** `lib/copilot/corpus.ts`, `retrieve.ts`, `KnowledgeChunk` + store backends, ingestion hooks + nightly/deploy reindex, eval set. (Owns schema + `deploy-db` + cron additions.)
- **Wave B — Copilot API + tools.** `app/api/copilot/route.ts`, the read-only scoped tools wrapping existing libs, the agent loop, deterministic fallback. (Depends on A's retrieval interface; can stub it first.)
- **Wave C — UI.** `components/CanopyCopilot.tsx` (replaces `InsightsWidget` in `AppShell`), `lib/copilot/prompts.ts`, the `<AskCanopy>` inline button, citations/confirm cards/feedback. (Owns `AppShell`, nav/access-catalog entry.)
- **Wave D — Governance.** logging models, feedback, gaps report + the super-admin view; docs reconcile.

Suggested order: **A → B in parallel with C (C against a stubbed API) → D**, then one combined build + deploy, confirm prod green on `clements-canopy.com`.

---

## 15. Success metrics
- **Adoption:** weekly active Copilot users by role; share of help-seeking that happens in-app vs. asking a person.
- **Usefulness:** thumbs-up rate; % of answers with a citation; task-completion (draft → filed) rate.
- **Trust:** zero ungrounded answers on the eval set; zero access-scope leaks (a user never sees a cited source they can't open).
- **Learning loop:** knowledge-gaps closed per month (documents/SOPs created from the gaps report).

---

*Bottom line: Phase 1 stands up the real thing — a grounded, access-scoped,
continuously-ingesting assistant that every user can lean on — on top of the
surfaces Canopy already has, with the trust rails (cite, scope, confirm) built in
from day one. The only external dependency is the embeddings decision in §13, and
we can ship the first slice without it.*
