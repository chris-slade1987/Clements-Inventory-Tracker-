import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { PageHeader } from "@/components/ui";
import { requireUser, isBoardObserver, homePath } from "@/lib/auth";
import { canViewCertifications } from "@/lib/certifications";
import { getEmployeeRecord } from "@/lib/training-center";
import TrainingCenterTabs from "@/components/TrainingCenterTabs";
import EmployeeRecordClient from "./EmployeeRecordClient";

export const dynamic = "force-dynamic";
export const metadata = { title: "Employee Training Record — CanopyOS" };

export default async function EmployeeRecordPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  if (!canViewCertifications(user)) {
    redirect(isBoardObserver(user) ? "/management/board" : homePath(user));
  }
  const { id } = await params;
  const record = await getEmployeeRecord(id);
  if (!record) notFound();

  return (
    <>
      <TrainingCenterTabs showCourses={user.role === "admin"} />
      <div className="mb-2">
        <Link href="/management/training-center/assign" className="text-xs font-medium text-brand-700 hover:underline">
          ← Assign training
        </Link>
      </div>
      <PageHeader
        title={record.employee.name}
        subtitle={[record.employee.role, record.employee.division, record.employee.branch].filter(Boolean).join(" · ") || "Training record"}
      />
      <EmployeeRecordClient record={record} />
    </>
  );
}
