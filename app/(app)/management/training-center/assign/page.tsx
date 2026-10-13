import { redirect } from "next/navigation";
import { PageHeader } from "@/components/ui";
import { requireUser, isBoardObserver, homePath } from "@/lib/auth";
import { canViewCertifications, listAssignmentGuide, listModules } from "@/lib/certifications";
import { listActiveEmployees, listCourseCatalog } from "@/lib/training-center";
import TrainingCenterTabs from "@/components/TrainingCenterTabs";
import AssignClient from "./AssignClient";

export const dynamic = "force-dynamic";
export const metadata = { title: "Assign Training — CanopyOS" };

export default async function AssignPage() {
  const user = await requireUser();
  if (!canViewCertifications(user)) {
    redirect(isBoardObserver(user) ? "/management/board" : homePath(user));
  }

  const [employees, situations, modules, courses] = await Promise.all([
    listActiveEmployees(),
    listAssignmentGuide(),
    listModules(),
    listCourseCatalog(),
  ]);

  return (
    <>
      <TrainingCenterTabs showCourses={user.role === "admin"} />
      <PageHeader
        title="Assign training"
        subtitle="Pick an employee, choose a module or a single course, preview what they'll do, then confirm. Automatic credit, prerequisites, and pacing are applied for you."
      />
      <AssignClient
        employees={employees}
        situations={situations}
        modules={modules.map((m) => ({ code: m.code, name: m.name, certificationsEarned: m.certificationsEarned }))}
        courses={courses}
      />
    </>
  );
}
