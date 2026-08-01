import Link from "next/link";
import { PageHeader } from "@/components/ui";
import { requireAdmin } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { BRANCHES, branchLabel } from "@/lib/management";
import { listEmployees } from "@/lib/people";
import { emailConfigured } from "@/lib/email";
import AuditForm from "./AuditForm";

export const dynamic = "force-dynamic";

const iso = (d: Date | null | undefined) => (d ? d.toISOString().slice(0, 10) : "");

export default async function AuditEditPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const user = await requireAdmin();
  const sp = await searchParams;
  const now = new Date();
  const branch = BRANCHES.find((b) => b.key === sp.branch)?.key ?? BRANCHES[0].key;
  const year = Number(sp.year) || now.getFullYear();
  const quarter = [1, 2, 3, 4].includes(Number(sp.quarter)) ? Number(sp.quarter) : Math.floor(now.getMonth() / 3) + 1;

  const existing = await prisma.branchAudit.findUnique({
    where: { branch_year_quarter: { branch, year, quarter } },
    include: { rideAlongs: true, followUps: { orderBy: { createdAt: "asc" } } },
  });
  const employees = (await listEmployees(branch)).map((e) => ({ id: e.id, name: e.name }));

  const prefill = {
    visitDate: existing ? iso(existing.visitDate) : iso(now),
    auditorName: existing?.auditorName ?? user.name,
    facility: safe(existing?.facility),
    personnel: safe(existing?.personnel),
    ratings: safe(existing?.ratings),
    facilityIssues: existing?.facilityIssues ?? "",
    concerns: existing?.concerns ?? "",
    suggestions: existing?.suggestions ?? "",
    nextQuarterPlan: existing?.nextQuarterPlan ?? "",
    status: existing?.status ?? "draft",
    rideAlongs: (existing?.rideAlongs ?? []).map((r) => ({
      employeeId: r.employeeId ?? "",
      technicianName: r.technicianName ?? "",
      serviceType: r.serviceType ?? "",
      customerInteraction: r.customerInteraction ?? null,
      serviceExecution: r.serviceExecution ?? null,
      equipmentPrep: r.equipmentPrep ?? null,
      safety: r.safety ?? null,
      customerNotes: r.customerNotes ?? "",
      executionNotes: r.executionNotes ?? "",
      equipmentNotes: r.equipmentNotes ?? "",
      safetyNotes: r.safetyNotes ?? "",
      strengths: r.strengths ?? "",
      improvement: r.improvement ?? "",
      coaching: r.coaching ?? "",
    })),
    followUps: (existing?.followUps ?? []).map((f) => ({ description: f.description, dueDate: iso(f.dueDate) })),
  };

  return (
    <>
      <div className="mb-2">
        <Link href="/management/audits" className="text-xs font-medium text-brand-700 hover:underline">← Branch Audits</Link>
      </div>
      <PageHeader title={`Quarterly Audit — ${branchLabel(branch)}`} subtitle={`Q${quarter} ${year} · Director of Field Ops`} />
      <AuditForm
        branch={branch}
        year={year}
        quarter={quarter}
        employees={employees}
        prefill={prefill}
        emailConfigured={emailConfigured()}
      />
    </>
  );
}

function safe(s: string | null | undefined): Record<string, unknown> {
  if (!s) return {};
  try { return JSON.parse(s); } catch { return {}; }
}
