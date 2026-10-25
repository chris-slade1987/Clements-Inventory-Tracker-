import { redirect } from "next/navigation";

// The Board — Financial statements dashboard is now the FINANCIALS tab of the
// consolidated Executive dashboard (nav/IA refactor P1). This route redirects
// there (preserving period / basis) so bookmarks keep working. The (app) layout
// still gates this URL on the exec-only `board` access item, preserving the guard.
export default async function BoardRedirect({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const sp = await searchParams;
  const qs = new URLSearchParams();
  qs.set("tab", "financials");
  for (const k of ["p", "basis"]) {
    const v = sp[k];
    if (v) qs.set(k, v);
  }
  redirect(`/executive?${qs.toString()}`);
}
