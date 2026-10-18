import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { getProject, assignablePeople, canManageProject } from "@/lib/groundwork";
import ProjectDetail from "./ProjectDetail";

export const dynamic = "force-dynamic";

// A single Groundwork project: its tasks, members, owner, due date, and a simple
// progress bar. "Send to people" adds members + assigns their tasks (they're
// notified via the Inbox). Access-scoped by getProject (member/owner/leadership).
export default async function ProjectPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireUser();
  const [data, people] = await Promise.all([getProject(user, id), assignablePeople(user)]);
  if (!data) notFound();
  const canManage = await canManageProject(user, { ownerId: data.project.ownerId, members: data.project.members });
  return (
    <ProjectDetail
      initialProject={data.project}
      initialItems={data.items}
      people={people}
      meId={user.id}
      canManage={canManage}
    />
  );
}
