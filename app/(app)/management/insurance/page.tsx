import { redirect } from "next/navigation";

// Insurance is now the INSURANCE tab of the Compliance & Insurance Command Center
// (nav/IA refactor P2 — both are licenses / policies / renewals). This route is kept
// as a redirect so old links / bookmarks keep working. The (app) layout still gates
// this URL on the `insurance` access item (admin / senior / HR), preserving the
// former guard.
export default function InsuranceRedirect() {
  redirect("/management/compliance?tab=insurance");
}
