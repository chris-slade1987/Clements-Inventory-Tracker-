import { prisma } from "@/lib/prisma";
import { listServiceAdvisors } from "@/lib/sales";
import { LEAD_CHANNELS } from "@/lib/sales-leads";

// Sample lead rows for the geographic heat map + lead-source board, so the Sales
// Team screens are fully populated before SmarterLaunch is connected. Everything
// written here is tagged `origin="demo"` and removed by the demo tooling's
// "clear" action (and at the SmarterLaunch cutover). Realistic Florida
// coordinates clustered around the four branch areas.

type Area = { neighborhood: string; zip: string; city: string; lat: number; lng: number; weight: number };

// Real-ish neighborhood centroids around each branch. Weight ≈ relative density.
const BRANCH_AREAS: Record<string, Area[]> = {
  vero: [
    { neighborhood: "Central Beach", zip: "32963", city: "Vero Beach", lat: 27.6558, lng: -80.3689, weight: 3 },
    { neighborhood: "Vero Lake Estates", zip: "32967", city: "Vero Beach", lat: 27.7075, lng: -80.4553, weight: 2 },
    { neighborhood: "Downtown Vero", zip: "32960", city: "Vero Beach", lat: 27.6386, lng: -80.3973, weight: 4 },
    { neighborhood: "Gifford", zip: "32967", city: "Vero Beach", lat: 27.6719, lng: -80.4094, weight: 1 },
    { neighborhood: "Sebastian", zip: "32958", city: "Sebastian", lat: 27.8164, lng: -80.4706, weight: 2 },
  ],
  stuart: [
    { neighborhood: "Downtown Stuart", zip: "34994", city: "Stuart", lat: 27.1975, lng: -80.2528, weight: 3 },
    { neighborhood: "Palm City", zip: "34990", city: "Palm City", lat: 27.1689, lng: -80.2889, weight: 3 },
    { neighborhood: "Jensen Beach", zip: "34957", city: "Jensen Beach", lat: 27.2578, lng: -80.2306, weight: 2 },
    { neighborhood: "Rocky Point", zip: "34996", city: "Stuart", lat: 27.1719, lng: -80.2008, weight: 1 },
    { neighborhood: "Port Salerno", zip: "34992", city: "Port Salerno", lat: 27.1414, lng: -80.2008, weight: 2 },
  ],
  orlando: [
    { neighborhood: "Downtown Orlando", zip: "32801", city: "Orlando", lat: 28.5383, lng: -81.3792, weight: 3 },
    { neighborhood: "Winter Park", zip: "32789", city: "Winter Park", lat: 28.5999, lng: -81.3392, weight: 3 },
    { neighborhood: "Baldwin Park", zip: "32814", city: "Orlando", lat: 28.5633, lng: -81.3375, weight: 2 },
    { neighborhood: "Lake Nona", zip: "32827", city: "Orlando", lat: 28.3772, lng: -81.2672, weight: 2 },
    { neighborhood: "College Park", zip: "32804", city: "Orlando", lat: 28.5722, lng: -81.3958, weight: 2 },
  ],
  naples: [
    { neighborhood: "Old Naples", zip: "34102", city: "Naples", lat: 26.1420, lng: -81.7948, weight: 3 },
    { neighborhood: "Park Shore", zip: "34103", city: "Naples", lat: 26.1897, lng: -81.8028, weight: 2 },
    { neighborhood: "North Naples", zip: "34109", city: "Naples", lat: 26.2378, lng: -81.7692, weight: 3 },
    { neighborhood: "Pelican Bay", zip: "34108", city: "Naples", lat: 26.2383, lng: -81.8042, weight: 2 },
    { neighborhood: "Golden Gate", zip: "34116", city: "Naples", lat: 26.1844, lng: -81.6950, weight: 2 },
  ],
};

// A seeded PRNG so a reload produces the same board (stable demo).
function mulberry32(seed: number) {
  return function () {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pick<T>(rng: () => number, arr: readonly T[]): T {
  return arr[Math.floor(rng() * arr.length)];
}

// Weighted area pick.
function pickArea(rng: () => number, areas: Area[]): Area {
  const total = areas.reduce((s, a) => s + a.weight, 0);
  let r = rng() * total;
  for (const a of areas) { r -= a.weight; if (r <= 0) return a; }
  return areas[0];
}

// Stage mix: most leads are open, a chunk proposals, a slice closed.
const STAGES = ["lead", "lead", "lead", "proposal", "proposal", "closed"] as const;

export const DEMO_LEAD_ORIGIN = "demo";

/** Load sample leads for every active service advisor, clustered in their branch
 *  areas and spread across the year so every date range populates. Idempotent:
 *  clears prior demo leads first. Returns how many leads were created. */
export async function loadDemoLeads(): Promise<{ loaded: number; advisors: number }> {
  const advisors = await listServiceAdvisors(null);
  if (advisors.length === 0) return { loaded: 0, advisors: 0 };

  await prisma.salesLead.deleteMany({ where: { origin: DEMO_LEAD_ORIGIN } });

  const now = new Date();
  const rows: {
    advisorEmployeeId: string; advisorName: string; branch: string | null;
    address: string; city: string; zip: string; neighborhood: string; lat: number; lng: number;
    stage: string; channel: string; provided: boolean; value: number; origin: string; createdAt: Date;
  }[] = [];

  advisors.forEach((a, idx) => {
    const branch = a.branch && BRANCH_AREAS[a.branch] ? a.branch : "vero";
    const areas = BRANCH_AREAS[branch];
    const rng = mulberry32(0x5a1e5 + idx * 977);
    const count = 22 + Math.floor(rng() * 16); // 22–37 leads per advisor

    for (let i = 0; i < count; i++) {
      const area = pickArea(rng, areas);
      const lat = area.lat + (rng() - 0.5) * 0.03;
      const lng = area.lng + (rng() - 0.5) * 0.03;
      const channel = pick(rng, LEAD_CHANNELS);
      const stage = pick(rng, STAGES);
      // Value: closed leads carry a real figure; proposals an estimate; leads a smaller estimate.
      const base = 320 + Math.floor(rng() * 1400);
      const value = stage === "closed" ? base + 200 : stage === "proposal" ? base : Math.round(base * 0.6);
      // Spread createdAt across the last ~10 months, weighted toward recent.
      const daysAgo = Math.floor(Math.pow(rng(), 1.7) * 300);
      const createdAt = new Date(now.getTime() - daysAgo * 86400000);
      const streetNo = 100 + Math.floor(rng() * 9800);

      rows.push({
        advisorEmployeeId: a.id,
        advisorName: a.name,
        branch,
        address: `${streetNo} ${area.neighborhood} ${pick(rng, ["Ave", "St", "Dr", "Ln", "Ct", "Blvd"])}`,
        city: area.city,
        zip: area.zip,
        neighborhood: area.neighborhood,
        lat, lng,
        stage,
        channel: channel.key,
        provided: channel.provided,
        value,
        origin: DEMO_LEAD_ORIGIN,
        createdAt,
      });
    }
  });

  // createMany is efficient and supported on SQLite + Postgres here.
  await prisma.salesLead.createMany({ data: rows });
  return { loaded: rows.length, advisors: advisors.length };
}

/** Remove all sample leads. */
export async function clearDemoLeads(): Promise<number> {
  const res = await prisma.salesLead.deleteMany({ where: { origin: DEMO_LEAD_ORIGIN } });
  return res.count;
}
