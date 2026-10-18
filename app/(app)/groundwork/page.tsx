import { requireUser } from "@/lib/auth";
import { listMyWork, listProjects, assignablePeople } from "@/lib/groundwork";
import { listMyHuddles } from "@/lib/huddles";
import GroundworkHome from "./GroundworkHome";

export const dynamic = "force-dynamic";

// Groundwork — the universal work home for every authenticated user. Four simple
// sections: My Work (To-Dos + assigned follow-ups), Huddles, The Greenhouse
// (someday ideas), and Projects. Initial data is fetched server-side (fast first
// paint, access-scoped in lib/groundwork + lib/huddles); the client takes over
// for quick-add, check-off, and the create flows.
export default async function GroundworkPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const user = await requireUser();
  const sp = await searchParams;
  const tab = sp.tab ?? "my-work";

  const [myWork, huddles, projects, people] = await Promise.all([
    listMyWork(user),
    listMyHuddles(user),
    listProjects(user),
    assignablePeople(user),
  ]);

  return (
    <GroundworkHome
      initialTab={tab}
      firstName={(user.name || "").split(" ")[0] || user.name}
      myWork={myWork}
      huddles={huddles}
      projects={projects}
      people={people}
    />
  );
}
