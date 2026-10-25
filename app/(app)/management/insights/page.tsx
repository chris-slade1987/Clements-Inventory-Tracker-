import { redirect } from "next/navigation";

// The standalone Insights page is retired (nav/IA refactor P1): the docked Canopy
// Copilot is the single AI entry point, available on every screen. This route is
// kept as a redirect to the Executive dashboard so old bookmarks don't 404. The
// (app) layout still gates this URL on the `insights` access item (admin + senior
// leadership), preserving the former guard.
export default function InsightsRedirect() {
  redirect("/executive?tab=overview");
}
