import "server-only";
import { prisma } from "@/lib/prisma";
import { parseRoutingReport, groupByDay, branchFromTechNumber, type ParsedStop } from "@/lib/routing-parse";
import { resolveRouteProfiles, normalizeRouteNumber, type RouteKind } from "@/lib/route-profiles";
import { computeMetrics, routeStatus, buildFindings } from "@/lib/routing-metrics";
import { geocodeMany, normalizeAddress } from "@/lib/geocode";

// Ingest a PestPac "Technician Schedule Report" (by technician) into the Route*
// tables. One upload covers all four branches; each tech maps to a branch, so we
// write one RoutingMonth per branch. Re-upload REPLACES that month's data (the
// routing dept revises the draft before month start) and resets it to "open" for
// re-review. Technicians are merged by route number (so a stray name under the
// same number folds in, e.g. NATHAN → route 17 BRIAN) and classified via route
// profiles. Addresses are geocoded (cache-first, best-effort). See docs/ROUTING-APPROVAL.md.

function toDate(ymd: string): Date {
  const [y, m, d] = ymd.split("/").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}
function chunk<T>(arr: T[], n: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
}

type MergedTech = {
  routeNo: string;
  name: string;
  kind: RouteKind;
  branch: string;
  partner: string | null;
  stops: ParsedStop[];
};

function periodLabelOf(periodKey: string): string {
  const [y, m] = periodKey.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
}

/** Parse + classify WITHOUT writing — for the pre-upload confirmation step, so the
 *  admin sees exactly what month, how many technicians/stops, and which branches
 *  before committing (and that it will replace that month). */
export async function previewRoutingReport(text: string): Promise<{
  ok: boolean; error?: string; periodKey?: string; periodLabel?: string; techs?: number; stops?: number; branches?: { branch: string; techs: number; stops: number }[];
}> {
  const parsed = parseRoutingReport(text);
  if (!parsed.techs.length) return { ok: false, error: "No technician sections found — is this the by-technician schedule export (sorted by Technician)?" };
  if (!parsed.periodStart) return { ok: false, error: "Could not read the report's Start Date." };
  const [py, pm] = parsed.periodStart.split("/").map(Number);
  const periodKey = `${py}-${String(pm).padStart(2, "0")}`;
  const profiles = await resolveRouteProfiles();
  const byBranch = new Map<string, { techs: Set<string>; stops: number }>();
  const seen = new Set<string>();
  for (const t of parsed.techs) {
    const key = normalizeRouteNumber(t.techNumber);
    const prof = profiles.get(key);
    if (prof?.kind === "exclude") continue;
    const branch = prof?.branch || branchFromTechNumber(t.techNumber);
    if (!byBranch.has(branch)) byBranch.set(branch, { techs: new Set(), stops: 0 });
    const b = byBranch.get(branch)!;
    b.techs.add(key);
    b.stops += t.stops.length;
    seen.add(key);
  }
  const branches = [...byBranch.entries()].map(([branch, v]) => ({ branch, techs: v.techs.size, stops: v.stops }));
  return { ok: true, periodKey, periodLabel: periodLabelOf(periodKey), techs: seen.size, stops: parsed.totalStops, branches };
}

export async function ingestRoutingReport(opts: {
  text: string;
  fileName: string;
  uploadedById?: string | null;
  uploadedByName?: string | null;
}): Promise<{ ok: boolean; error?: string; periodKey?: string; months?: { branch: string; techs: number; stops: number }[]; geocoded?: number }> {
  const parsed = parseRoutingReport(opts.text);
  if (!parsed.techs.length) return { ok: false, error: "No technician sections found — is this the by-technician schedule export?" };
  if (!parsed.periodStart) return { ok: false, error: "Could not read the report's Start Date." };

  const [py, pm] = parsed.periodStart.split("/").map(Number);
  const periodKey = `${py}-${String(pm).padStart(2, "0")}`;
  const monthStart = new Date(Date.UTC(py, pm - 1, 1));
  const monthEnd = new Date(Date.UTC(py, pm, 0));

  const profiles = await resolveRouteProfiles();

  // Merge parsed techs by route number (folds aliases like NATHAN into route 17).
  const merged = new Map<string, MergedTech>();
  for (const t of parsed.techs) {
    const key = normalizeRouteNumber(t.techNumber);
    const prof = profiles.get(key);
    if (prof?.kind === "exclude") continue;
    let mt = merged.get(key);
    if (!mt) {
      mt = {
        routeNo: t.techNumber,
        name: prof?.canonicalName || t.techName,
        kind: (prof?.kind as RouteKind) || "route",
        branch: prof?.branch || branchFromTechNumber(t.techNumber),
        partner: prof?.partnerRouteNumbers?.[0] || null,
        stops: [],
      };
      merged.set(key, mt);
    }
    mt.stops.push(...t.stops);
  }

  // Resolve coordinates from the CACHE ONLY here (max:0 = no external calls), so
  // ingest stays fast and never blocks on a geocoder. Stops without a cached hit
  // are written with null coordinates and filled by geocodeRoutingMonth() on a
  // later bounded pass (the map falls back to a deterministic layout meanwhile).
  const allStops = [...merged.values()].flatMap((m) => m.stops);
  const geo = await geocodeMany(allStops.map((s) => normalizeAddress(s.address, s.city, s.state, s.zip)), { max: 0 });

  // Group merged techs by branch.
  const byBranch = new Map<string, MergedTech[]>();
  for (const mt of merged.values()) {
    if (!byBranch.has(mt.branch)) byBranch.set(mt.branch, []);
    byBranch.get(mt.branch)!.push(mt);
  }

  const months: { branch: string; techs: number; stops: number }[] = [];

  for (const [branch, techs] of byBranch) {
    const bw = await prisma.routingMonth.upsert({
      where: { branch_periodKey: { branch, periodKey } },
      create: { branch, periodKey, monthStart, monthEnd, status: "open" },
      update: { monthStart, monthEnd, status: "open", signedById: null, signedName: null, signedAt: null, attestation: null },
    });

    // Replace prior data for this month.
    await prisma.$transaction([
      prisma.routeStop.deleteMany({ where: { routingMonthId: bw.id } }),
      prisma.routeDay.deleteMany({ where: { routingMonthId: bw.id } }),
      prisma.routeTechMonth.deleteMany({ where: { routingMonthId: bw.id } }),
      prisma.routingFinding.deleteMany({ where: { routingMonthId: bw.id } }),
    ]);

    const techMonthRows: import("@prisma/client").Prisma.RouteTechMonthCreateManyInput[] = [];
    const dayRows: import("@prisma/client").Prisma.RouteDayCreateManyInput[] = [];
    const stopRows: import("@prisma/client").Prisma.RouteStopCreateManyInput[] = [];
    const findingRows: import("@prisma/client").Prisma.RoutingFindingCreateManyInput[] = [];
    let branchStops = 0;

    for (const t of techs) {
      const days = groupByDay(t.stops); // [{date, stops[]}] in route order
      const m = computeMetrics(days.map((d) => ({ stops: d.stops.map((s) => ({ amount: s.amount })) })));
      const status = routeStatus(t.kind, m);
      techMonthRows.push({
        routingMonthId: bw.id,
        techName: t.name,
        routeNo: t.routeNo,
        totalDays: m.days,
        totalStops: m.stops,
        totalDollars: m.dollars,
        avgStopsPerDay: m.avg,
        estMiles: m.estMiles,
        estDriveMinutes: m.estDriveMin,
        kind: t.kind,
        partnerRouteNo: t.partner,
        status,
        source: "upload",
      });
      for (const d of days) {
        const n = d.stops.length;
        const md = 6 + n * 2.3;
        dayRows.push({
          routingMonthId: bw.id,
          techName: t.name,
          date: toDate(d.date),
          stopCount: n,
          dollars: d.stops.reduce((s, x) => s + x.amount, 0),
          estMiles: Math.round(md),
          estDriveMinutes: Math.round((md / 32) * 60 + n * 7),
          status: t.kind === "route" ? (n >= 30 ? "alarm" : n >= 26 ? "warn" : "good") : "info",
        });
        d.stops.forEach((s, i) => {
          const g = geo.get(normalizeAddress(s.address, s.city, s.state, s.zip));
          stopRows.push({
            routingMonthId: bw.id,
            techName: t.name,
            date: toDate(d.date),
            seq: i + 1,
            service: s.service,
            customer: s.customer,
            address: s.address,
            city: s.city,
            zip: s.zip,
            lat: g?.lat ?? null,
            lng: g?.lng ?? null,
            dollars: s.amount,
          });
        });
      }
      for (const f of buildFindings({ name: t.name, kind: t.kind, partner: t.partner, m })) {
        findingRows.push({
          routingMonthId: bw.id,
          techName: t.name,
          severity: f.severity,
          title: f.title,
          detail: f.detail + (f.rec ? ` — ${f.rec}` : ""),
          question: f.question ?? null,
          requiresResponse: f.requiresResponse,
          source: "rule",
        });
      }
      branchStops += m.stops;
    }

    await prisma.routeTechMonth.createMany({ data: techMonthRows });
    for (const c of chunk(dayRows, 500)) await prisma.routeDay.createMany({ data: c });
    for (const c of chunk(stopRows, 500)) await prisma.routeStop.createMany({ data: c });
    await prisma.routingFinding.createMany({ data: findingRows });
    await prisma.routingUpload.create({
      data: {
        routingMonthId: bw.id,
        fileName: opts.fileName,
        status: "parsed",
        rowCount: branchStops,
        uploadedById: opts.uploadedById ?? null,
        uploadedByName: opts.uploadedByName ?? null,
      },
    });

    months.push({ branch, techs: techs.length, stops: branchStops });
  }

  return { ok: true, periodKey, months, geocoded: geo.size };
}
