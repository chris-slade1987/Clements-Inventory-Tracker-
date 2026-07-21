<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# Docs track the code

The Manager Operating Manual (`prisma/data/manager-manual.md`) and Employee Handbook
(`prisma/data/handbook.md`) are launch-gated on a clean workflow registry. When a change
**adds or alters a workflow** (a route, an API handler, or business logic in `lib/**`), in the
**same change** you MUST:

1. **Update `docs/WORKFLOWS.md`** — add/edit the workflow's row and set its reconciliation
   status (✅ aligned · ⚠️ stale · ❌ contradicts · 🆕 missing). No ⚠️/❌/🆕 may remain open at launch.
2. **Reconcile the manual** — rewrite any manual passage the change makes stale or wrong to
   describe the real portal flow (name the screen, steps, and guardrails). Preserve the manual's
   voice and any still-accurate non-software guidance. If you change published content, bump the
   `manager-manual` version in `prisma/seed-documents.ts` (forward-only; never wipe acknowledgments).
3. **Flag the handbook — do not reword policy.** The handbook is a legal document. Only correct
   a **factual portal mechanic** inline (e.g. where a request/submission now happens in the
   portal); route anything **substantive** to `prisma/data/handbook-suggestions.md` (append; keep
   its "for HR/legal review" heading). Any inline handbook edit requires a `employee-handbook`
   version bump in the seed and re-prompts every prior acknowledger — call that out.

Derive canonical steps by **reading the code**, never by assuming. Mark anything ambiguous
"verify" rather than asserting it.
