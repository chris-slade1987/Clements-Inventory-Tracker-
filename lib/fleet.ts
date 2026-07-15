import { prisma } from "@/lib/prisma";

// Fleet queries: vehicle registry with rolled-up operating cost, cost-per-mile,
// last service, and next-service-due signals.

export const SERVICE_TYPES = [
  { key: "oil_change", label: "Oil change" },
  { key: "pm", label: "Preventive maintenance" },
  { key: "repair", label: "Repair" },
  { key: "tires", label: "Tires" },
  { key: "inspection", label: "Inspection" },
  { key: "other", label: "Other" },
] as const;

export function serviceLabel(key: string): string {
  return SERVICE_TYPES.find((t) => t.key === key)?.label ?? key;
}

export type VehicleRow = {
  id: string;
  unitNumber: string | null;
  name: string;
  branch: string | null;
  status: string;
  currentMileage: number | null;
  totalCost: number; // all-time maintenance/repair cost
  ytdCost: number;
  costPerMile: number | null;
  lastServiceDate: Date | null;
  nextDueDate: Date | null;
  nextDueMileage: number | null;
  serviceCount: number;
  hasLoan: boolean;
  monthlyPayment: number | null;
  payoffDate: Date | null;
  disposition: string | null;
  dispositionDate: Date | null;
  salePrice: number | null;
};

/** List vehicles. `scope`: "active" (default) hides disposed ones; "inactive"
 *  shows only sold/retired; "all" shows everything. */
export async function listVehicles(branch?: string, scope: "active" | "inactive" | "all" = "active"): Promise<VehicleRow[]> {
  const statusWhere = scope === "active" ? { status: "active" } : scope === "inactive" ? { status: { not: "active" } } : {};
  const vehicles = await prisma.vehicle.findMany({
    where: { ...(branch ? { branch } : {}), ...statusWhere },
    include: { services: true },
    orderBy: [{ status: "asc" }, { name: "asc" }],
  });
  const yearStart = new Date(new Date().getFullYear(), 0, 1);
  return vehicles.map((v) => {
    const total = v.services.reduce((s, r) => s + r.cost, 0);
    const ytd = v.services.filter((r) => r.date >= yearStart).reduce((s, r) => s + r.cost, 0);
    const sorted = [...v.services].sort((a, b) => b.date.getTime() - a.date.getTime());
    const last = sorted[0] ?? null;
    // Nearest upcoming due (by date) across services.
    const nextByDate = v.services
      .filter((r) => r.nextDueDate)
      .sort((a, b) => a.nextDueDate!.getTime() - b.nextDueDate!.getTime())[0] ?? null;
    const nextByMileage = v.services
      .filter((r) => r.nextDueMileage != null)
      .sort((a, b) => (a.nextDueMileage ?? 0) - (b.nextDueMileage ?? 0))[0] ?? null;
    return {
      id: v.id,
      unitNumber: v.unitNumber,
      name: v.name,
      branch: v.branch,
      status: v.status,
      currentMileage: v.currentMileage,
      totalCost: total,
      ytdCost: ytd,
      costPerMile: v.currentMileage && v.currentMileage > 0 ? total / v.currentMileage : null,
      lastServiceDate: last?.date ?? null,
      nextDueDate: nextByDate?.nextDueDate ?? null,
      nextDueMileage: nextByMileage?.nextDueMileage ?? null,
      serviceCount: v.services.length,
      hasLoan: !!(v.loanBank || v.loanNumber || v.monthlyPayment),
      monthlyPayment: v.monthlyPayment ?? null,
      payoffDate: v.payoffDate ?? null,
      disposition: v.disposition ?? null,
      dispositionDate: v.dispositionDate ?? null,
      salePrice: v.salePrice ?? null,
    };
  });
}

export const DISPOSITIONS = [
  { key: "sold", label: "Sold" },
  { key: "retired", label: "Retired" },
  { key: "totaled", label: "Totaled" },
  { key: "traded", label: "Traded in" },
  { key: "transferred", label: "Transferred" },
] as const;

export function dispositionLabel(key: string | null): string {
  return DISPOSITIONS.find((d) => d.key === key)?.label ?? (key ? key : "Retired");
}

export async function vehicleDetail(id: string) {
  const v = await prisma.vehicle.findUnique({
    where: { id },
    include: { services: { orderBy: { date: "desc" } } },
  });
  if (!v) return null;
  const total = v.services.reduce((s, r) => s + r.cost, 0);
  return { vehicle: v, services: v.services, totalCost: total };
}

/** Vehicles due for service soon — next-due date within `days` or mileage within `miles`. */
export function isDueSoon(row: VehicleRow, days = 30, miles = 1000): boolean {
  const now = Date.now();
  if (row.nextDueDate && row.nextDueDate.getTime() - now <= days * 864e5) return true;
  if (row.nextDueMileage != null && row.currentMileage != null && row.nextDueMileage - row.currentMileage <= miles)
    return true;
  return false;
}
