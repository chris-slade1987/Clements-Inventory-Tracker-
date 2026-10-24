import { redirect } from "next/navigation";

// The weekly oversight checklist has been folded into Branch Command (the weekly
// cockpit — fed scoreboard + forced-feedback + attested sign-off). This index now
// redirects there so there is ONE weekly surface and no double sign-off. The
// leadership rollup still lives at /checklists/oversight (a separate route).
export const dynamic = "force-dynamic";

export default async function ChecklistsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const sp = await searchParams;
  redirect(sp.branch ? `/branch-command?branch=${sp.branch}` : "/branch-command");
}
