import { prisma } from "@/lib/prisma";

// Branch hub: per-branch documents (operator licensing, facility lease, other)
// and the key vendor / service contacts a new manager would need.

export const BRANCH_DOC_CATEGORIES = [
  { key: "licensing", label: "Licensing", hint: "Certified operator licenses, business licenses" },
  { key: "lease", label: "Lease & Facility", hint: "Warehouse / office lease, utilities, facility docs" },
  { key: "other", label: "Other", hint: "Anything else worth keeping on file" },
] as const;

export function docCategoryLabel(key: string): string {
  return BRANCH_DOC_CATEGORIES.find((c) => c.key === key)?.label ?? "Other";
}

export const CONTACT_CATEGORIES = [
  { key: "property_manager", label: "Property Manager" },
  { key: "landlord", label: "Landlord / Owner" },
  { key: "maintenance", label: "Facility Maintenance" },
  { key: "chemical_vendor", label: "Chemical Vendor / Rep" },
  { key: "fdacs", label: "FDACS Representative" },
  { key: "vehicle_maintenance", label: "Vehicle Maintenance" },
  { key: "vehicle_wrap", label: "Vehicle Wrap / Graphics" },
  { key: "utilities", label: "Utilities" },
  { key: "other", label: "Other" },
] as const;

export function contactCategoryLabel(key: string): string {
  return CONTACT_CATEGORIES.find((c) => c.key === key)?.label ?? "Other";
}

export const LICENSE_TYPES = [
  { key: "cpo", label: "Certified Pest Operator (FDACS)" },
  { key: "business", label: "Business / Occupational License" },
  { key: "other", label: "Other credential" },
] as const;

const DAY = 864e5;

export async function branchDocuments(branch: string) {
  const docs = await prisma.branchDocument.findMany({
    where: { branch },
    include: { employee: { select: { id: true, name: true, branch: true } } },
    orderBy: [{ category: "asc" }, { expirationDate: "asc" }, { createdAt: "desc" }],
  });
  return BRANCH_DOC_CATEGORIES.map((c) => ({ key: c.key as string, label: c.label, hint: c.hint, items: docs.filter((d) => d.category === c.key) }));
}

export async function branchContacts(branch: string) {
  const rows = await prisma.branchContact.findMany({ where: { branch }, orderBy: [{ category: "asc" }, { sortOrder: "asc" }, { name: "asc" }] });
  return CONTACT_CATEGORIES.map((c) => ({ key: c.key as string, label: c.label, items: rows.filter((r) => r.category === c.key) })).filter((g) => g.items.length > 0);
}

/** The certified pest operator(s) overseeing a branch, with license status. */
export async function certifiedOperators(branch: string) {
  const now = Date.now();
  const licenses = await prisma.branchDocument.findMany({
    where: { branch, category: "licensing", licenseType: "cpo" },
    include: { employee: { select: { id: true, name: true, branch: true } } },
    orderBy: { expirationDate: "asc" },
  });
  return licenses.map((l) => ({
    id: l.id,
    holder: l.employee?.name ?? l.holderName ?? "—",
    employeeId: l.employeeId,
    employeeBranch: l.employee?.branch ?? null,
    licenseNumber: l.licenseNumber,
    categories: l.categories,
    expirationDate: l.expirationDate,
    daysOut: l.expirationDate ? Math.round((l.expirationDate.getTime() - now) / DAY) : null,
  }));
}

/** License / credential docs tied to a person (shown on their profile). */
export async function documentsForEmployee(employeeId: string) {
  return prisma.branchDocument.findMany({ where: { employeeId }, orderBy: [{ expirationDate: "asc" }, { createdAt: "desc" }] });
}

export function rentIncreasePct(rent: number | null, prior: number | null): number | null {
  if (rent == null || prior == null || prior <= 0) return null;
  return ((rent - prior) / prior) * 100;
}
