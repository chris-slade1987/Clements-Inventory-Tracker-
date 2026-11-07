import "server-only";
import { prisma } from "@/lib/prisma";
import { creditRoutingMonth } from "@/lib/routing";

// One-time COO directive (Nov 7, 2026): credit Ted Travelute (Orlando) and Corey
// Carter (Naples) with their November 2026 routing sign-off. Both submitted the
// route changes they wanted; the routing department hasn't completed the
// revisions yet, so the month can't be signed — but the managers did the work.
// Uses the durable leadership credit (survives the later re-upload of revised
// routes) and clears any missed-duty strike. Applies once (Setting marker);
// reversible from the Routes page ("Remove credit"). Non-fatal.

const MARKER = "routing_credit_2026_11_orlando_naples_v1";
const CREDITS = [
  { branch: "orlando", manager: "Ted Travelute" },
  { branch: "naples", manager: "Corey Carter" },
];

let _p: Promise<void> | null = null;

export function ensureNovemberRoutingCredits(): Promise<void> {
  if (!_p) _p = run().catch(() => { _p = null; });
  return _p;
}

async function run(): Promise<void> {
  try {
    if (await prisma.setting.findUnique({ where: { key: MARKER } })) return;
    const done: string[] = [];
    for (const c of CREDITS) {
      const r = await creditRoutingMonth({
        branch: c.branch,
        periodKey: "2026-11",
        byName: "Chris Slade (COO)",
        note: `${c.manager} submitted the November route changes he wanted; the routing department has not finished the revisions yet. Credited for completing his part.`,
      });
      done.push(`${c.branch}${r.strikesCleared ? ` (+${r.strikesCleared} strike cleared)` : ""}`);
    }
    await prisma.setting.upsert({ where: { key: MARKER }, update: { value: new Date().toISOString() }, create: { key: MARKER, value: new Date().toISOString() } });
    console.log(`ensureNovemberRoutingCredits: credited November 2026 routing — ${done.join(", ")}.`);
  } catch (e) {
    console.error("ensureNovemberRoutingCredits failed (non-fatal):", e);
  }
}
