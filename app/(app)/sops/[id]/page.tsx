import { notFound } from "next/navigation";
import { PageHeader, BackLink } from "@/components/ui";
import { requireUser, scopedBranch, branchLocked } from "@/lib/auth";
import { BRANCHES, branchLabel } from "@/lib/management";
import { parseItemResults } from "@/lib/checklists";
import { getSopTemplate, getAssignment, canRunSop, sopAttestationText, assignmentPeriodKey } from "@/lib/sop";
import { prisma } from "@/lib/prisma";
import SopRunner from "./SopRunner";

export const dynamic = "force-dynamic";

export default async function SopRunPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  const user = await requireUser();

  const template = await getSopTemplate(id);
  if (!template) notFound();

  // Resolve the assignment (if any) and the branch it pins.
  const assignment = sp.assignment ? await getAssignment(sp.assignment) : null;
  if (sp.assignment && (!assignment || assignment.templateId !== template.id)) notFound();

  let branch: string | null;
  if (assignment) {
    branch = assignment.branch;
  } else {
    const requested = BRANCHES.find((b) => b.key === sp.branch)?.key ?? null;
    branch = scopedBranch(user, requested) ?? (branchLocked(user) ? null : BRANCHES[0].key);
  }
  if (!branch) notFound();

  // If this assignment is already completed, render the signed record read-only.
  let existing = null;
  if (assignment && assignment.status !== "open") {
    const completion = await prisma.checklistCompletion.findUnique({
      where: { templateId_branch_periodKey: { templateId: template.id, branch, periodKey: assignmentPeriodKey(assignment.id) } },
    });
    if (completion) {
      existing = {
        signedName: completion.signedName,
        attestation: completion.attestation,
        createdAt: completion.createdAt.toISOString(),
        itemResults: parseItemResults(completion.itemResults),
      };
    }
  }

  const canSign = canRunSop(user) && (!branchLocked(user) || user.branch === branch) && template.active;
  const attestation = sopAttestationText(user.name, template.title, branch);

  return (
    <>
      <div className="mb-3">
        <BackLink href={`/sops?branch=${branch}`}>All SOPs</BackLink>
      </div>
      <PageHeader title={template.title} subtitle={`${branchLabel(branch)} · v${template.version}`} />
      <SopRunner
        templateId={template.id}
        templateKey={template.key}
        intro={template.intro}
        branch={branch}
        assignmentId={assignment?.id ?? null}
        steps={template.steps}
        attestation={attestation}
        canSign={canSign}
        inactive={!template.active}
        defaultName={user.name}
        existing={existing}
      />
    </>
  );
}
