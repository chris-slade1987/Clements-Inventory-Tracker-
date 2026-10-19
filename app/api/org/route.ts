import { NextResponse } from "next/server";
import { fail } from "@/lib/http";
import { getSessionUser } from "@/lib/auth";
import { buildOrgTree, orgTileData, searchOrg } from "@/lib/org-chart";

export const runtime = "nodejs";
export const maxDuration = 20;

// Org Chart (Round 1) — company-readable org tree / tile data + search.
//   GET /api/org                 → { roots, tiles }  (the reporting tree + flat tiles)
//   GET /api/org?q=bees+naples   → { results }        (searchOrg)
//   GET /api/org?branch=naples&service=bees → { results } (filters, q optional)
//   GET /api/org?flat=1          → { tiles }           (flat tile list only)
//
// All authenticated users may view the structure + operational tile fields; sensitive
// personnel data is never selected (see lib/org-chart.ts). Not an Access Rights catalog
// entry (the catalog gates pages/modules, not API routes) — Round 2 owns the page.
export async function GET(req: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  try {
    const url = new URL(req.url);
    const q = url.searchParams.get("q");
    const branch = url.searchParams.get("branch");
    const service = url.searchParams.get("service");

    // Search mode when a query or any filter is present.
    if ((q && q.trim()) || branch || service) {
      const tiles = await orgTileData();
      const results = searchOrg(tiles, q ?? "", { branch, service });
      return NextResponse.json({ results });
    }

    if (url.searchParams.get("flat") === "1") {
      return NextResponse.json({ tiles: await orgTileData() });
    }

    const { roots, tiles } = await buildOrgTree();
    return NextResponse.json({ roots, tiles });
  } catch (e) {
    return fail(e);
  }
}
