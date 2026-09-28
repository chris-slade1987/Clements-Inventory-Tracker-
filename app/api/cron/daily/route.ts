import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { remindTraining, remindSignatures, remindReviewSignatures, remindVehicleDocs, remindManual, scheduleNewHireReviews, remindScorecardsDue } from "@/lib/jobs";

export const runtime = "nodejs";
export const maxDuration = 60;

// Daily job runner. Vercel Cron hits this with GET and (when CRON_SECRET is set)
// an `Authorization: Bearer <CRON_SECRET>` header. Also runnable by an admin.
//
// The seven jobs run with Promise.allSettled so (a) they overlap instead of
// running strictly one-after-another (staying inside the function budget as data
// grows) and (b) one failing job can no longer abort the run and starve the jobs
// that would have run after it — each job's outcome is reported independently.
async function run(req: Request) {
  const secret = process.env.CRON_SECRET;
  const authed = secret && req.headers.get("authorization") === `Bearer ${secret}`;
  if (!authed) {
    const user = await getSessionUser();
    if (!user || user.role !== "admin") return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const jobs = {
    reviews: scheduleNewHireReviews,
    reviewSignatures: remindReviewSignatures,
    vehicleDocs: remindVehicleDocs,
    manual: remindManual,
    training: remindTraining,
    signatures: remindSignatures,
    scorecardsDue: remindScorecardsDue,
  } as const;
  const names = Object.keys(jobs) as (keyof typeof jobs)[];
  const settled = await Promise.allSettled(names.map((n) => jobs[n]()));
  const result: Record<string, unknown> = {};
  settled.forEach((s, i) => {
    if (s.status === "fulfilled") {
      result[names[i]] = s.value;
    } else {
      console.error(`[cron/daily] ${names[i]} failed:`, s.reason);
      result[names[i]] = { error: "job failed — see server logs" };
    }
  });
  return NextResponse.json({ ok: true, ranAt: new Date().toISOString(), ...result });
}

export async function GET(req: Request) {
  return run(req);
}
export async function POST(req: Request) {
  return run(req);
}
