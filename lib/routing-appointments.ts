import "server-only";
import { prisma } from "@/lib/prisma";
import { branchFromTechNumber } from "@/lib/routing-parse";
import { resolveRouteProfiles, normalizeRouteNumber, type RouteKind } from "@/lib/route-profiles";
import { computeMetrics, routeStatus } from "@/lib/routing-metrics";
import { geocodeMany, normalizeAddress } from "@/lib/geocode";
import { parseAppointmentSchedule, shortTechLabel, type ParsedAppt } from "@/lib/routing-appointments-parse";

// Ingest a PestPac "Appointment List" export into the Route* tables as the per-day
// route schedule. Unlike the Technician Schedule Report ingest (lib/routing-ingest),
// this one is APPOINTMENT-driven and carries the scheduled TIME: each day's stops are
// ordered timed-first (in the list's order) then FLOATED (no time) at the end, and the
// time is shown in the UI. One upload covers all four branches; routes are keyed by the
// PestPac route number and labeled by their OWNER (the tech whose number matches the
// route), via route profiles. Re-upload REPLACES that month. See docs/ROUTING-APPROVAL.md.
//
// The pure parser lives in lib/routing-appointments-parse.ts (unit-testable).

function toDate(ymd: string): Date {
  const [y, m, d] = ymd.split("/").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}
function chunk<T>(arr: T[], n: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
}

export async function ingestAppointmentSchedule(opts: {
  text: string;
  fileName: string;
  uploadedById?: string | null;
  uploadedByName?: string | null;
}): Promise<{ ok: boolean; error?: string; periodKey?: string; months?: { branch: string; routes: number; stops: number }[]; geocoded?: number }> {
  const appts = parseAppointmentSchedule(opts.text);
  if (appts.length === 0) return { ok: false, error: "No appointments found — is this the PestPac Appointment List export?" };

  const dates = appts.map((a) => a.date).filter(Boolean).sort();
  const [py, pm] = dates[0].split("/").map(Number);
  const periodKey = `${py}-${String(pm).padStart(2, "0")}`;
  const monthStart = new Date(Date.UTC(py, pm - 1, 1));
  const monthEnd = new Date(Date.UTC(py, pm, 0));

  const profiles = await resolveRouteProfiles();

  type RouteGroup = { routeNo: string; branch: string; kind: RouteKind; name: string; appts: ParsedAppt[] };
  const byRoute = new Map<string, RouteGroup>();
  for (const a of appts) {
    const key = normalizeRouteNumber(a.route);
    const prof = profiles.get(key);
    if (prof?.kind === "exclude") continue;
    let g = byRoute.get(key);
    if (!g) {
      g = { routeNo: a.route, branch: prof?.branch || branchFromTechNumber(a.route), kind: (prof?.kind as RouteKind) || "route", name: prof?.canonicalName || "", appts: [] };
      byRoute.set(key, g);
    }
    g.appts.push(a);
  }
  // Label routes by their OWNER (tech whose number matches the route) when no profile name.
  for (const g of byRoute.values()) {
    if (g.name) continue;
    const owner = g.appts.find((a) => normalizeRouteNumber(a.techLabel.match(/^(\d+)/)?.[1] ?? "") === normalizeRouteNumber(g.routeNo));
    const counts = new Map<string, number>();
    for (const a of g.appts) counts.set(a.techLabel, (counts.get(a.techLabel) ?? 0) + 1);
    const dominant = [...counts.entries()].sort((x, y) => y[1] - x[1])[0]?.[0] ?? g.routeNo;
    g.name = shortTechLabel(owner?.techLabel ?? dominant);
  }

  const geo = await geocodeMany(appts.map((a) => normalizeAddress(a.address ?? "", a.city ?? "", a.state ?? "", a.zip ?? "")), { max: 0 });

  const byBranch = new Map<string, RouteGroup[]>();
  for (const g of byRoute.values()) {
    if (!byBranch.has(g.branch)) byBranch.set(g.branch, []);
    byBranch.get(g.branch)!.push(g);
  }

  const months: { branch: string; routes: number; stops: number }[] = [];

  for (const [branch, groups] of byBranch) {
    const bw = await prisma.routingMonth.upsert({
      where: { branch_periodKey: { branch, periodKey } },
      create: { branch, periodKey, monthStart, monthEnd, status: "open" },
      update: { monthStart, monthEnd, status: "open", signedById: null, signedName: null, signedAt: null, attestation: null },
    });

    await prisma.$transaction([
      prisma.routeStop.deleteMany({ where: { routingMonthId: bw.id } }),
      prisma.routeDay.deleteMany({ where: { routingMonthId: bw.id } }),
      prisma.routeTechMonth.deleteMany({ where: { routingMonthId: bw.id } }),
      prisma.routingFinding.deleteMany({ where: { routingMonthId: bw.id } }),
    ]);

    const techMonthRows: import("@prisma/client").Prisma.RouteTechMonthCreateManyInput[] = [];
    const dayRows: import("@prisma/client").Prisma.RouteDayCreateManyInput[] = [];
    const stopRows: import("@prisma/client").Prisma.RouteStopCreateManyInput[] = [];
    let branchStops = 0;

    for (const g of groups) {
      const byDay = new Map<string, ParsedAppt[]>();
      for (const a of g.appts) {
        if (!byDay.has(a.date)) byDay.set(a.date, []);
        byDay.get(a.date)!.push(a);
      }
      const days = [...byDay.entries()].sort((a, b) => a[0].localeCompare(b[0]));

      const m = computeMetrics(days.map(([, list]) => ({ stops: list.map((a) => ({ amount: a.amount })) })));
      techMonthRows.push({
        routingMonthId: bw.id, techName: g.name, routeNo: g.routeNo,
        totalDays: m.days, totalStops: m.stops, totalDollars: m.dollars, avgStopsPerDay: m.avg,
        estMiles: m.estMiles, estDriveMinutes: m.estDriveMin, kind: g.kind, partnerRouteNo: null,
        status: routeStatus(g.kind, m), source: "upload",
      });

      for (const [date, list] of days) {
        // Timed appointments first (in the list's order), floated (no time) at the end.
        const ordered = [...list.filter((a) => a.time), ...list.filter((a) => !a.time)];
        const n = ordered.length;
        const md = 6 + n * 2.3;
        dayRows.push({
          routingMonthId: bw.id, techName: g.name, date: toDate(date),
          stopCount: n, dollars: ordered.reduce((s, a) => s + a.amount, 0),
          estMiles: Math.round(md), estDriveMinutes: Math.round((md / 32) * 60 + n * 7),
          status: g.kind === "route" ? (n >= 30 ? "alarm" : n >= 26 ? "warn" : "good") : "info",
        });
        ordered.forEach((a, i) => {
          const gc = geo.get(normalizeAddress(a.address ?? "", a.city ?? "", a.state ?? "", a.zip ?? ""));
          stopRows.push({
            routingMonthId: bw.id, techName: g.name, date: toDate(date), seq: i + 1,
            time: a.time, floated: !a.time,
            account: a.account, service: a.service, customer: a.customer,
            address: a.address, city: a.city, zip: a.zip,
            lat: gc?.lat ?? null, lng: gc?.lng ?? null, dollars: a.amount,
          });
        });
      }
      branchStops += m.stops;
    }

    await prisma.routeTechMonth.createMany({ data: techMonthRows });
    for (const c of chunk(dayRows, 500)) await prisma.routeDay.createMany({ data: c });
    for (const c of chunk(stopRows, 500)) await prisma.routeStop.createMany({ data: c });
    await prisma.routingUpload.create({
      data: { routingMonthId: bw.id, fileName: opts.fileName, status: "parsed", rowCount: branchStops, uploadedById: opts.uploadedById ?? null, uploadedByName: opts.uploadedByName ?? null },
    });

    months.push({ branch, routes: groups.length, stops: branchStops });
  }

  return { ok: true, periodKey, months, geocoded: geo.size };
}
