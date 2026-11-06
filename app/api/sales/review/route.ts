import { NextResponse } from "next/server";
import { getSessionUser, isSuperAdmin } from "@/lib/auth";
import { fail } from "@/lib/http";
import { releaseSalesReview, reopenSalesReview, type ReleaseDraft } from "@/lib/sales-review-store";

export const runtime = "nodejs";
export const maxDuration = 20;

// Quarterly Sales Director Review — reviewer actions. SUPER ADMINS ONLY (Chris,
// Julie, April): release (persist the snapshot + email the Director a sign link)
// and reopen (back to draft to revise; re-release re-sends a fresh link).
export async function POST(req: Request) {
  const user = await getSessionUser();
  if (!user || !isSuperAdmin(user)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = await req.json().catch(() => null);
  const action = body?.action;
  const year = Number(body?.year);
  const quarter = Number(body?.quarter);
  if (!Number.isInteger(year) || ![1, 2, 3, 4].includes(quarter))
    return NextResponse.json({ error: "Missing year/quarter." }, { status: 400 });

  try {
    if (action === "release") {
      const draft = (body?.draft ?? {}) as ReleaseDraft;
      const reviewerName = String(draft.reviewerName ?? "").trim();
      if (!reviewerName) return NextResponse.json({ error: "Type your name in the Reviewer / COO signature to release." }, { status: 400 });
      if (!draft.rating) return NextResponse.json({ error: "Choose an overall rating before releasing." }, { status: 400 });
      let origin = "";
      try { origin = new URL(req.url).origin; } catch { /* ignore */ }
      const r = await releaseSalesReview({ year, quarter, draft, reviewerName, baseUrl: origin || undefined });
      return NextResponse.json(r);
    }
    if (action === "reopen") {
      const r = await reopenSalesReview(year, quarter);
      if (!r.ok) return NextResponse.json({ error: r.error }, { status: 404 });
      return NextResponse.json(r);
    }
    return NextResponse.json({ error: "Unknown action." }, { status: 400 });
  } catch (e) {
    return fail(e);
  }
}
