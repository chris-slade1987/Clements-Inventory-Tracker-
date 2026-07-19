import { prisma } from "@/lib/prisma";
import { BRANCHES, branchLabel } from "@/lib/management";

// Compliance Command Center — a company-wide lens over the compliance data that
// already lives in the Branch Hub (licenses, business licenses, leases),
// Insurance, and Fleet (vehicle documents). It READS those source records, so
// fixing something in its home module clears it here too, and vice-versa.
// New regulated categories (DOT files, OSHA 300, SDS, etc.) slot in as they're
// added — this v1 consolidates what's on the site today.

const DAY = 864e5;

export type ComplianceStatus = "ok" | "warning" | "critical" | "expired" | "missing";

export type ComplianceItem = {
  id: string;
  category: string;
  categoryLabel: string;
  title: string;
  branch: string | null;
  entity: string | null; // person / vehicle this is attached to
  detail: string | null; // license #, carrier, etc.
  status: ComplianceStatus;
  expiration: Date | null;
  daysOut: number | null;
  href: string;
};

const CATEGORY_LABEL: Record<string, string> = {
  operator_license: "Certified operator",
  business_license: "FDACS business license",
  insurance: "Insurance",
  lease: "Facility lease",
  vehicle_insurance: "Vehicle insurance",
  vehicle_registration: "Vehicle registration",
};

function statusFromDate(exp: Date | null, now: number, warnDays = 90, critDays = 30): { status: ComplianceStatus; daysOut: number | null } {
  if (!exp) return { status: "ok", daysOut: null };
  const daysOut = Math.round((exp.getTime() - now) / DAY);
  if (daysOut < 0) return { status: "expired", daysOut };
  if (daysOut <= critDays) return { status: "critical", daysOut };
  if (daysOut <= warnDays) return { status: "warning", daysOut };
  return { status: "ok", daysOut };
}

const RANK: Record<ComplianceStatus, number> = { ok: 0, warning: 1, critical: 2, missing: 3, expired: 4 };
export const worst = (a: ComplianceStatus, b: ComplianceStatus): ComplianceStatus => (RANK[a] >= RANK[b] ? a : b);

/** Every tracked compliance item, normalized. Optionally scoped to a branch. */
export async function complianceItems(branch?: string | null): Promise<ComplianceItem[]> {
  const now = Date.now();
  const branchWhere = branch ? { branch } : {};

  const [docs, policies, vehDocs] = await Promise.all([
    prisma.branchDocument.findMany({
      where: { category: { in: ["licensing", "lease"] }, ...branchWhere },
      include: { employee: { select: { name: true } } },
    }),
    branch ? Promise.resolve([]) : prisma.insurancePolicy.findMany({ where: { status: { in: ["active", "pending", "application", "expired"] } } }),
    prisma.vehicleDocument.findMany({
      where: { category: { in: ["insurance", "registration"] }, expirationDate: { not: null }, ...(branch ? { vehicle: { branch } } : {}) },
      include: { vehicle: { select: { unitNumber: true, branch: true } } },
    }),
  ]);

  const items: ComplianceItem[] = [];

  for (const d of docs) {
    if (d.category === "licensing") {
      const isBiz = d.licenseType === "business";
      const cat = isBiz ? "business_license" : "operator_license";
      const s = statusFromDate(d.expirationDate, now);
      items.push({
        id: d.id, category: cat, categoryLabel: CATEGORY_LABEL[cat],
        title: d.title, branch: d.branch, entity: d.employee?.name ?? d.holderName ?? null,
        detail: d.licenseNumber ? `#${d.licenseNumber}` : null,
        status: s.status, expiration: d.expirationDate, daysOut: s.daysOut,
        href: `/my-branch/documents?branch=${d.branch}`,
      });
    } else if (d.category === "lease") {
      const s = statusFromDate(d.leaseEnd, now, 270, 90); // 9-month lead on leases
      items.push({
        id: d.id, category: "lease", categoryLabel: CATEGORY_LABEL.lease,
        title: d.title, branch: d.branch, entity: d.landlord ?? null,
        detail: d.monthlyRent != null ? `$${Math.round(d.monthlyRent).toLocaleString()}/mo` : null,
        status: s.status, expiration: d.leaseEnd, daysOut: s.daysOut,
        href: `/my-branch/documents?branch=${d.branch}`,
      });
    }
  }

  for (const p of policies) {
    const s = p.status === "expired" ? { status: "expired" as ComplianceStatus, daysOut: p.expirationDate ? Math.round((p.expirationDate.getTime() - now) / DAY) : null } : statusFromDate(p.expirationDate, now);
    items.push({
      id: p.id, category: "insurance", categoryLabel: CATEGORY_LABEL.insurance,
      title: p.name, branch: null, entity: p.carrier ?? null,
      detail: p.policyNumber ? `#${p.policyNumber}` : null,
      status: s.status, expiration: p.expirationDate, daysOut: s.daysOut,
      href: `/management/insurance`,
    });
  }

  for (const v of vehDocs) {
    const cat = v.category === "insurance" ? "vehicle_insurance" : "vehicle_registration";
    const s = statusFromDate(v.expirationDate, now, 60, 21);
    items.push({
      id: v.id, category: cat, categoryLabel: CATEGORY_LABEL[cat],
      title: v.vehicle?.unitNumber ? `${CATEGORY_LABEL[cat]} — Unit ${v.vehicle.unitNumber}` : v.title,
      branch: v.vehicle?.branch ?? null, entity: v.vehicle?.unitNumber ? `Unit ${v.vehicle.unitNumber}` : null,
      detail: v.insurer ?? v.policyNumber ?? null,
      status: s.status, expiration: v.expirationDate, daysOut: s.daysOut,
      href: `/fleet${v.vehicle?.branch ? `?branch=${v.vehicle.branch}` : ""}`,
    });
  }

  return items;
}

// ---- Coverage matrix (branches × legal requirements) -----------------------

export type Requirement = { key: string; label: string; critical: boolean };
export const REQUIREMENTS: Requirement[] = [
  { key: "operator_license", label: "Certified operator", critical: true },
  { key: "business_license", label: "FDACS business license", critical: true },
  { key: "insurance", label: "General liability insurance", critical: true },
  { key: "lease", label: "Facility lease", critical: false },
];

export type Cell = { status: ComplianceStatus; expiration: Date | null };

export async function coverageMatrix() {
  const items = await complianceItems();
  const glActive = items.some((i) => i.category === "insurance" && i.status !== "expired" && i.status !== "missing"); // company-wide GL proxy
  const glStatus: ComplianceStatus = glActive ? worstOf(items.filter((i) => i.category === "insurance")) : "missing";

  const rows = BRANCHES.map((b) => {
    const cells: Record<string, Cell> = {};
    for (const req of REQUIREMENTS) {
      if (req.key === "insurance") { cells[req.key] = { status: glStatus, expiration: null }; continue; }
      const forBranch = items.filter((i) => i.category === req.key && i.branch === b.key);
      if (forBranch.length === 0) {
        // A lease may not exist (owned property) — treat as N/A, not a gap.
        cells[req.key] = { status: req.key === "lease" ? "ok" : "missing", expiration: null };
      } else {
        cells[req.key] = { status: forBranch.map((i) => i.status).reduce(worst, "ok"), expiration: forBranch[0].expiration };
      }
    }
    return { branch: b.key as string, label: b.label as string, cells };
  });
  return { rows, requirements: REQUIREMENTS };
}

function worstOf(items: ComplianceItem[]): ComplianceStatus {
  return items.map((i) => i.status).reduce(worst, "ok");
}

// ---- Branch health (RAG) ---------------------------------------------------

export type HealthIssue = { text: string; level: "red" | "amber" };
export type Health = { branch: string; label: string; status: "green" | "amber" | "red"; issues: HealthIssue[] };

export async function branchHealth(): Promise<Health[]> {
  const { rows } = await coverageMatrix();
  return rows.map((r) => {
    const issues: HealthIssue[] = [];
    let status: "green" | "amber" | "red" = "green";
    for (const req of REQUIREMENTS) {
      const c = r.cells[req.key];
      if (c.status === "missing" && req.critical) { issues.push({ text: `No ${req.label.toLowerCase()}`, level: "red" }); status = "red"; }
      else if (c.status === "expired") { issues.push({ text: `${req.label} expired`, level: "red" }); status = "red"; }
      else if (c.status === "critical") { issues.push({ text: `${req.label} expiring soon`, level: "amber" }); if (status !== "red") status = "amber"; }
      else if (c.status === "warning") { issues.push({ text: `${req.label} renewal approaching`, level: "amber" }); if (status === "green") status = "amber"; }
    }
    return { branch: r.branch, label: r.label, status, issues };
  });
}

// ---- Needs attention + forward calendar ------------------------------------

export async function needsAttention(): Promise<ComplianceItem[]> {
  const items = await complianceItems();
  const order: ComplianceStatus[] = ["expired", "missing", "critical"];
  return items.filter((i) => order.includes(i.status)).sort((a, b) => RANK[b.status] - RANK[a.status] || (a.daysOut ?? 0) - (b.daysOut ?? 0));
}

export async function renewalCalendar(days = 90): Promise<ComplianceItem[]> {
  const now = Date.now();
  const items = await complianceItems();
  return items
    .filter((i) => i.expiration && i.expiration.getTime() >= now && i.expiration.getTime() <= now + days * DAY)
    .sort((a, b) => a.expiration!.getTime() - b.expiration!.getTime());
}

// ---- Obligations & cash ----------------------------------------------------

export type Obligation = { date: Date; label: string; amount: number; kind: "insurance" | "rent" };

export async function obligations(months = 6): Promise<{ items: Obligation[]; byMonth: { month: string; total: number }[] }> {
  const now = new Date();
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + months, 1));

  const [installments, leases] = await Promise.all([
    prisma.insuranceInstallment.findMany({ where: { paid: false, dueDate: { gte: start, lte: end } }, include: { policy: { select: { name: true } } }, orderBy: { dueDate: "asc" } }),
    prisma.branchDocument.findMany({ where: { category: "lease", monthlyRent: { not: null } } }),
  ]);

  const items: Obligation[] = [];
  for (const i of installments) items.push({ date: i.dueDate, label: `${i.policy.name}${i.label ? ` · ${i.label}` : ""}`, amount: i.amount, kind: "insurance" });
  // Recurring monthly rent on the 1st of each month in the window.
  for (const l of leases) {
    for (let m = 0; m < months; m++) {
      const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + m, 1));
      if (d.getTime() < start.getTime()) continue;
      items.push({ date: d, label: `Rent — ${branchLabel(l.branch)}${l.landlord ? ` (${l.landlord})` : ""}`, amount: l.monthlyRent ?? 0, kind: "rent" });
    }
  }
  items.sort((a, b) => a.date.getTime() - b.date.getTime());

  const byMonthMap = new Map<string, number>();
  for (const it of items) {
    const key = `${it.date.getUTCFullYear()}-${String(it.date.getUTCMonth() + 1).padStart(2, "0")}`;
    byMonthMap.set(key, (byMonthMap.get(key) ?? 0) + it.amount);
  }
  const byMonth = [...byMonthMap.entries()].map(([month, total]) => ({ month, total })).sort((a, b) => a.month.localeCompare(b.month));
  return { items, byMonth };
}
