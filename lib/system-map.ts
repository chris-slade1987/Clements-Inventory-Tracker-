import "server-only";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { WorkflowStatus, Workflow, Domain, ProcessFlow } from "@/lib/system-map-shared";

// Re-export the shared types so existing server-side importers keep working.
export type { WorkflowStatus, Workflow, Domain, ProcessFlow } from "@/lib/system-map-shared";
export { STATUS_META } from "@/lib/system-map-shared";

// ---------------------------------------------------------------------------
// System Map model — parsed from the code-derived workflow registry
// (`docs/WORKFLOWS.md`). This turns the living registry into a typed model the
// admin System Map screen renders as (a) an interconnection flowchart, (b)
// curated role-by-role swimlanes, and (c) a workflow directory grouped by
// domain. The registry is the single source of truth; we never assert here —
// we parse what the docs say and fail soft on any malformed row.
// ---------------------------------------------------------------------------

// Types + STATUS_META now live in `lib/system-map-shared.ts` (client-safe) and
// are re-exported above.

// ---- Parsing ---------------------------------------------------------------

function parseStatus(cell: string): WorkflowStatus | null {
  if (cell.includes("✅")) return "aligned";
  if (cell.includes("❌")) return "contradicts";
  if (cell.includes("⚠")) return "stale";
  if (cell.includes("🆕")) return "missing";
  return null;
}

/** Pull `/route`-shaped tokens out of the backtick spans in the "what it does" cell. */
function extractRoutes(description: string): string[] {
  const routes = new Set<string>();
  const spans = description.match(/`[^`]+`/g) || [];
  for (const span of spans) {
    const inner = span.slice(1, -1);
    for (const raw of inner.split(/[\s,]+/)) {
      const tok = raw.replace(/^[(\[]+/, "").replace(/[.,;:)\]]+$/, "").trim();
      // A route is a leading-slash path; skip bare `lib/x.ts` module refs.
      if (/^\/[A-Za-z0-9[\]_\-/]*$/.test(tok)) routes.add(tok);
    }
  }
  return [...routes].sort((a, b) => {
    const ai = a.startsWith("/api") ? 1 : 0;
    const bi = b.startsWith("/api") ? 1 : 0;
    return ai - bi || a.localeCompare(b);
  });
}

/**
 * Heuristic role inference from route prefixes + keywords. Deliberately
 * generous — a workflow can touch several roles. Order below is the display
 * order.
 */
function inferRoles(name: string, description: string, routes: string[]): string[] {
  const roles: string[] = [];
  const add = (r: string) => {
    if (!roles.includes(r)) roles.push(r);
  };
  const hay = `${name} ${description}`.toLowerCase();
  const onRoute = (pred: (r: string) => boolean) => routes.some(pred);

  // Employee — self-service surfaces.
  if (onRoute((r) => r === "/me" || r.startsWith("/me/") || r.startsWith("/onboarding") || r.startsWith("/apply") || r.startsWith("/careers"))) {
    add("Employee");
  }

  // Branch Manager — branch ops, catalog admin, checklists.
  if (
    onRoute((r) => r.startsWith("/my-branch") || r.startsWith("/checklists") || r.startsWith("/dashboard") || r.startsWith("/check-in") || r.startsWith("/check-out") || r.startsWith("/reconcile") || r.startsWith("/alerts") || r.startsWith("/reports") || r.startsWith("/fleet")) ||
    (onRoute((r) => r.startsWith("/manage") && !r.startsWith("/management")) ) ||
    /\bmanager\b|branch/.test(hay)
  ) {
    add("Branch Manager");
  }

  // HR — people/hiring/onboarding machinery.
  if (
    onRoute((r) => r.startsWith("/management/people")) ||
    /\bhr\b|hiring|candidate|applicant|onboard|pre-hire|prehire|handbook|personnel|absence|call-?out|pto|training|interview|scorecard \(hr\)/.test(hay)
  ) {
    add("HR");
  }

  // Leadership — the executive/management surfaces + escalations + oversight.
  if (
    onRoute((r) => r.startsWith("/management") || r.startsWith("/checklists/oversight")) ||
    /leadership|executive|\bceo\b|\bcoo\b|escalat|chief of staff|field ops|senior/.test(hay)
  ) {
    add("Leadership");
  }

  // Board Observer — read-only exec principal.
  if (onRoute((r) => r.startsWith("/management/board")) || /board observer|board \/ executive|board member/.test(hay)) {
    add("Board Observer");
  }

  // Admin — anything gated to admin / utility tooling.
  if (/\badmin\b|requireadmin|admin-only|admin\/|utility|import|seed|connector|cron|sync/.test(hay) || onRoute((r) => r.startsWith("/api"))) {
    add("Admin");
  }

  if (roles.length === 0) add("Admin");
  return roles;
}

const SKIP_HEADINGS = /^(summary|open items)/i;

function parseWorkflows(md: string): Domain[] {
  const lines = md.split(/\r?\n/);
  const domains: Domain[] = [];
  let current: Domain | null = null;
  let inWorkflowTable = false;

  for (const line of lines) {
    const heading = line.match(/^##\s+(.*)$/);
    if (heading) {
      const name = heading[1].trim();
      inWorkflowTable = false;
      if (SKIP_HEADINGS.test(name)) {
        current = null;
        continue;
      }
      current = { name, workflows: [] };
      domains.push(current);
      continue;
    }

    if (!current) continue;
    const trimmed = line.trim();
    if (!trimmed.startsWith("|")) {
      inWorkflowTable = false;
      continue;
    }

    const cells = trimmed
      .replace(/^\|/, "")
      .replace(/\|$/, "")
      .split("|")
      .map((c) => c.trim());

    // Header row of a workflow table (has a "Workflow" column).
    if (!inWorkflowTable) {
      if (/^workflow$/i.test(cells[0]) && cells.some((c) => /status/i.test(c))) {
        inWorkflowTable = true;
      }
      continue;
    }

    // Separator row.
    if (cells.every((c) => /^:?-{2,}:?$/.test(c) || c === "")) continue;

    // Data row — be resilient: need at least name + description + a status.
    if (cells.length < 5) continue;
    const name = cells[0].replace(/\*\*/g, "").trim();
    const description = cells[1].trim();
    if (!name || !description) continue;
    // Status lives in the 5th column in the canonical 6-column layout; scan the
    // tail cells so a row with an extra/short column still resolves.
    let status: WorkflowStatus | null = null;
    for (let i = cells.length - 1; i >= 2 && !status; i--) {
      status = parseStatus(cells[i]);
    }
    if (!status) continue;

    const routes = extractRoutes(description);
    current.workflows.push({
      name,
      description,
      routes,
      status,
      roles: inferRoles(name, description, routes),
    });
  }

  return domains.filter((d) => d.workflows.length > 0);
}

/** Read + parse the registry. Never throws — a read/parse failure yields []. */
export function getSystemMap(): Domain[] {
  try {
    const md = readFileSync(join(process.cwd(), "docs", "WORKFLOWS.md"), "utf8");
    return parseWorkflows(md);
  } catch {
    return [];
  }
}

// ---- Curated interconnection flowchart -------------------------------------

/**
 * A domain-level flowchart of how the operating centers connect. Curated (not
 * auto-generated) so it reads like a consulting process map: each operating
 * center is a subgraph, solid edges are in-center flow, dashed edges are the
 * key cross-center handoffs.
 */
export function interconnectionMermaid(): string {
  return `flowchart TB
  classDef center fill:#ecfdf5,stroke:#059669,stroke-width:1px,color:#064e3b;

  subgraph PLATFORM["🔐 Platform · Auth & Access"]
    LOGIN["Login / session"]
    ROLES["Roles & flags<br/>admin · manager · employee<br/>seniorLeadership · hrAccess · boardObserver"]
    LOGIN --> ROLES
  end

  subgraph INV["📦 Inventory"]
    CHECKIN["Check-IN<br/>invoice AI + confirm"]
    CATALOG["Catalog governance<br/>confirm queue"]
    CHECKOUT["Check-OUT<br/>UoM + hard stops"]
    LEDGER["Stock ledger<br/>SUM(movements)"]
    ALERTS["Alerts + reconcile"]
    CHECKIN --> LEDGER
    CATALOG --> CHECKOUT
    CHECKOUT --> LEDGER
    LEDGER --> ALERTS
  end

  subgraph FLEET["🚚 Fleet"]
    VEH["Vehicle registry"]
    SERVICE["Service / fuel / inspections"]
    GPS["GPS telemetry + detection"]
    GPSALERT["GPS alerts"]
    VEH --> SERVICE
    VEH --> GPS
    GPS --> GPSALERT
  end

  subgraph HR["🧑‍🤝‍🧑 People / HR"]
    ATS["Hiring pipeline (ATS)"]
    PREHIRE["Pre-hire onboarding"]
    EMP["Employee lifecycle"]
    RECORDS["Reviews · discipline · PTO · absence"]
    ATS --> PREHIRE --> EMP --> RECORDS
  end

  subgraph MGMT["📊 Management · Leadership"]
    MBR["MBR ingestion"]
    DASH["KPI dashboards"]
    SCORE["Manager scorecards"]
    COMPLY["Compliance Command Center"]
    BOARD["Board / Executive"]
    MBR --> DASH --> SCORE
    DASH --> BOARD
  end

  ROLES -. gates every center .-> INV
  ROLES -. gates every center .-> FLEET
  ROLES -. gates every center .-> HR
  ROLES -. gates every center .-> MGMT
  CHECKOUT -. insufficient-stock escalation .-> MGMT
  ALERTS -. spend feeds KPIs .-> MGMT
  GPSALERT -. exceptions .-> MGMT
  SERVICE -. vehicle and insurance docs .-> COMPLY
  RECORDS -. compliance obligations .-> COMPLY
  EMP -. login provisioning .-> PLATFORM
  SCORE -. checklist completion .-> HR

  class LOGIN,ROLES,CHECKIN,CATALOG,CHECKOUT,LEDGER,ALERTS,VEH,SERVICE,GPS,GPSALERT,ATS,PREHIRE,EMP,RECORDS,MBR,DASH,SCORE,COMPLY,BOARD center;`;
}

// ---- Curated role-by-role process flows (swimlanes) ------------------------

export const processFlows: ProcessFlow[] = [
  {
    key: "checkout-hardstop",
    title: "Check-Out · insufficient-stock hard stop → escalation",
    description:
      "A warehouse dispersal that trips the non-overridable over-dispense / unconfirmed-product hard stop and escalates to senior leadership.",
    mermaid: `sequenceDiagram
    autonumber
    actor Mgr as Branch Manager
    participant Portal as Check-Out screen
    participant Ledger as Stock ledger
    actor Snr as Senior Leadership<br/>(COO / Dir Field Ops / Chief of Staff)
    Mgr->>Portal: Pick warehouse + technician + product, qty in canonical UoM
    Portal->>Ledger: on-hand = SUM(movements)?
    alt Confirmed product & sufficient stock
        Portal->>Ledger: Post negative check_out movement
        Ledger-->>Portal: On-hand decremented
        Portal-->>Mgr: Dispersal recorded
    else Unconfirmed product OR over-dispense (negative stock)
        Portal--xMgr: HARD STOP — not overridable by a manager
        Mgr->>Snr: One-click escalation thread
        Snr->>Ledger: Restock / adjust / confirm product
        Snr-->>Mgr: Resolution — retry dispersal
    end`,
  },
  {
    key: "hiring-pipeline",
    title: "Hiring pipeline · applicant → HR → supervisor → CEO → pre-hire → employee",
    description:
      "The full ATS handoff chain from public application through forced-ranking interview, CEO-approved selection, magic-link onboarding, and employee creation.",
    mermaid: `sequenceDiagram
    autonumber
    actor App as Applicant
    participant Front as Public apply page
    actor HR
    actor Sup as Interviewing Supervisor
    actor CEO
    participant Portal as Hiring pipeline
    App->>Front: Submit application + résumé
    Front->>Portal: Create candidate (stage: Applied)
    Portal->>HR: Notify new applicant
    HR->>App: Request screening call (booking link)
    App-->>HR: Complete screening
    HR->>Portal: Shortlist → Screening, assign supervisor + deadline
    Portal->>Sup: Notify — interview assigned
    Sup->>App: Standardized interview (template questionnaire)
    Sup->>Portal: Submit forced rankings (top 3 required)
    Portal->>HR: Notify HR + CEO of rankings
    Portal->>CEO: Notify HR + CEO of rankings
    CEO-->>HR: Approve finalist
    HR->>Portal: Select finalist → runners-up auto-excluded (kept warm)
    Portal->>App: Warm-rejection emails to non-selected
    HR->>App: Move to Pre-hire — magic link
    App->>Portal: Onboarding — consents + handbook acknowledgment
    Portal->>HR: Pre-hire ready for approval
    HR->>Portal: Approve → create Employee (30/60-day reviews scheduled)`,
  },
];
