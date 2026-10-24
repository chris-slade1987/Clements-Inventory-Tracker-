import "server-only";
import { prisma } from "@/lib/prisma";

// Data access for the Routing Approval dashboard. Reads the Route* tables the
// ingest layer populated and assembles the branch view + the sign-off gate. Heavy
// per-stop data (for the map + stop list) is fetched per technician on demand via
// getTechDays(), so the page payload stays light. See docs/ROUTING-APPROVAL.md.

export function currentRoutingPeriod(date: Date = new Date()): string {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}
function monthBounds(periodKey: string): { start: Date; end: Date } {
  const [y, m] = periodKey.split("-").map(Number);
  return { start: new Date(Date.UTC(y, m - 1, 1)), end: new Date(Date.UTC(y, m, 0)) };
}

/** Find-or-create the open RoutingMonth for a branch + period (no children — the
 *  data arrives via upload). Lets the page render an "awaiting upload" state. */
export async function ensureRoutingMonth(branch: string, periodKey = currentRoutingPeriod()) {
  let rm = await prisma.routingMonth.findUnique({ where: { branch_periodKey: { branch, periodKey } } });
  if (!rm) {
    const { start, end } = monthBounds(periodKey);
    rm = await prisma.routingMonth
      .create({ data: { branch, periodKey, monthStart: start, monthEnd: end, status: "open" } })
      .catch(async () => prisma.routingMonth.findUnique({ where: { branch_periodKey: { branch, periodKey } } }));
  }
  return rm!;
}

export type RoutingOverview = Awaited<ReturnType<typeof getRoutingOverview>>;

export async function getRoutingOverview(branch: string, periodKey = currentRoutingPeriod()) {
  const month = await ensureRoutingMonth(branch, periodKey);
  const [techRows, findingRows, upload, dayRows] = await Promise.all([
    prisma.routeTechMonth.findMany({ where: { routingMonthId: month.id } }),
    prisma.routingFinding.findMany({ where: { routingMonthId: month.id }, orderBy: { createdAt: "asc" } }),
    prisma.routingUpload.findFirst({ where: { routingMonthId: month.id }, orderBy: { uploadedAt: "desc" } }),
    prisma.routeDay.findMany({ where: { routingMonthId: month.id }, orderBy: { date: "asc" }, select: { techName: true, stopCount: true } }),
  ]);

  const loadsByTech = new Map<string, number[]>();
  for (const d of dayRows) {
    if (!loadsByTech.has(d.techName)) loadsByTech.set(d.techName, []);
    loadsByTech.get(d.techName)!.push(d.stopCount);
  }

  const findingsByTech = new Map<string, typeof findingRows>();
  for (const f of findingRows) {
    if (!findingsByTech.has(f.techName ?? "")) findingsByTech.set(f.techName ?? "", []);
    findingsByTech.get(f.techName ?? "")!.push(f);
  }

  const techs = techRows
    .map((t) => ({
      id: t.id,
      routeNo: t.routeNo,
      name: t.techName,
      kind: t.kind,
      partnerRouteNo: t.partnerRouteNo,
      totalDays: t.totalDays,
      totalStops: t.totalStops,
      totalDollars: t.totalDollars,
      avgStopsPerDay: t.avgStopsPerDay,
      estMiles: t.estMiles,
      estDriveMinutes: t.estDriveMinutes,
      status: t.status,
      approved: t.approved,
      approvedNote: t.approvedNote,
      perStop: t.totalStops ? t.totalDollars / t.totalStops : 0,
      loads: loadsByTech.get(t.techName) ?? [],
      findings: (findingsByTech.get(t.techName) ?? []).map((f) => ({
        id: f.id,
        severity: f.severity,
        title: f.title,
        detail: f.detail,
        question: f.question,
        requiresResponse: f.requiresResponse,
        managerResponse: f.managerResponse,
        status: f.status,
      })),
    }))
    .sort((a, b) => b.totalDollars - a.totalDollars);

  const openRequired = findingRows.filter((f) => f.requiresResponse && f.status !== "answered").length;
  const unapproved = techs.filter((t) => !t.approved).length;
  const gate = {
    techs: techs.length,
    unapproved,
    openFindings: openRequired,
    canSign: month.status !== "signed" && techs.length > 0 && unapproved === 0 && openRequired === 0,
  };

  return {
    month: {
      id: month.id,
      branch,
      periodKey,
      status: month.status,
      signedName: month.signedName,
      signedAt: month.signedAt ? month.signedAt.toISOString() : null,
      loaded: techs.length > 0,
      uploadedAt: upload?.uploadedAt ? upload.uploadedAt.toISOString() : null,
      uploadedBy: upload?.uploadedByName ?? null,
    },
    techs,
    gate,
    totals: {
      stops: techs.reduce((s, t) => s + t.totalStops, 0),
      dollars: techs.reduce((s, t) => s + t.totalDollars, 0),
      miles: techs.reduce((s, t) => s + (t.estMiles ?? 0), 0),
    },
  };
}

/** Per-technician day + stop detail for the map and stop list (fetched on demand). */
export async function getTechDays(routingMonthId: string, techName: string) {
  const stops = await prisma.routeStop.findMany({
    where: { routingMonthId, techName },
    orderBy: [{ date: "asc" }, { seq: "asc" }],
    select: { date: true, seq: true, service: true, customer: true, address: true, city: true, zip: true, lat: true, lng: true, dollars: true },
  });
  const byDate = new Map<string, typeof stops>();
  for (const s of stops) {
    const key = s.date.toISOString().slice(0, 10);
    if (!byDate.has(key)) byDate.set(key, []);
    byDate.get(key)!.push(s);
  }
  return [...byDate.entries()].map(([date, ss]) => ({
    date,
    stops: ss.map((s) => ({
      seq: s.seq,
      svc: s.service ?? "",
      customer: s.customer ?? "",
      addr: s.address ?? "",
      city: s.city ?? "",
      zip: s.zip ?? "",
      lat: s.lat,
      lng: s.lng,
      amt: s.dollars ?? 0,
    })),
  }));
}

/** Compact status for the Manager Checklist / rhythm (does not create the month). */
export async function getRoutingSummary(branch: string, periodKey = currentRoutingPeriod()) {
  const month = await prisma.routingMonth.findUnique({ where: { branch_periodKey: { branch, periodKey } }, select: { status: true, id: true } }).catch(() => null);
  if (!month) return { exists: false, loaded: false, signed: false, status: "open" as string };
  const techs = await prisma.routeTechMonth.count({ where: { routingMonthId: month.id } }).catch(() => 0);
  return { exists: true, loaded: techs > 0, signed: month.status === "signed", status: month.status };
}
