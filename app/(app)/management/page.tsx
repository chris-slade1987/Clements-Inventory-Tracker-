import { redirect } from "next/navigation";

// Company KPIs are now the OVERVIEW tab of the consolidated Executive dashboard
// (nav/IA refactor P1). This route redirects there, preserving the branch / period
// / basis / scope query so bookmarks and in-app links (e.g. the My Branch "KPIs"
// toggle) keep working and land on the same role-scoped view.
export default async function ManagementRedirect({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const sp = await searchParams;
  const qs = new URLSearchParams();
  qs.set("tab", "overview");
  for (const k of ["branch", "p", "basis", "scope"]) {
    const v = sp[k];
    if (v) qs.set(k, v);
  }
  redirect(`/executive?${qs.toString()}`);
}
