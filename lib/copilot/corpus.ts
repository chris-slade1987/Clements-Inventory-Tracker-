import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { prisma } from "@/lib/prisma";
import { HANDBOOK_SLUG, MANUAL_SLUG } from "@/lib/policy-docs";
import { listSopTemplates } from "@/lib/sop";
import { getTemplates, groupByCategory, type ChecklistItem } from "@/lib/checklists";

// Canopy Copilot — corpus registry (CanopyOS vision Theme 5, Wave A, §5).
//
// One loader per source type. Each yields NORMALIZED, pre-chunked records that
// `lib/copilot/ingest.ts` upserts into `KnowledgeChunk`. A record is a single
// retrieval passage carrying its source identity, the deep-link `href` to the
// real page/section, and the `accessTag` that retrieval filters on.
//
// SCOPE (per the plan): company DOCUMENTS only — Manager Manual + Employee
// Handbook (PolicyDocument bodies), SOP + checklist templates, and the Brand Kit
// / clearly-operational docs/*.md. Individual PERSONNEL data is NEVER loaded
// here — it is reached later through live, permission-checked tools (Wave B).

/** The access audience of a chunk. Resolved against the real access model by
 *  `accessTagsForUser()` in lib/copilot/retrieve.ts — never invented here.
 *  - `all`        → everyone (Employee Handbook / all-staff policy).
 *  - `manager`    → anyone who runs branch operations (sees My Branch / SOPs):
 *                   the Manager Operating Manual, SOP + checklist templates.
 *  - `exec`       → the executive views (executive grant): exec KPI reference.
 *  - `internal`   → the System Map tier (system-map grant): internal build docs
 *                   (the Brand Kit) — senior leadership + admins.
 *  - `superadmin` → super admins only (Chris / Julie / April): admin-only docs.
 *  - `branch:<k>` → a single branch's material (future branch-specific docs). */
export type AccessTag =
  | "all"
  | "manager"
  | "exec"
  | "internal"
  | "superadmin"
  | `branch:${string}`;

export type CorpusChunk = {
  sourceType: string; // "manual" | "handbook" | "sop" | "checklist" | "doc"
  sourceId: string; // slug / template key / doc filename
  title: string; // the source document's title
  sectionTitle: string | null; // the heading this chunk lives under
  href: string; // deep link to the real page/section
  accessTag: AccessTag;
  text: string; // the passage text
  contentHash: string; // stable hash of (title|sectionTitle|text)
  tokens: number; // approximate token count (chars / 4)
};

// ---- helpers ----------------------------------------------------------------

/** Mirrors the GitHub-ish slugger in `components/Markdown.tsx` so a chunk's
 *  `#<slug>` anchor resolves to the SAME heading id the rendered page assigns.
 *  Kept as a per-document instance (duplicate headings get -1, -2 suffixes). */
class Slugger {
  private seen: Record<string, number> = {};
  slug(text: string): string {
    const base = text
      .toLowerCase()
      .replace(/&/g, "and")
      .replace(/[^a-z0-9 -]/g, "")
      .replace(/\s+/g, "-")
      .replace(/-{2,}/g, "-")
      .replace(/^-+|-+$/g, "");
    const n = this.seen[base] ?? 0;
    this.seen[base] = n + 1;
    return n === 0 ? base : `${base}-${n}`;
  }
}

/** Rough token estimate (the whole corpus is small; this only guides chunk size
 *  and feeds the `tokens` column). ~4 chars/token is good enough for English. */
export function estimateTokens(text: string): number {
  return Math.max(1, Math.ceil(text.trim().length / 4));
}

/** Stable content hash — the upsert / skip-unchanged key. Covers the SEMANTIC
 *  content (title + section + text). `href` / `accessTag` are intentionally NOT
 *  hashed: re-tagging or re-homing a chunk updates it in place instead of
 *  churning a new row (ingest refreshes those mutable fields when they differ). */
export function hashChunk(title: string, sectionTitle: string | null, text: string): string {
  return createHash("sha256").update(`${title}\u0000${sectionTitle ?? ""}\u0000${text}`).digest("hex");
}

// Target passage size (§5: ~500–800 tokens). We pack whole sections up to the
// MAX, splitting an oversized section on its paragraphs so no chunk runs away.
const TARGET_TOKENS = 700;
const MAX_TOKENS = 800;

// Heading-only "navigation" sections we never index (pure anchor lists).
const SKIP_HEADINGS = /^(contents|table of contents|what'?s new in the portal)$/i;

function finalizeChunk(
  base: Omit<CorpusChunk, "contentHash" | "tokens" | "text">,
  text: string,
): CorpusChunk {
  const clean = text.replace(/\n{3,}/g, "\n\n").trim();
  return {
    ...base,
    text: clean,
    contentHash: hashChunk(base.title, base.sectionTitle, clean),
    tokens: estimateTokens(clean),
  };
}

/**
 * Split a Markdown body into ~500–800-token passages on its `##` headings. Each
 * chunk keeps the document title, its section heading, and an `href` deep-linking
 * to that heading's anchor (matching the portal's rendered anchor ids). An
 * oversized section is further split on blank-line paragraph boundaries; all of
 * its pieces share the same section heading + anchor.
 */
export function chunkMarkdown(opts: {
  body: string;
  sourceType: string;
  sourceId: string;
  title: string;
  baseHref: string; // e.g. "/resources/manual"
  accessTag: AccessTag;
}): CorpusChunk[] {
  const { body, sourceType, sourceId, title, baseHref, accessTag } = opts;
  const slugger = new Slugger();
  const lines = body.replace(/\r\n/g, "\n").split("\n");

  // Group lines into sections keyed by the most recent `##` heading. Content
  // before the first `##` (intro) is a leading section with no heading.
  type Section = { heading: string | null; slug: string | null; lines: string[] };
  const sections: Section[] = [{ heading: null, slug: null, lines: [] }];
  for (const line of lines) {
    const m = /^(#{1,6})\s+(.*)$/.exec(line);
    if (m) {
      const text = m[2].trim();
      const slug = slugger.slug(text); // advance for EVERY heading to match body ids
      if (m[1].length === 1) continue; // h1 = document title, not a section
      if (m[1].length === 2) {
        sections.push({ heading: text, slug, lines: [] });
        continue;
      }
      // h3+ stays inside its h2 section (keeps the heading line as context).
    }
    sections[sections.length - 1].lines.push(line);
  }

  const out: CorpusChunk[] = [];
  for (const sec of sections) {
    if (sec.heading && SKIP_HEADINGS.test(sec.heading)) continue;
    const headingPrefix = sec.heading ? `# ${sec.heading}\n\n` : "";
    const bodyText = sec.lines.join("\n").trim();
    if (!bodyText) continue;

    const href = sec.slug ? `${baseHref}#${sec.slug}` : baseHref;
    const base = { sourceType, sourceId, title, sectionTitle: sec.heading, href, accessTag };

    const whole = headingPrefix + bodyText;
    if (estimateTokens(whole) <= MAX_TOKENS) {
      out.push(finalizeChunk(base, whole));
      continue;
    }

    // Oversized section → pack paragraphs up to TARGET_TOKENS per chunk.
    const paras = bodyText.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
    let buf: string[] = [];
    let bufTokens = estimateTokens(headingPrefix);
    const flush = () => {
      if (buf.length) out.push(finalizeChunk(base, headingPrefix + buf.join("\n\n")));
      buf = [];
      bufTokens = estimateTokens(headingPrefix);
    };
    for (const p of paras) {
      const t = estimateTokens(p);
      if (bufTokens + t > TARGET_TOKENS && buf.length) flush();
      buf.push(p);
      bufTokens += t;
    }
    flush();
  }
  return out;
}

// ---- loaders ----------------------------------------------------------------

/** Manager Manual + Employee Handbook — the published `PolicyDocument` bodies.
 *  Handbook → `all` (every employee); Manual → `manager` (branch operators). */
export async function loadPolicyDocs(): Promise<CorpusChunk[]> {
  const docs = await prisma.policyDocument.findMany({
    where: { slug: { in: [HANDBOOK_SLUG, MANUAL_SLUG] }, published: true },
  });
  const out: CorpusChunk[] = [];
  for (const d of docs) {
    const isHandbook = d.slug === HANDBOOK_SLUG;
    out.push(
      ...chunkMarkdown({
        body: d.body,
        sourceType: isHandbook ? "handbook" : "manual",
        sourceId: d.slug,
        title: d.title,
        baseHref: isHandbook ? "/resources/handbook" : "/resources/manual",
        accessTag: isHandbook ? "all" : "manager",
      }),
    );
  }
  return out;
}

/** Render an SOP / checklist template's steps into a compact passage body. */
function renderSteps(steps: ChecklistItem[]): string {
  const groups = groupByCategory(steps);
  const parts: string[] = [];
  for (const g of groups) {
    parts.push(`## ${g.category}`);
    for (const it of g.items) {
      const bits = [it.label];
      if (it.objective && it.objective !== it.label) bits.push(`— ${it.objective}`);
      if (it.help) bits.push(`(${it.help})`);
      parts.push(`- ${bits.join(" ")}`);
    }
  }
  return parts.join("\n");
}

/** SOP templates (ChecklistTemplate `kind="sop"`, active) → one chunk each.
 *  SOPs are run from My Branch → SOPs (grant `sops`) → `manager` audience. */
export async function loadSops(): Promise<CorpusChunk[]> {
  const templates = await listSopTemplates({ includeInactive: false });
  return templates.map((t) => {
    const body = [t.intro?.trim() || "", renderSteps(t.steps)].filter(Boolean).join("\n\n");
    const title = `SOP: ${t.title}`;
    const text = `# ${title}\n\n${body}`;
    return finalizeChunk(
      {
        sourceType: "sop",
        sourceId: t.key,
        title,
        sectionTitle: t.category,
        href: `/sops/${t.id}`,
        accessTag: "manager",
      },
      text,
    );
  });
}

/** Active recurring checklist templates (`kind="checklist"`) → one chunk each.
 *  Run from My Branch / Checklists (grant `checklists`) → `manager` audience. */
export async function loadChecklists(): Promise<CorpusChunk[]> {
  const templates = await getTemplates();
  return templates.map((t) => {
    const steps = (() => {
      try {
        return JSON.parse(t.items) as ChecklistItem[];
      } catch {
        return [] as ChecklistItem[];
      }
    })();
    const body = [t.intro?.trim() || "", renderSteps(steps)].filter(Boolean).join("\n\n");
    const title = t.title;
    const text = `# ${title}\n\n${body}`;
    return finalizeChunk(
      {
        sourceType: "checklist",
        sourceId: t.key,
        title,
        sectionTitle: `${t.cadence} checklist`,
        href: `/checklists/${t.key}`,
        accessTag: "manager",
      },
      text,
    );
  });
}

// Operational docs/*.md worth answering from. Each maps to an EXISTING portal
// page whose access is >= the chunk's accessTag, so a cited source is always one
// the citing user can actually open (no scope-leak). The plan file itself and
// internal planning docs (CANOPY-VISION, PUNCH_LIST, WORKFLOWS, COPILOT-PHASE-1,
// DOC-RECONCILIATION, ENHANCEMENT-REVIEW) are intentionally NOT indexed.
const OPERATIONAL_DOCS: { file: string; sourceId: string; title: string; baseHref: string; accessTag: AccessTag }[] = [
  // Brand Kit — the internal visual system (System Map tier: senior + admin).
  { file: "BRAND_KIT.md", sourceId: "brand-kit", title: "CanopyOS Brand Kit", baseHref: "/management/system-map", accessTag: "internal" },
  // Manager scorecard reference — managers can open /management/scorecards (view).
  { file: "manager-scorecard-review.md", sourceId: "scorecard-review", title: "Manager Scorecard Review", baseHref: "/management/scorecards", accessTag: "manager" },
  // Executive dashboard KPI reference — the executive views (executive grant).
  { file: "exec-dashboard-kpis.md", sourceId: "exec-dashboard-kpis", title: "Executive Dashboard KPIs", baseHref: "/executive", accessTag: "exec" },
];

/** Brand Kit + clearly-operational docs/*.md. Best-effort per file: on a host
 *  where the docs/ folder isn't present at runtime (e.g. a trimmed serverless
 *  bundle) an unreadable file is skipped rather than failing the whole reindex —
 *  these chunks are refreshed at deploy time, where the repo files ARE present. */
export function loadOperationalDocs(): CorpusChunk[] {
  const out: CorpusChunk[] = [];
  for (const d of OPERATIONAL_DOCS) {
    let body: string;
    try {
      body = readFileSync(join(process.cwd(), "docs", d.file), "utf8");
    } catch {
      continue; // file not on disk in this environment — skip, don't abort.
    }
    out.push(
      ...chunkMarkdown({
        body,
        sourceType: "doc",
        sourceId: d.sourceId,
        title: d.title,
        baseHref: d.baseHref,
        accessTag: d.accessTag,
      }),
    );
  }
  return out;
}

/** Load + chunk the ENTIRE Phase-1 corpus (all source types). */
export async function loadCorpus(): Promise<CorpusChunk[]> {
  const [policy, sops, checklists] = await Promise.all([loadPolicyDocs(), loadSops(), loadChecklists()]);
  return [...policy, ...sops, ...checklists, ...loadOperationalDocs()];
}
