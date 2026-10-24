import "server-only";
import {
  branchLocked,
  canViewExec,
  isServiceAdvisor,
  isFieldOpsDirector,
  isSuperAdmin,
  type SessionUser,
} from "@/lib/auth";
import { effectiveGrantsForUser, canManageAccessRights } from "@/lib/access";
import { hasAccess, type Grants } from "@/lib/access-catalog";
import {
  BRANCHES,
  branchLabel,
  cell,
  periodValues,
  resolvePeriod,
  type Cell,
} from "@/lib/management";
import { getMetric, allMetrics } from "@/lib/metrics-registry";
import { computeBenchmarks } from "@/lib/benchmarking";
import { collectAttention, type AttentionAudience, type AttentionItem } from "@/lib/needs-attention";
import { sopsNeedingAttention } from "@/lib/sop";
import {
  buildScorecardRows,
  scoreFromSaved,
  bonusEarned,
  QUARTER_MONTHS,
} from "@/lib/scorecard";
import { buildAdvisorScorecard } from "@/lib/scorecard-advisor";
import { currentPeriodKey } from "@/lib/sales";
import { employeeRoster, matchEmployeeByName } from "@/lib/people";
import { orgTileData, searchOrg } from "@/lib/org-chart";
import { isServiceTag } from "@/lib/service-catalog";

// ===========================================================================
// Canopy Copilot — live-data tools (CanopyOS Theme 5, Wave B, plan §7).
// ===========================================================================
//
// Read-only, access-scoped tools the model may call. EVERY handler RE-CHECKS the
// caller's real scope (grants + branch-lock) on the server before returning
// anything — the model is never trusted to be safe just because it called a tool.
// Nothing here writes. Nothing returns manager/individual compensation. Personnel
// lookups are permission-gated and branch-locked, and return only roster-level
// fields (never pay, discipline, PTO, or personnel records).
//
// Shape: each tool is { schema (Anthropic tool-use definition), handler }. The
// agent loop (lib/copilot/agent.ts) exposes the schemas to Claude and runs the
// matching handler under a resolved ToolContext.

// ---- tool context (the one place scope is resolved) -------------------------

export type ToolContext = {
  user: SessionUser;
  grants: Grants;
  /** Super admin (Chris / Julie / April) — may see everything. */
  superadmin: boolean;
  /** May view company-wide / cross-branch data (admin, senior leadership, board). */
  canExec: boolean;
  /** True when this principal is NOT pinned to a single branch. */
  allBranches: boolean;
  /** The principal's home branch (the lock target for branch-scoped data). */
  branch: string | null;
};

/** Resolve the caller's real scope ONCE. Mirrors the access model used across the
 *  portal (lib/auth + lib/access) so tools gate on exactly what the user may see. */
export async function resolveToolContext(user: SessionUser): Promise<ToolContext> {
  const grants = await effectiveGrantsForUser(user);
  const superadmin = isSuperAdmin(user) || canManageAccessRights(user);
  const canExec = canViewExec(user);
  const locked = branchLocked(user);
  return {
    user,
    grants,
    superadmin,
    canExec,
    // Branch-locked managers are pinned to their branch; exec/admin principals are not.
    allBranches: !locked || canExec,
    branch: user.branch,
  };
}

const BRANCH_KEYS = new Set<string>(BRANCHES.map((b) => b.key));

/** Resolve which branch a data tool should act on, ENFORCING branch-lock:
 *  a branch-locked principal is always forced to their own branch regardless of
 *  what the model asked for. Returns null when an exec asked for all/company. */
function scopeBranch(ctx: ToolContext, requested?: string | null, opts: { companyOk?: boolean } = {}): { branch: string | null; forced: boolean } {
  if (!ctx.allBranches) {
    // Branch-locked: ignore the model's request entirely.
    return { branch: ctx.branch, forced: true };
  }
  const req = typeof requested === "string" ? requested.trim().toLowerCase() : "";
  if (req && BRANCH_KEYS.has(req)) return { branch: req, forced: false };
  if (req === "company" && opts.companyOk) return { branch: null, forced: false };
  // Default for an all-branch principal: company scope if allowed, else their branch.
  if (opts.companyOk) return { branch: null, forced: false };
  return { branch: ctx.branch, forced: false };
}

// ---- Anthropic tool-use schema type -----------------------------------------

export type AnthropicToolSchema = {
  name: string;
  description: string;
  input_schema: { type: "object"; properties: Record<string, unknown>; required?: string[] };
};

export type CopilotTool = {
  schema: AnthropicToolSchema;
  handler: (input: Record<string, unknown>, ctx: ToolContext) => Promise<unknown>;
};

const str = (v: unknown): string | undefined => (typeof v === "string" && v.trim() ? v.trim() : undefined);

// ===========================================================================
// 1. get_branch_kpis — a branch's (or the company's) KPIs vs budget
// ===========================================================================

const BRANCH_KPI_KEYS = [
  "production", "new_sales", "attrition", "attrition_rate", "net_after_labor",
  "margin_pct", "tech_wages", "route_contrib", "route_contrib_pct", "stops",
];
const COMPANY_KPI_KEYS = [
  "net_revenue", "new_sales", "attrition", "attrition_rate", "route_contrib",
  "route_contrib_pct", "ebitda", "ebitda_pct", "sga", "tech_wages",
];

function kpiRow(values: Map<string, Cell>, key: string, scope: string) {
  const def = getMetric(key);
  const m = cell(values, key, scope as never, "month");
  const y = cell(values, key, scope as never, "ytd");
  if (m.actual == null && m.budget == null && y.actual == null && y.budget == null) return null;
  return {
    key,
    label: def?.name ?? key,
    unit: def?.unit ?? "usd",
    month: { actual: m.actual, budget: m.budget, variance: m.variance, favorable: m.favorable },
    ytd: { actual: y.actual, budget: y.budget, variance: y.variance, favorable: y.favorable },
  };
}

const getBranchKpis: CopilotTool = {
  schema: {
    name: "get_branch_kpis",
    description:
      "Get the caller's branch KPIs vs budget (production, new sales, cancellations, margin, tech wages, route contribution, etc.) for the latest Monthly Board Report period, month and YTD. Branch managers always get their own branch; executives/admins may pass a branch key (vero|stuart|orlando|naples) or 'company'. Never returns manager/individual compensation.",
    input_schema: {
      type: "object",
      properties: {
        branch: { type: "string", description: "Branch key (vero|stuart|orlando|naples) or 'company'. Ignored for branch-locked managers." },
      },
    },
  },
  handler: async (input, ctx) => {
    const { branch, forced } = scopeBranch(ctx, str(input.branch), { companyOk: ctx.canExec });
    const period = await resolvePeriod();
    if (!period) return { error: "No Monthly Board Report has been loaded yet, so there are no KPIs to show." };
    const values = await periodValues(period.id);
    const scope = branch ?? "company";
    const keys = scope === "company" ? COMPANY_KPI_KEYS : BRANCH_KPI_KEYS;
    const kpis = keys.map((k) => kpiRow(values, k, scope)).filter(Boolean);
    return {
      scope,
      scopeLabel: scope === "company" ? "Company (all branches)" : branchLabel(scope),
      period: period.label,
      forcedToOwnBranch: forced,
      note: "Actual vs budget. Variance is actual − budget; favorable reflects each KPI's good direction. No manager/individual compensation is included.",
      kpis,
    };
  },
};

// ===========================================================================
// 2. get_metric_definition — canonical definition / source / owner
// ===========================================================================

const getMetricDefinition: CopilotTool = {
  schema: {
    name: "get_metric_definition",
    description:
      "Look up the ONE canonical definition of a company metric (what it means, where the number comes from, who owns it, its unit). Use this to answer 'what is <metric>' or 'what's the difference between <a> and <b>'. Pass the metric key.",
    input_schema: {
      type: "object",
      properties: { key: { type: "string", description: "Metric key, e.g. new_sales, production, attrition_rate, route_contrib, fuel, qc_pass_rate." } },
      required: ["key"],
    },
  },
  handler: async (input) => {
    const key = str(input.key);
    const def = key ? getMetric(key) : null;
    if (!def) {
      return { found: false, availableKeys: allMetrics().map((m) => ({ key: m.key, name: m.name })) };
    }
    return {
      found: true,
      key: def.key,
      name: def.name,
      definition: def.definition,
      source: def.source,
      owner: def.owner,
      unit: def.unit,
      format: def.format,
      window: def.window ?? null,
      canonical: !!def.canonical,
      distinction: def.distinction ?? null,
      relatedKeys: def.relatedKeys ?? [],
    };
  },
};

// ===========================================================================
// 3. get_branch_benchmarking — cross-branch league standing (exec/mgr scope)
// ===========================================================================

const getBranchBenchmarking: CopilotTool = {
  schema: {
    name: "get_branch_benchmarking",
    description:
      "Get the cross-branch benchmarking league table (production/new-sales attainment, margin %, tech-wages %, fuel %, attrition rate, QC pass rate, checklist compliance) for the latest period, with company best + median. Executives see every branch; a branch manager sees only their own branch's value and rank against the company best/median.",
    input_schema: { type: "object", properties: {} },
  },
  handler: async (_input, ctx) => {
    const full = ctx.canExec || ctx.superadmin || hasAccess(ctx.grants, "benchmarking");
    const scoped = full || (!ctx.allBranches && ctx.branch); // a branch-locked manager gets a filtered view
    if (!scoped) return { error: "Branch benchmarking isn't part of your access." };

    const b = await computeBenchmarks();
    if (!b) return { error: "No Monthly Board Report has been loaded yet, so the league table is empty." };

    if (full) {
      return {
        period: b.periodLabel,
        scope: "all-branches",
        metrics: b.metrics.map((m) => ({
          key: m.key, label: m.label, unit: m.unit, higherIsBetter: m.higherIsBetter, note: m.note,
          best: m.best, median: m.median,
          branches: m.values.map((v) => ({ branch: v.label, value: v.value, rank: v.rank, leader: v.leader, laggard: v.laggard })),
        })),
      };
    }

    // Branch-locked manager: reveal only their own branch's standing + company best/median.
    const mine = ctx.branch!;
    return {
      period: b.periodLabel,
      scope: "own-branch",
      branch: branchLabel(mine),
      metrics: b.metrics.map((m) => {
        const v = m.values.find((x) => x.branch === mine);
        return {
          key: m.key, label: m.label, unit: m.unit, higherIsBetter: m.higherIsBetter, note: m.note,
          yourValue: v?.value ?? null, yourRank: v?.rank ?? null, outOf: m.values.filter((x) => x.value != null).length,
          companyBest: m.best, companyMedian: m.median,
        };
      }),
    };
  },
};

// ===========================================================================
// 4 & 5. get_needs_attention / get_this_month_tasks — role-scoped open items
// ===========================================================================

/** Which command-center queue this user draws from (and whether it's branch-scoped). */
function attentionAudience(ctx: ToolContext): { audience: AttentionAudience; branch: string | null } {
  const u = ctx.user;
  if (isFieldOpsDirector(u)) return { audience: "field_ops", branch: null };
  if (u.hrAccess) return { audience: "hr", branch: null };
  if (!ctx.allBranches && ctx.branch) return { audience: "branch", branch: ctx.branch };
  if (u.role === "manager") return { audience: "branch", branch: ctx.branch };
  if (ctx.canExec) return { audience: "executive", branch: null };
  return { audience: "employee", branch: null };
}

function attentionItemOut(it: AttentionItem) {
  return { title: it.title, detail: it.detail ?? null, severity: it.severity, kind: it.kind, href: it.href, dueDate: it.dueDate ?? null, count: it.count ?? 1 };
}

const getNeedsAttention: CopilotTool = {
  schema: {
    name: "get_needs_attention",
    description:
      "Get the caller's open 'needs attention' items — the same role-scoped, branch-scoped queue their command center shows (overdue follow-ups, missed checklists, SOPs due, PTO to review, renewals, etc.), most urgent first.",
    input_schema: { type: "object", properties: {} },
  },
  handler: async (_input, ctx) => {
    const { audience, branch } = attentionAudience(ctx);
    const items = await collectAttention({ user: ctx.user, audience, branch });
    return {
      audience,
      scope: branch ? branchLabel(branch) : "all branches",
      total: items.length,
      items: items.slice(0, 12).map(attentionItemOut),
    };
  },
};

const getThisMonthTasks: CopilotTool = {
  schema: {
    name: "get_this_month_tasks",
    description:
      "Get the caller's tasks and duties due in the CURRENT calendar month — the monthly slice of their operating rhythm (warehouse inspection, QC, MBR upload, renewals, overdue items, anything due by month-end). Role- and branch-scoped.",
    input_schema: { type: "object", properties: {} },
  },
  handler: async (_input, ctx) => {
    const { audience, branch } = attentionAudience(ctx);
    const now = new Date();
    const endOfMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0, 23, 59, 59));
    const items = await collectAttention({ user: ctx.user, audience, branch, now });
    const monthItems = items.filter((it) => {
      if (!it.dueDate) return true; // undated recurring/operational duties belong in the month view
      const d = Date.parse(it.dueDate);
      return Number.isNaN(d) || d <= endOfMonth.getTime();
    });
    return {
      month: now.toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" }),
      audience,
      scope: branch ? branchLabel(branch) : "all branches",
      note: "Derived from the operating-rhythm / needs-attention engine, limited to items due by month-end (overdue items included).",
      total: monthItems.length,
      tasks: monthItems.slice(0, 15).map(attentionItemOut),
    };
  },
};

// ===========================================================================
// 6. get_sop_status — open / overdue SOPs for the caller's branch
// ===========================================================================

const getSopStatus: CopilotTool = {
  schema: {
    name: "get_sop_status",
    description:
      "Get the Standard Operating Procedures that need the caller's attention — their branch's OPEN SOP assignments (managers see their own branch; admins/leadership see every branch), overdue first.",
    input_schema: { type: "object", properties: {} },
  },
  handler: async (_input, ctx) => {
    const sops = await sopsNeedingAttention(ctx.user, new Date()); // already branch-scoped by role
    return {
      total: sops.length,
      overdue: sops.filter((s) => s.overdue).length,
      items: sops.slice(0, 15).map((s) => ({
        title: s.title,
        branch: s.branchLabel,
        dueDate: s.dueDate ? s.dueDate.toISOString() : null,
        overdue: s.overdue,
        href: s.href,
      })),
    };
  },
};

// ===========================================================================
// 7. get_scorecard — the caller's own / their branch scorecard
// ===========================================================================

const getScorecard: CopilotTool = {
  schema: {
    name: "get_scorecard",
    description:
      "Get the caller's scorecard. Service advisors get their own monthly sales scorecard; branch managers get their branch's current-quarter manager scorecard (metrics, Met/Not, weighted score, bonus). Executives/admins may pass a branch key.",
    input_schema: {
      type: "object",
      properties: { branch: { type: "string", description: "Branch key (vero|stuart|orlando|naples). Ignored for branch-locked managers; not used for advisors." } },
    },
  },
  handler: async (input, ctx) => {
    // Service advisor → their own monthly sales scorecard.
    if (isServiceAdvisor(ctx.user) && ctx.user.employeeId) {
      const periodKey = currentPeriodKey();
      const sc = await buildAdvisorScorecard(ctx.user.employeeId, periodKey);
      return {
        kind: "advisor",
        period: sc.periodLabel,
        compositePct: sc.compositePct,
        closed: sc.closed,
        goal: sc.goal,
        hasGoal: sc.hasGoal,
        rank: sc.rank,
        rankOf: sc.rankOf,
        metrics: sc.metrics.map((m) => ({ key: m.key, label: m.label, weight: m.weight, value: m.value, target: m.target, attainment: m.attainment, detail: m.detail })),
      };
    }

    // Manager / exec → a branch's quarterly manager scorecard.
    const { branch } = scopeBranch(ctx, str(input.branch), { companyOk: false });
    if (!branch) return { error: "Tell me which branch's scorecard you want (vero, stuart, orlando, or naples)." };
    const now = new Date();
    const year = now.getUTCFullYear();
    const quarter = Math.floor(now.getUTCMonth() / 3) + 1;
    const [rows, score] = await Promise.all([
      buildScorecardRows(year, quarter, branch),
      scoreFromSaved(year, quarter, branch),
    ]);
    const months = QUARTER_MONTHS[quarter] ?? [];
    return {
      kind: "manager",
      branch: branchLabel(branch),
      year,
      quarter,
      quarterMonths: months,
      weightedScore: score,
      bonus: bonusEarned(score),
      rows: rows.map((r) => ({ key: r.key, label: r.label, weight: r.weight, unit: r.unit, actual: r.actual, target: r.target ?? r.budgetTarget, met: r.met, suggested: r.suggested, note: r.note })),
    };
  },
};

// ===========================================================================
// 8. lookup_employee — a roster record, PERMISSION-GATED + branch-locked
// ===========================================================================

const lookupEmployee: CopilotTool = {
  schema: {
    name: "lookup_employee",
    description:
      "Look up a team member's roster-level record (name, role/title, branch, division, field-inspection grade). PERMISSION-GATED: only callers with People/HR access, and branch managers only within their own branch. Returns NO pay, discipline, PTO, or personnel-file data. Pass a name to search, or an employeeId.",
    input_schema: {
      type: "object",
      properties: {
        query: { type: "string", description: "A name to search for (e.g. 'Josh F')." },
        employeeId: { type: "string", description: "An exact employee id, if known." },
      },
    },
  },
  handler: async (input, ctx) => {
    // Gate: must have People roster access.
    if (!hasAccess(ctx.grants, "people")) {
      return { error: "You don't have access to personnel records. For people questions, check with HR (April) or the employee's branch manager." };
    }
    // Branch-locked principals can only look within their own branch.
    const branchScope = ctx.allBranches ? undefined : ctx.branch ?? undefined;
    const roster = await employeeRoster(branchScope);

    const id = str(input.employeeId);
    const query = str(input.query);
    let match = id ? roster.find((e) => e.id === id) : undefined;
    if (!match && query) {
      const mid = matchEmployeeByName(query, roster);
      if (mid) match = roster.find((e) => e.id === mid);
      if (!match) {
        const q = query.toLowerCase();
        const hits = roster.filter((e) => e.name.toLowerCase().includes(q));
        if (hits.length === 1) match = hits[0];
        else if (hits.length > 1) {
          return { found: false, ambiguous: true, candidates: hits.slice(0, 8).map((e) => ({ name: e.name, branch: e.branch ? branchLabel(e.branch) : null, role: e.role })) };
        }
      }
    }
    if (!match) return { found: false, reason: id || query ? "No matching team member in your scope." : "Give me a name or employee id to look up." };

    // Safety net: never return someone outside a branch-locked caller's branch.
    if (!ctx.allBranches && ctx.branch && match.branch && match.branch !== ctx.branch) {
      return { found: false, reason: "That person isn't on your branch." };
    }

    return {
      found: true,
      name: match.name,
      role: match.role ?? null,
      branch: match.branch ? branchLabel(match.branch) : null,
      division: match.division ?? null,
      inspectionGrade: match.grade ?? null,
      inspectionAvgPct: match.avgPct ?? null,
      inspectionCount: match.inspectionCount,
      note: "Roster-level info only — no pay, discipline, PTO, or personnel-file data is available through this tool.",
    };
  },
};

// ===========================================================================
// 9. find_people — company-readable org directory lookup (Org Chart, Round 3)
// ===========================================================================
//
// The org directory/chart (Round 1: lib/org-chart.ts) is COMPANY-READABLE: every
// authenticated user may see the reporting structure plus these OPERATIONAL fields
// (role/title, branch, route number, earned certs, approved services, and the
// service/personal scheduling rules). This tool is how the Copilot answers "who
// does bees in Naples?" or "who is route 310?". It returns ONLY the tile fields —
// never pay, discipline, PTO, employee notes, or any personnel-file data — so no
// extra grant is required beyond being signed in (the route authenticates the
// caller before any tool runs). Read-only. Results are capped and compact.

const FIND_PEOPLE_LIMIT = 12;

const findPeople: CopilotTool = {
  schema: {
    name: "find_people",
    description:
      "Search the COMPANY-READABLE org directory for people by name, title, role, branch, service specialty, or route number — e.g. 'who does bees in Naples?', 'who is route 310?', 'what is route 42?'. Returns each match's role/title, branch, route number, earned certifications, approved services, who they report to, and their SCHEDULING RULES (service + personal scheduling notes — relay these when relevant, e.g. 'book bee jobs 3–5 PM'). Visible to all signed-in staff; returns NO pay, discipline, PTO, or personnel-file data. Service tags: bees, wasps, rodents, wildlife, termites, lawn, mosquito, general, consultations.",
    input_schema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Free-text search over name, title, role, branch, route number, and service specialty (e.g. 'Ronnie', 'bees', 'route 42'). Optional." },
        branch: { type: "string", description: "Narrow to a branch (vero|stuart|orlando|naples)." },
        service: { type: "string", description: "Narrow to a service specialty tag (bees|wasps|rodents|wildlife|termites|lawn|mosquito|general|consultations)." },
        routeNumber: { type: "string", description: "Find the person who runs an EXACT route number, e.g. '42' or '310'." },
      },
    },
  },
  handler: async (input) => {
    const query = str(input.query) ?? "";

    // Normalize filters to known keys/tags; ignore anything unrecognized.
    const rawBranch = str(input.branch)?.toLowerCase();
    const branch = rawBranch && BRANCH_KEYS.has(rawBranch) ? rawBranch : null;
    const rawService = str(input.service)?.toLowerCase();
    const service = rawService && isServiceTag(rawService) ? rawService : null;

    const tiles = await orgTileData();
    const byId = new Map(tiles.map((t) => [t.id, t]));
    let results = searchOrg(tiles, query, { branch, service });

    // Exact route-number lookup (strip a leading #/route/rte the model may include).
    const route = str(input.routeNumber);
    if (route) {
      const r = route.replace(/^#/, "").replace(/^(route|rte)\s+/i, "").trim().toLowerCase();
      results = results.filter((t) => !!t.routeNumber && t.routeNumber.toLowerCase() === r);
    }

    const total = results.length;
    const people = results.slice(0, FIND_PEOPLE_LIMIT).map((t) => ({
      name: t.name,
      title: t.title,
      role: t.role,
      branch: t.branchLabel,
      routeNumber: t.routeNumber,
      certifications: t.certifications.map((c) => c.name),
      approvedServices: t.approvedServices.map((s) => s.label),
      serviceNotes: t.serviceNotes,
      serviceSchedulingNote: t.serviceSchedulingNote,
      personalSchedulingNote: t.personalSchedulingNote,
      reportsTo: t.reportsToId ? byId.get(t.reportsToId)?.name ?? null : null,
    }));

    return {
      total,
      returned: people.length,
      truncated: total > people.length,
      note: "Company-readable org directory — operational fields only (no pay, discipline, PTO, or personnel-file data). When relevant, relay each person's scheduling rules (serviceSchedulingNote / personalSchedulingNote).",
      people,
    };
  },
};

// ---- registry ---------------------------------------------------------------

// ===========================================================================
// 10 & 11. Routing — read a route's monthly routing + propose a rebalanced month
// ===========================================================================

async function resolveRoute(ctx: ToolContext, routeQ: string | undefined, branchReq: string | undefined, periodReq: string | undefined) {
  const { getRoutingOverview, listRoutingPeriods, currentRoutingPeriod } = await import("@/lib/routing");
  const { branch } = scopeBranch(ctx, branchReq);
  if (!branch) return { error: "Tell me which branch (vero|stuart|orlando|naples)." as string };
  const period = periodReq ?? (await listRoutingPeriods(branch))[0] ?? currentRoutingPeriod();
  const view = await getRoutingOverview(branch, period);
  if (!view.month.loaded) return { error: `No routing is loaded for ${branchLabel(branch)} (${period}).` };
  const q = (routeQ ?? "").toLowerCase();
  const tech = view.techs.find((t) => t.routeNo === routeQ || t.name.toLowerCase() === q || (q.length > 1 && t.name.toLowerCase().includes(q)));
  if (!tech) return { error: `No route matches "${routeQ}". Routes at ${branchLabel(branch)}: ${view.techs.map((t) => `${t.routeNo} ${t.name}`).join(", ")}` };
  return { branch, period, view, tech };
}

const getRouting: CopilotTool = {
  schema: {
    name: "get_routing",
    description:
      "Read a technician's monthly ROUTING for the caller's branch: totals (stops, days, scheduled production $, avg stops/day, modeled miles/fuel), the per-day stop counts, and any routing flags (heavy/light/uneven days). Use for questions like 'how does route 26 look this month?' or 'which of Rob's days are overloaded?'. Branch-locked managers always get their own branch.",
    input_schema: {
      type: "object",
      properties: {
        route: { type: "string", description: "Route number (e.g. '26') or technician name (e.g. 'Rob')." },
        branch: { type: "string", description: "Branch key; ignored for branch-locked managers." },
        period: { type: "string", description: "Month YYYY-MM; defaults to the loaded month." },
      },
      required: ["route"],
    },
  },
  handler: async (input, ctx) => {
    const r = await resolveRoute(ctx, str(input.route), str(input.branch), str(input.period));
    if ("error" in r) return r;
    const t = r.tech;
    return {
      branch: branchLabel(r.branch), period: r.period, route: t.routeNo, name: t.name, kind: t.kind,
      totals: { stops: t.totalStops, days: t.totalDays, production: Math.round(t.totalDollars), avgStopsPerDay: t.avgStopsPerDay, estMiles: t.estMiles, estFuelUsd: Math.round((t.estMiles ?? 0) / 18 * 3.45) },
      dailyStopCounts: t.loads,
      flags: t.findings.filter((f) => f.severity !== "info").map((f) => ({ severity: f.severity, title: f.title, detail: f.detail })),
      note: "Mileage/fuel are modeled estimates. The manager approves + signs routing in Routing Approval.",
    };
  },
};

const proposeRouteRebalance: CopilotTool = {
  schema: {
    name: "propose_route_rebalance",
    description:
      "Propose a more balanced month for a route by moving stops from its heaviest days to its lightest, OPTIONALLY keeping named customers on their current day. Returns the specific proposed moves and the before/after balance + heaviest-day. Use when the manager asks to rework, rebalance, or even out a route (e.g. 'rebalance route 26 but keep the Smith account on Tuesday'). This is a PROPOSAL only — the manager reviews it in Routing Approval and exports the change set to PestPac; nothing is written.",
    input_schema: {
      type: "object",
      properties: {
        route: { type: "string", description: "Route number or technician name." },
        lockCustomers: { type: "array", items: { type: "string" }, description: "Customer names (or fragments) whose stops must NOT move." },
        branch: { type: "string", description: "Branch key; ignored for branch-locked managers." },
        period: { type: "string", description: "Month YYYY-MM; defaults to the loaded month." },
      },
      required: ["route"],
    },
  },
  handler: async (input, ctx) => {
    const r = await resolveRoute(ctx, str(input.route), str(input.branch), str(input.period));
    if ("error" in r) return r;
    const { getTechDays } = await import("@/lib/routing");
    const { rebalanceRoute } = await import("@/lib/routing-metrics");
    const days = await getTechDays(r.view.month.id, r.tech.name);
    const lockList = Array.isArray(input.lockCustomers) ? (input.lockCustomers as unknown[]).map((x) => String(x).toLowerCase().trim()).filter(Boolean) : [];
    const locked = (date: string, seq: number) => {
      const d = days.find((x) => x.date === date);
      const s = d?.stops.find((st) => st.seq === seq);
      return !!s && lockList.some((lc) => (s.customer || "").toLowerCase().includes(lc));
    };
    const result = rebalanceRoute(days.map((d) => ({ date: d.date, stops: d.stops.map((s) => ({ seq: s.seq, customer: s.customer, amt: s.amt })) })), locked);
    return {
      route: r.tech.routeNo, name: r.tech.name, period: r.period, lockedCustomers: lockList,
      proposedMoves: result.moves.length,
      balance: `${result.balanceBefore} → ${result.balanceAfter}`,
      heaviestDay: `${result.maxBefore} → ${result.maxAfter} stops`,
      moves: result.moves.slice(0, 40),
      note: result.moves.length ? "Proposal only. The manager opens Routing Approval, locks jobs as needed, and exports the change set to PestPac." : "Already well balanced — no moves needed.",
    };
  },
};

export const COPILOT_TOOLS: CopilotTool[] = [
  getBranchKpis,
  getRouting,
  proposeRouteRebalance,
  getMetricDefinition,
  getBranchBenchmarking,
  getNeedsAttention,
  getThisMonthTasks,
  getSopStatus,
  getScorecard,
  lookupEmployee,
  findPeople,
];

export const COPILOT_TOOL_MAP: Map<string, CopilotTool> = new Map(COPILOT_TOOLS.map((t) => [t.schema.name, t]));
