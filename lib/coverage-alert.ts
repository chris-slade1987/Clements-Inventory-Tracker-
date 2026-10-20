import "server-only";
import { prisma } from "@/lib/prisma";
import { parseApprovedServices } from "@/lib/service-catalog";
import { branchLabel } from "@/lib/management";
import {
  postSystemThread,
  employeeRecipient,
  hrRecipients,
  branchSupervisorRecipients,
  type SystemRecipient,
} from "@/lib/threads";

// ---------------------------------------------------------------------------
// Departure coverage-gap alert.
//
// When someone is offboarded (voluntary leave OR termination), figure out which
// of the services they're approved to perform would be left thin or UNCOVERED in
// their branch, and alert the people who have to react: the departing person's
// supervisor (their reporting manager + branch managers), HR, and the CSR
// Coordinator (Emily) — because the CSRs are the ones scheduling the work and
// need to know a capability just walked out the door.
//
// Example the COO gave: if Jason Borden is the only Naples tech approved for
// Bees and he leaves, the alert says "Bees — NO other active Naples tech is
// approved" so someone arranges coverage until a replacement is hired.
//
// Capability source = the org-chart "Approved to do" services on each Employee
// (lib/service-catalog). Best-effort: a notification must never block offboarding.
// ---------------------------------------------------------------------------

type Gap = { key: string; label: string; others: string[]; companyOthers: string[] };

export async function notifyDepartureCoverageGaps(opts: {
  employeeId: string;
  separationType?: string | null;
  lastDay?: Date | null;
  actorName?: string | null;
}): Promise<string | null> {
  const emp = await prisma.employee.findUnique({
    where: { id: opts.employeeId },
    select: { id: true, name: true, role: true, title: true, branch: true, reportsToId: true, approvedServices: true },
  });
  if (!emp) return null;

  const branch = emp.branch;
  const label = branch ? branchLabel(branch) : "Company";
  const myServices = parseApprovedServices(emp.approvedServices);

  // Coverage analysis — for each service the leaver is approved for, who else is
  // approved, in-branch (the ones who can actually take the routes) and company-wide.
  const gaps: Gap[] = [];
  if (myServices.length) {
    const [branchPeers, companyPeers] = await Promise.all([
      branch
        ? prisma.employee.findMany({
            where: { status: "active", branch, id: { not: emp.id } },
            select: { name: true, approvedServices: true },
          })
        : Promise.resolve([]),
      prisma.employee.findMany({
        where: { status: "active", id: { not: emp.id } },
        select: { name: true, branch: true, approvedServices: true },
      }),
    ]);

    for (const svc of myServices) {
      const inBranch = branchPeers
        .filter((p) => parseApprovedServices(p.approvedServices).some((s) => s.key === svc.key))
        .map((p) => p.name);
      const company = companyPeers
        .filter((p) => parseApprovedServices(p.approvedServices).some((s) => s.key === svc.key))
        .map((p) => `${p.name}${p.branch ? ` (${branchLabel(p.branch)})` : ""}`);
      // Flag a service only when branch coverage is at risk (nobody, or a single backup).
      if (inBranch.length <= 1) gaps.push({ key: svc.key, label: svc.label, others: inBranch, companyOthers: company });
    }
    // Most exposed first: zero backups, then one backup.
    gaps.sort((a, b) => a.others.length - b.others.length);
  }

  // Recipients: supervisor (reporting manager) + branch managers + HR + CSR Coordinator.
  const recipients: SystemRecipient[] = [];
  if (emp.reportsToId) {
    const sup = await employeeRecipient(emp.reportsToId);
    if (sup) recipients.push(sup);
  }
  recipients.push(...(await branchSupervisorRecipients(branch)));
  recipients.push(...(await hrRecipients()));
  // CSR Coordinator(s) — Emily Trione by role/title; resilient to a rename.
  const coordinators = await prisma.employee.findMany({
    where: {
      status: "active",
      OR: [{ title: { contains: "Customer Service Coordinator" } }, { role: { contains: "Customer Service Coordinator" } }],
    },
    select: { id: true },
  });
  for (const c of coordinators) {
    const r = await employeeRecipient(c.id);
    if (r) recipients.push(r);
  }

  // Compose the notice.
  const who = [emp.title || emp.role, label].filter(Boolean).join(" · ");
  const when = opts.lastDay
    ? new Date(opts.lastDay).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
    : null;
  const kind = opts.separationType === "voluntary" ? "is leaving" : "is departing";

  const lines: string[] = [];
  lines.push(`${emp.name}${who ? ` (${who})` : ""} ${kind}${when ? `, last day ${when}` : ""}.`);
  if (opts.actorName) lines.push(`Offboarding filed by ${opts.actorName}.`);
  lines.push("");

  if (gaps.length) {
    lines.push(`Service coverage at risk in ${label} — please confirm who covers these until a replacement is in place:`);
    for (const g of gaps) {
      if (g.others.length === 0) {
        const co = g.companyOthers.length ? ` Company-wide, only: ${g.companyOthers.join(", ")}.` : " No one else in the company is approved either.";
        lines.push(`• ${g.label} — NO other active ${label} team member is approved.${co}`);
      } else {
        lines.push(`• ${g.label} — only one backup in ${label}: ${g.others[0]}.`);
      }
    }
  } else if (myServices.length) {
    lines.push(`Approved services (${myServices.map((s) => s.label).join(", ")}) all have backup coverage in ${label}. No immediate service gap — proceed with the standard backfill.`);
  } else {
    lines.push(`No "Approved to do" services are tagged for ${emp.name} on the org chart. Review their responsibilities and confirm coverage before their last day.`);
  }
  lines.push("");
  lines.push("Open the Org Chart to reassign routes and see who else is approved.");

  const subject = gaps.some((g) => g.others.length === 0)
    ? `Coverage gap — ${emp.name} (${label}) leaving`
    : `Departure coverage check — ${emp.name} (${label})`;

  return postSystemThread({
    subject,
    body: lines.join("\n"),
    recipients,
    contextType: "alert",
    contextLabel: "Coverage at risk",
    contextHref: branch ? `/org?branch=${branch}` : "/org",
    branch,
  }).catch(() => null);
}
