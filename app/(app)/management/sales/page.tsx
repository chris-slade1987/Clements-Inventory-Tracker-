import { redirect } from "next/navigation";

// Sales & Attrition is now the SALES tab of the consolidated Executive dashboard
// (nav/IA refactor P1). This route redirects there (preserving period / basis /
// scope) so bookmarks keep working. The Sales Team operations hub stays separate at
// `/sales`. The (app) layout still gates this URL on the `sales-attrition` access
// item (exec + Sales Director), preserving the guard.
export default async function SalesRedirect({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const sp = await searchParams;
  const qs = new URLSearchParams();
  qs.set("tab", "sales");
  for (const k of ["p", "basis", "scope"]) {
    const v = sp[k];
    if (v) qs.set(k, v);
  }
  redirect(`/executive?${qs.toString()}`);
}
