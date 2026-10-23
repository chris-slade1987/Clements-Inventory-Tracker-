import { redirect } from "next/navigation";
import { requireUser, isSuperAdmin } from "@/lib/auth";
import { getScanIntel } from "@/lib/scan-intel";
import ScanIntelClient from "./ScanIntelClient";

export const dynamic = "force-dynamic";

// Scan Intelligence — super-admin-only. Closes the "AI identify gets smarter over
// time" loop for check-out photo-identify: a labeled accuracy log of AI_PHOTO
// outcomes, and a "turn good scans into reference photos" review queue. The AI is
// Claude vision at inference time, so improvement = measuring accuracy + growing
// each product's curated reference photos (which identify already compares
// against). See lib/scan-intel.ts + /api/inventory/photo (promoteScan / dismissScan).
export default async function ScanIntelPage() {
  const user = await requireUser();
  if (!isSuperAdmin(user)) redirect("/manage/products");

  const { stats, misses, queue } = await getScanIntel();

  return (
    <ScanIntelClient
      stats={stats}
      misses={misses.map((m) => ({ ...m, at: m.at.toISOString() }))}
      queue={queue.map((q) => ({ ...q, at: q.at.toISOString() }))}
    />
  );
}
