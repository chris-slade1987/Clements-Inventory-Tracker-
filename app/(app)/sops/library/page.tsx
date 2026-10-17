import { redirect } from "next/navigation";
import { PageHeader, EmptyState } from "@/components/ui";
import { requireUser } from "@/lib/auth";
import { BRANCHES } from "@/lib/management";
import { listSopTemplates, openAssignmentCountByTemplate, canManageSops, openAssignments } from "@/lib/sop";
import SopLibrary, { type SopTemplateDTO, type AssignmentDTO } from "./SopLibrary";

export const dynamic = "force-dynamic";

export default async function SopLibraryPage() {
  const user = await requireUser();
  if (!canManageSops(user)) redirect("/my-branch");

  const [templates, counts, assignments] = await Promise.all([
    listSopTemplates({ includeInactive: true }),
    openAssignmentCountByTemplate(),
    openAssignments(null),
  ]);

  const dtos: SopTemplateDTO[] = templates.map((t) => ({
    id: t.id,
    key: t.key,
    title: t.title,
    category: t.category,
    version: t.version,
    active: t.active,
    dueRule: t.dueRule,
    stepCount: t.steps.length,
    openAssignments: counts[t.id] ?? 0,
  }));

  const asgDtos: AssignmentDTO[] = assignments.map((a) => ({
    id: a.id,
    templateTitle: a.title || a.templateTitle,
    branchLabel: a.branchLabel,
    dueDate: a.dueDate ? a.dueDate.toISOString() : null,
    overdue: a.overdue,
    assignedByName: a.assignedByName,
  }));

  return (
    <>
      <PageHeader
        title="SOP Library"
        subtitle="Publish, version, and assign Standard Operating Procedures across the branches"
      />
      {dtos.length === 0 ? (
        <EmptyState title="No SOPs yet" hint="SOP templates are seeded via the deploy path. A full in-app authoring UI is planned." />
      ) : (
        <SopLibrary
          templates={dtos}
          assignments={asgDtos}
          branches={BRANCHES.map((b) => ({ key: b.key, label: b.label }))}
        />
      )}
    </>
  );
}
