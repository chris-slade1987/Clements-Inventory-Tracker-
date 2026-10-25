import { redirect } from "next/navigation";

// Branch Benchmarking is now part of the BRANCHES tab of the consolidated
// Executive dashboard (nav/IA refactor P1 — the cross-branch league + year-end
// pacing render below the per-branch P&L). This route redirects there (preserving
// period) so bookmarks keep working. The (app) layout still gates this URL on the
// exec-only `benchmarking` access item, preserving the guard.
export default async function BenchmarkingRedirect({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const sp = await searchParams;
  const qs = new URLSearchParams();
  qs.set("tab", "branches");
  if (sp.p) qs.set("p", sp.p);
  redirect(`/executive?${qs.toString()}`);
}
