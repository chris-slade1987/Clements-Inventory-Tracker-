import { redirect } from "next/navigation";

// The Company / Branch KPIs now live at the top-level /management route (the
// Company center's KPIs view). This old path redirects there so bookmarks and
// in-app links keep working. (COO decision, Oct 2026.)
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
  const q = qs.toString();
  redirect(`/management${q ? `?${q}` : ""}`);
}
