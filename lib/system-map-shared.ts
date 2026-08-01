// Client-safe System Map types + presentational metadata. Kept SEPARATE from
// `lib/system-map.ts` (which is `server-only` and reads the filesystem) so the
// System Map client component can import `STATUS_META` and the types without
// pulling the server-only, fs-backed parser into the browser bundle.

export type WorkflowStatus = "aligned" | "stale" | "contradicts" | "missing";

export type Workflow = {
  name: string;
  description: string;
  routes: string[];
  status: WorkflowStatus;
  roles: string[];
};

export type Domain = {
  name: string;
  workflows: Workflow[];
};

export type ProcessFlow = { key: string; title: string; description: string; mermaid: string };

export const STATUS_META: Record<
  WorkflowStatus,
  { label: string; emoji: string; chip: string; dot: string }
> = {
  aligned: { label: "Aligned", emoji: "✅", chip: "bg-emerald-100 text-emerald-800", dot: "bg-emerald-500" },
  stale: { label: "Stale", emoji: "⚠️", chip: "bg-amber-100 text-amber-800", dot: "bg-amber-500" },
  contradicts: { label: "Contradicts", emoji: "❌", chip: "bg-red-100 text-red-800", dot: "bg-red-500" },
  missing: { label: "Missing", emoji: "🆕", chip: "bg-sky-100 text-sky-800", dot: "bg-sky-500" },
};
