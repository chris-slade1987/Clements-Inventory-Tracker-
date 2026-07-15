import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { remindTraining, remindSignatures, remindReviewSignatures, scheduleNewHireReviews } from "@/lib/jobs";

export const runtime = "nodejs";
export const maxDuration = 120;

// Daily job runner. Vercel Cron hits this with GET and (when CRON_SECRET is set)
// an `Authorization: Bearer <CRON_SECRET>` header. Also runnable by an admin.
async function run(req: Request) {
  const secret = process.env.CRON_SECRET;
  const authed = secret && req.headers.get("authorization") === `Bearer ${secret}`;
  if (!authed) {
    const user = await getSessionUser();
    if (!user || user.role !== "admin") return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const reviews = await scheduleNewHireReviews();
  const reviewSignatures = await remindReviewSignatures();
  const training = await remindTraining();
  const signatures = await remindSignatures();
  return NextResponse.json({ ok: true, ranAt: new Date().toISOString(), reviews, reviewSignatures, training, signatures });
}

export async function GET(req: Request) {
  return run(req);
}
export async function POST(req: Request) {
  return run(req);
}
