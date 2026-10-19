// Canopy Copilot — suggested prompts + screen labels.
//
// Positive-first starter prompts chosen by the viewer's ROLE and the SCREEN they
// are on, so the panel is never a blank box. Pure + dependency-free (no DOM, no
// server imports) so both the docked panel (`components/CanopyCopilot.tsx`) and
// the inline entry points (`components/AskCanopy.tsx`) can import it.
//
// The positive-first set carries through from the COO-approved concept:
//   "Help me complete my weekly checklist", "What's left for this month's tasks?",
//   "Need help addressing a personnel issue?", "Why is fuel % over budget?"
// with sensible per-screen + per-role variants.

/** Coarse role buckets the panel resolves from the AppShell principal flags. */
export type CopilotRole =
  | "admin"
  | "senior"
  | "field_ops"
  | "manager"
  | "hr"
  | "sales_director"
  | "service_advisor"
  | "board"
  | "employee";

/** The lightweight viewer shape the prompt picker needs (role + branch). */
export type CopilotUser = {
  name?: string | null;
  role: CopilotRole;
  branch?: string | null;
};

// ---- Cross-component open channel ----------------------------------------- //
// The inline <AskCanopy> buttons dispatch this window CustomEvent; the docked
// panel listens for it and opens, primed with the starter. A window event keeps
// the two decoupled (no shared provider needed) and is robust across the tree.
export const COPILOT_OPEN_EVENT = "canopy-copilot:open";
export type CopilotOpenDetail = {
  /** Text to pre-fill the composer with. */
  prompt?: string;
  /** When true, send immediately instead of only priming the box. */
  send?: boolean;
};

function startsWith(path: string, prefix: string): boolean {
  return path === prefix || path.startsWith(prefix + "/");
}

/**
 * 3–4 positive-first starter prompts for the given viewer and screen. Screen
 * matches are most-specific-first; anything unmatched falls back to a role set.
 */
export function suggestedPrompts(user: CopilotUser, screenPath: string): string[] {
  const path = (screenPath || "/").split("?")[0];
  const at = (p: string) => startsWith(path, p);
  const role = user.role;

  // --- Screen-specific (most specific first) ---
  if (at("/my-branch/scorecard") || at("/management/scorecards") || at("/my-branch/team")) {
    if (at("/my-branch/team") || at("/management/people")) {
      return [
        "Who handles bees in my area?",
        "Need help addressing a personnel issue?",
        "How do I document a verbal write-up?",
        "What's the progressive discipline policy?",
      ];
    }
    return [
      "How is my scorecard tracking this quarter?",
      "Which metrics are still Not-Met, and how do I close them?",
      "What counts toward my weighted score?",
    ];
  }
  if (at("/management/people") || at("/hr")) {
    return [
      "Need help addressing a personnel issue?",
      "How do I document a write-up or accident report?",
      "Which handbook acknowledgments are still outstanding?",
    ];
  }
  if (at("/fleet/fuel")) {
    return [
      "Why is fuel % over budget?",
      "Which vehicles are driving the fuel variance?",
      "What's the fuel budget target this month?",
    ];
  }
  if (at("/fleet")) {
    return [
      "Which vehicles are due for service?",
      "What inspections are outstanding this month?",
      "Why is fuel % over budget?",
    ];
  }
  if (at("/checklists") || at("/sops")) {
    return [
      "Help me complete my weekly checklist",
      "Which SOP covers a chemical spill?",
      "What's left to sign off this week?",
    ];
  }
  if (at("/sales") || at("/me/sales")) {
    return [
      "How am I tracking against my monthly sales goal?",
      "Which leads should I follow up on first?",
      "What's my proposal-to-close rate?",
    ];
  }
  if (at("/management") || at("/executive")) {
    return [
      "Why is fuel % over budget?",
      "Which branch is behind on budget this month?",
      "How is attrition trending vs budget?",
    ];
  }
  if (at("/my-branch")) {
    return [
      "Help me complete my weekly checklist",
      "What's left for this month's tasks?",
      "What needs my attention at the branch today?",
    ];
  }
  if (at("/me")) {
    return [
      "What training do I have due?",
      "How do I request time off?",
      "Where do I find the employee handbook?",
    ];
  }

  // --- Role fallback (home / shared screens like /inbox, /account, /help) ---
  switch (role) {
    case "employee":
    case "service_advisor":
      return [
        "What training do I have due?",
        "How do I request time off?",
        "Where do I find the employee handbook?",
      ];
    case "hr":
      return [
        "Who has onboarding steps outstanding?",
        "How do I document a personnel issue?",
        "Which handbook acknowledgments are missing?",
      ];
    case "sales_director":
      return [
        "Which advisors are behind on their goals?",
        "How is the sales team tracking this month?",
        "Which branch has the strongest close rate?",
      ];
    case "board":
    case "senior":
      return [
        "How is the company tracking vs budget?",
        "Why is fuel % over budget?",
        "How is attrition trending vs budget?",
      ];
    case "field_ops":
      return [
        "Which branches have open audit items?",
        "What inspections are outstanding across branches?",
        "Help me complete my weekly checklist",
      ];
    case "admin":
      return [
        "What's left for this month's tasks?",
        "Which branch is behind on budget this month?",
        "Why is fuel % over budget?",
      ];
    case "manager":
    default:
      return [
        "Help me complete my weekly checklist",
        "What's left for this month's tasks?",
        "What needs my attention at the branch today?",
      ];
  }
}

/** A short, human label for the current screen — rendered in the context chip. */
export function screenLabel(path: string): string {
  const p = (path || "/").split("?")[0];
  const map: [string, string][] = [
    ["/my-branch/scorecard", "My Scorecard"],
    ["/my-branch/team", "My Team"],
    ["/my-branch/inspections", "Vehicle Inspections"],
    ["/my-branch/warehouse", "Warehouse Inspection"],
    ["/my-branch/qc", "Quality Control"],
    ["/my-branch/documents", "Branch Hub"],
    ["/my-branch/training", "Team Training"],
    ["/my-branch", "My Branch"],
    ["/checklists/oversight", "Checklist Oversight"],
    ["/checklists", "Checklists"],
    ["/sops/library", "SOP Library"],
    ["/sops", "SOP Runner"],
    ["/fleet/fuel", "Fuel"],
    ["/fleet/service", "Log Service"],
    ["/fleet", "Fleet"],
    ["/management/people", "People / HR"],
    ["/management/scorecards", "Scorecards"],
    ["/management/board", "Board"],
    ["/management/sales", "Sales & Attrition"],
    ["/management/benchmarking", "Branch Benchmarking"],
    ["/management/audits", "Branch Audits"],
    ["/management/compliance", "Compliance"],
    ["/management/training", "Training Center"],
    ["/management", "Company KPIs"],
    ["/executive", "Executive"],
    ["/sales", "Sales Team"],
    ["/me/sales", "My Sales Goals"],
    ["/me/pto", "Time Off"],
    ["/me/training", "My Training"],
    ["/me/library", "Lesson Library"],
    ["/me/profile", "My Profile"],
    ["/me/hr", "HR & Support"],
    ["/me", "Employee Hub"],
    ["/dashboard", "Inventory Dashboard"],
    ["/check-in", "Check-In"],
    ["/check-out", "Check-Out"],
    ["/reconcile", "Reconcile"],
    ["/reports", "Reports"],
    ["/alerts", "Alerts"],
    ["/hr", "HR Command Center"],
    ["/field-ops", "Field Ops"],
    ["/bulletin", "Company Bulletin"],
    ["/inbox", "Inbox"],
    ["/help", "Help"],
    ["/account", "Account"],
  ];
  for (const [prefix, label] of map) {
    if (p === prefix || p.startsWith(prefix + "/")) return label;
  }
  return "Home";
}
