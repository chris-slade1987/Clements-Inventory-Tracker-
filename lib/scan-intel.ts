import "server-only";
import { prisma } from "@/lib/prisma";

// ---------------------------------------------------------------------------
// Scan Intelligence — the "AI identify gets smarter over time" loop for the
// inventory check-out AI photo-identify. The AI is Claude vision at inference
// time (NOT a trained model), so "training" here means two things:
//   1. MEASURE accuracy — score each AI_PHOTO check-out line by comparing the
//      AI's top pick (CheckoutLine.aiSuggestedProductId, captured at identify
//      time) against the product the manager CONFIRMED (CheckoutLine.productId).
//   2. GROW each product's curated reference photos — surface good confirmed
//      scans so a super admin can promote them into ProductPhotos (which
//      /api/inventory/identify already compares against).
//
// Read-only aggregation over existing rows. Everything degrades to empty when
// there are no scans yet. No manager-comp data; no secrets.
// ---------------------------------------------------------------------------

// A product has at most this many assigned reference photos (mirrors the cap in
// /api/inventory/photo). A scan is a promotion candidate only below this.
export const MAX_PHOTOS_PER_PRODUCT = 3;

// Keep the dashboards snappy — cap the recent-misses and promotion lists.
const RECENT_MISSES_CAP = 20;
const PROMOTION_QUEUE_CAP = 30;
const TREND_WINDOW_DAYS = 30;

export type ScanStats = {
  totalScans: number; // AI_PHOTO lines (all time)
  scored: number; // of those, lines that carry an AI suggestion (scorable)
  correct: number; // scored lines where the AI's #1 == the confirmed product
  corrections: number; // scored lines where it differed
  top1Accuracy: number | null; // correct / scored (0..1), or null when nothing scored
  correctionRate: number | null; // corrections / scored (0..1), or null
  // Simple trend: top-1 accuracy over the last 30 days vs the 30 before it.
  recentAccuracy: number | null;
  priorAccuracy: number | null;
  recentScored: number;
};

export type ScanMiss = {
  lineId: string;
  photoUrl: string | null;
  suggestedName: string; // what the AI ranked #1
  confirmedName: string; // what the manager actually picked
  confidence: number | null;
  at: Date;
  by: string | null; // the issuing manager
  branch: string | null; // warehouse name
};

export type PromotionCandidate = {
  lineId: string;
  productId: string;
  productName: string;
  photoUrl: string;
  existingPhotos: number; // assigned reference photos the product already has (0..2)
  confidence: number | null;
  identifiedBy: string;
  at: Date;
  by: string | null;
  branch: string | null;
};

function ratio(n: number, d: number): number | null {
  return d > 0 ? n / d : null;
}

/** Top-1 accuracy, totals, correction rate, and a 30-day trend. */
export async function getScanStats(): Promise<ScanStats> {
  const now = Date.now();
  const recentCutoff = new Date(now - TREND_WINDOW_DAYS * 864e5);
  const priorCutoff = new Date(now - 2 * TREND_WINDOW_DAYS * 864e5);

  // Only AI_PHOTO lines matter here. Pull the minimum needed to score them.
  const lines = await prisma.checkoutLine.findMany({
    where: { identifiedBy: "AI_PHOTO" },
    select: {
      productId: true,
      aiSuggestedProductId: true,
      checkout: { select: { createdAt: true } },
    },
  });

  let scored = 0;
  let correct = 0;
  let recentScored = 0;
  let recentCorrect = 0;
  let priorScored = 0;
  let priorCorrect = 0;

  for (const l of lines) {
    if (!l.aiSuggestedProductId) continue; // not scorable
    scored += 1;
    const hit = l.aiSuggestedProductId === l.productId;
    if (hit) correct += 1;
    const at = l.checkout?.createdAt;
    if (at && at >= recentCutoff) {
      recentScored += 1;
      if (hit) recentCorrect += 1;
    } else if (at && at >= priorCutoff && at < recentCutoff) {
      priorScored += 1;
      if (hit) priorCorrect += 1;
    }
  }

  return {
    totalScans: lines.length,
    scored,
    correct,
    corrections: scored - correct,
    top1Accuracy: ratio(correct, scored),
    correctionRate: ratio(scored - correct, scored),
    recentAccuracy: ratio(recentCorrect, recentScored),
    priorAccuracy: ratio(priorCorrect, priorScored),
    recentScored,
  };
}

/** Recent corrections — where the AI's #1 differed from what was confirmed. */
export async function getRecentMisses(limit = RECENT_MISSES_CAP): Promise<ScanMiss[]> {
  const lines = await prisma.checkoutLine.findMany({
    where: {
      identifiedBy: "AI_PHOTO",
      aiSuggestedProductId: { not: null },
    },
    select: {
      id: true,
      productId: true,
      aiSuggestedProductId: true,
      aiConfidence: true,
      photoUrl: true,
      product: { select: { name: true } },
      checkout: {
        select: { createdAt: true, issuedBy: { select: { name: true } }, warehouse: { select: { name: true } } },
      },
    },
    orderBy: { checkout: { createdAt: "desc" } },
    // Over-fetch a little, then filter to true misses in JS (a relation field
    // can't be compared to another column in a Prisma where).
    take: Math.max(limit * 4, 80),
  });

  const misses: ScanMiss[] = [];
  const names = new Map<string, string>();
  // Resolve suggested-product names in one batch.
  const suggestedIds = Array.from(
    new Set(lines.filter((l) => l.aiSuggestedProductId !== l.productId).map((l) => l.aiSuggestedProductId!)),
  );
  if (suggestedIds.length > 0) {
    const sp = await prisma.product.findMany({ where: { id: { in: suggestedIds } }, select: { id: true, name: true } });
    for (const p of sp) names.set(p.id, p.name);
  }

  for (const l of lines) {
    if (l.aiSuggestedProductId === l.productId) continue; // a hit, not a miss
    misses.push({
      lineId: l.id,
      photoUrl: l.photoUrl,
      suggestedName: names.get(l.aiSuggestedProductId!) ?? "Unknown product",
      confirmedName: l.product?.name ?? "Unknown product",
      confidence: l.aiConfidence,
      at: l.checkout?.createdAt ?? new Date(0),
      by: l.checkout?.issuedBy?.name ?? null,
      branch: l.checkout?.warehouse?.name ?? null,
    });
    if (misses.length >= limit) break;
  }
  return misses;
}

/**
 * The "turn good scans into reference photos" queue: confirmed check-out scans
 * whose product still has room for reference photos. Products with ZERO photos
 * (which identify benefits from the most) come first; one best/most-recent scan
 * per product; capped. Dismissed/promoted scans (refPhotoReviewedAt set) are
 * excluded so they don't keep reappearing.
 */
export async function getPromotionQueue(limit = PROMOTION_QUEUE_CAP): Promise<PromotionCandidate[]> {
  // How many assigned reference photos each product already has.
  const counts = await prisma.productPhoto.groupBy({
    by: ["productId"],
    where: { status: "assigned", productId: { not: null } },
    _count: { _all: true },
  });
  const photoCount = new Map<string, number>();
  for (const c of counts) if (c.productId) photoCount.set(c.productId, c._count._all);

  // Candidate lines: a stored scan photo, a properly-cataloged product, not yet
  // reviewed. Newest first so "most recent per product" falls out naturally.
  const lines = await prisma.checkoutLine.findMany({
    where: {
      photoUrl: { not: null },
      refPhotoReviewedAt: null,
      product: { active: true, approved: true, confirmed: true },
    },
    select: {
      id: true,
      productId: true,
      photoUrl: true,
      aiConfidence: true,
      identifiedBy: true,
      product: { select: { name: true } },
      checkout: {
        select: { createdAt: true, issuedBy: { select: { name: true } }, warehouse: { select: { name: true } } },
      },
    },
    orderBy: { checkout: { createdAt: "desc" } },
    take: 400,
  });

  const bestPerProduct = new Map<string, PromotionCandidate>();
  for (const l of lines) {
    if (!l.photoUrl) continue;
    const existing = photoCount.get(l.productId) ?? 0;
    if (existing >= MAX_PHOTOS_PER_PRODUCT) continue; // already full
    if (bestPerProduct.has(l.productId)) continue; // keep the most-recent one
    bestPerProduct.set(l.productId, {
      lineId: l.id,
      productId: l.productId,
      productName: l.product?.name ?? "Unknown product",
      photoUrl: l.photoUrl,
      existingPhotos: existing,
      confidence: l.aiConfidence,
      identifiedBy: l.identifiedBy,
      at: l.checkout?.createdAt ?? new Date(0),
      by: l.checkout?.issuedBy?.name ?? null,
      branch: l.checkout?.warehouse?.name ?? null,
    });
  }

  return Array.from(bestPerProduct.values())
    // Zero-photo products first (identify gains the most), then newest.
    .sort((a, b) => a.existingPhotos - b.existingPhotos || b.at.getTime() - a.at.getTime())
    .slice(0, limit);
}

export type ScanIntel = {
  stats: ScanStats;
  misses: ScanMiss[];
  queue: PromotionCandidate[];
};

/** One call for the Scan Intelligence page. */
export async function getScanIntel(): Promise<ScanIntel> {
  const [stats, misses, queue] = await Promise.all([getScanStats(), getRecentMisses(), getPromotionQueue()]);
  return { stats, misses, queue };
}
