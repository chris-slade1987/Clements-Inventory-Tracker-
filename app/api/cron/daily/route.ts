import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { runDailyDigest, remindScorecardsDue, runCelebrations, remindMonthlyGoals, remindAdvisorGoalSheets, remindSalesFocusFollowUps } from "@/lib/jobs";
import { runNudges } from "@/lib/nudges";
import { reindexKnowledge } from "@/lib/copilot/ingest";

export const runtime = "nodejs";
export const maxDuration = 60;

// Daily job runner. Vercel Cron hits this with GET and (when CRON_SECRET is set)
// an `Authorization: Bearer <CRON_SECRET>` header. Also runnable by an admin.
//
// The jobs run with Promise.allSettled so (a) they overlap instead of
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
  // Reminder email is now a single per-recipient DIGEST: `runDailyDigest` creates
  // new-hire reviews and folds every reminder source (training, review/signature
  // signing, vehicle docs, manual reminders) into one email per recipient.
  // Scorecard-due (weekly, targeted) and celebrations stay independent.
  const jobs = {
    digest: runDailyDigest,
    scorecardsDue: remindScorecardsDue,
    monthlyGoals: remindMonthlyGoals,
    advisorGoalSheets: remindAdvisorGoalSheets,
    salesFocusFollowUps: remindSalesFocusFollowUps,
    // Theme 4 detect-then-offer-action nudges routed through the Inbox:
    // low-stock → draft reorder, and vehicle service/registration → open the record.
    nudges: runNudges,
    celebrations: runCelebrations,
    // Canopy Copilot (Theme 5, Wave A): nightly reindex of the knowledge base so
    // any manual/handbook/SOP/checklist change is picked up without a deploy.
    // Best-effort — allSettled below means a failure here can't abort the batch.
    copilotReindex: reindexKnowledge,
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
