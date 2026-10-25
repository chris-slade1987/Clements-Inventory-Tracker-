import { redirect } from "next/navigation";

// The Company / Branch KPIs now live on the consolidated Executive dashboard's
// Overview tab (/executive?tab=overview). This old path redirects there so bookmarks
// and in-app links keep working. (nav/IA refactor, Oct 2026.)
export default async function MyBranchKpisRedirect({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const sp = await searchParams;
  const qs = new URLSearchParams();
  for (const k of ["branch", "p"]) {
    const v = sp[k];
    if (v) qs.set(k, v);
  }
  qs.set("tab", "overview");
  redirect(`/executive?${qs.toString()}`);
}
