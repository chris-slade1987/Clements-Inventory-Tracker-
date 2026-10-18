import { prisma } from "@/lib/prisma";
import { computeReorderFindings } from "@/lib/reorder";
import { listVehicles, isDueSoon } from "@/lib/fleet";
import { branchLabel } from "@/lib/management";
import {
  postSystemThread,
  branchSupervisorRecipients,
  type SystemRecipient,
} from "@/lib/threads";
import { qty } from "@/lib/format";

// ---------------------------------------------------------------------------
// Theme 4 — "detect-then-offer-action" nudges on the Inbox spine.
//
// These UPGRADE existing deterministic "notices" from a passive alert/reminder
// into a one-click action routed through the in-app Inbox (primary channel),
// with email as the amplifier (postSystemThread fans both out). Each nudge is
//   detect → open an Inbox thread to the responsible person → deep-link the action
// and strictly HUMAN-IN-THE-LOOP: the nudge DRAFTS / DEEP-LINKS only, a person
// confirms the actual consequential write (never an autonomous stock/financial
// write). See docs/CANOPY-VISION.md §Theme 4 + §4 guardrails.
//
// IDEMPOTENCY / CLEARING. One open condition = one open thread. We reuse the
// established thread-dedup pattern from `remindSalesFocusFollowUps`: a `Setting`
// stamp per condition guards thread creation (so re-running the daily cron never
// re-posts the same open nudge). For recurring conditions that can recover and
// re-trip (low stock), the stamp is CLEARED when the condition no longer trips,
// so a later recurrence posts a fresh thread. For cycle-bound conditions
// (vehicle service/registration), the stamp key embeds the current due date (the
// `dkey` cycle-key pattern from `lib/reminders.ts`): servicing/renewing advances
// the date → a new key → a new thread next cycle, while the same cycle stays one
// thread. No schema change — all dedup rides on existing `Setting` rows.
// ---------------------------------------------------------------------------

/** A short date stamp (YYYY-MM-DD) for cycle-aware keys; "none" when no date. */
const dkey = (d: Date | null | undefined) => (d ? d.toISOString().slice(0, 10) : "none");

async function stampExists(key: string): Promise<boolean> {
  const s = await prisma.setting.findUnique({ where: { key } }).catch(() => null);
  return !!s;
}

async function setStamp(key: string, value: string): Promise<void> {
  await prisma.setting
    .upsert({ where: { key }, create: { key, value }, update: { value } })
    .catch(() => {});
}

/** Admin logins — the safety-net recipients so a nudge is never orphaned when a
 *  branch has no manager on file. */
async function adminRecipients(): Promise<SystemRecipient[]> {
  const admins = await prisma.user.findMany({
    where: { active: true, role: "admin" },
    select: { id: true, name: true, email: true, employeeId: true },
  });
  return admins.map((u) => ({ userId: u.id, employeeId: u.employeeId, name: u.name, email: u.email }));
}

/** Branch supervisor(s) for a branch, falling back to admins so the nudge lands. */
async function branchOwnersOrAdmins(branch: string | null): Promise<SystemRecipient[]> {
  const mgrs = await branchSupervisorRecipients(branch);
  if (mgrs.length > 0) return mgrs;
  return adminRecipients();
}

// ---------------------------------------------------------------------------
// Nudge 1 — Low stock → "Draft reorder".
//
// Detection: `computeReorderFindings()` (the reorder/low-stock engine, run-rate +
// purchasing cadence, from the stock-movement ledger — no schema change).
// Recipient: the branch manager of the warehouse's branch (fallback: admins).
// Action: deep-link to Check-In (`/check-in`) where the manager RECEIVES the
// reorder when it arrives — the body carries the prepared reorder draft (qty +
// warehouse). NO stock movement is created here; the manager confirms on Check-In.
// Dedup: one thread per product+warehouse condition (`nudge_low_stock:<p>:<w>`);
// the stamp is cleared when the item recovers so a re-trip posts a fresh thread.
// ---------------------------------------------------------------------------
export async function nudgeLowStockReorder(): Promise<{ findings: number; posted: number; cleared: number }> {
  const findings = await computeReorderFindings();
  const live = new Set<string>();
  let posted = 0;

  for (const f of findings) {
    const key = `nudge_low_stock:${f.productId}:${f.warehouseId}`;
    live.add(key);
    try {
      if (await stampExists(key)) continue; // already an open nudge for this condition
      const recipients = await branchOwnersOrAdmins(f.branch);
      const wh = f.warehouseName.replace(" (HQ)", "");
      const subject = f.outOfStock
        ? `Out of stock — ${f.productName} (${wh})`
        : `Reorder due — ${f.productName} (${wh})`;
      const draftQty = `${qty(Math.round(f.reorderQty))} ${f.unit}`;
      const body =
        `${f.message}\n\n` +
        `Draft reorder: order ~${draftQty} of ${f.productName} for ${wh}. ` +
        `When it arrives, receive it on Check-In so on-hand stays in sync — nothing is added to stock until you confirm the check-in.`;
      const id = await postSystemThread({
        subject,
        body,
        recipients,
        contextType: "alert",
        contextLabel: `${f.productName} — ${wh}`,
        contextHref: "/check-in",
        branch: f.branch,
        authorName: "Buzz",
      });
      if (id) {
        await setStamp(key, id);
        posted++;
      }
    } catch (err) {
      console.error(`[nudgeLowStockReorder] ${key} failed:`, err);
    }
  }

  // Recovered items: clear any low-stock nudge stamp whose condition no longer
  // trips, so if the product falls low again later it posts a fresh thread.
  let cleared = 0;
  const stamps = await prisma.setting
    .findMany({ where: { key: { startsWith: "nudge_low_stock:" } }, select: { key: true } })
    .catch(() => [] as { key: string }[]);
  const stale = stamps.filter((s) => !live.has(s.key)).map((s) => s.key);
  if (stale.length > 0) {
    const r = await prisma.setting.deleteMany({ where: { key: { in: stale } } }).catch(() => null);
    cleared = r?.count ?? 0;
  }

  return { findings: findings.length, posted, cleared };
}

// ---------------------------------------------------------------------------
// Nudge 3 — Vehicle service / registration expiring → "Open the record".
//
// Detection: the fleet engine — `isDueSoon` (next-service date within 30d or
// mileage within 1,000) and registration renewal within 60 days / expired.
// Recipient: the vehicle's branch manager (fallback: admins).
// Action: deep-link to the exact vehicle record (`/fleet/<id>`) to log the
// service / file the renewal. Dedup: a cycle-aware stamp keyed on the due date
// (`nudge_vehicle_service:<id>:<nextDue>` / `nudge_vehicle_registration:<id>:<date>`)
// — servicing/renewing advances the date → a new key → one thread per cycle.
// ---------------------------------------------------------------------------
const REGISTRATION_WINDOW_DAYS = 60;
const DAY = 864e5;

export async function nudgeVehicleServiceDue(): Promise<{ posted: number }> {
  const now = Date.now();
  let posted = 0;

  // Maintenance / service due soon.
  const vehicles = await listVehicles();
  for (const v of vehicles) {
    if (v.status !== "active") continue;
    if (!isDueSoon(v)) continue;
    const cycle = v.nextDueDate ? dkey(v.nextDueDate) : v.nextDueMileage != null ? `m${v.nextDueMileage}` : "due";
    const key = `nudge_vehicle_service:${v.id}:${cycle}`;
    try {
      if (await stampExists(key)) continue;
      const recipients = await branchOwnersOrAdmins(v.branch);
      const label = `${v.unitNumber ? `#${v.unitNumber} · ` : ""}${v.name}`;
      const due = v.nextDueDate
        ? `due ${v.nextDueDate.toLocaleDateString()}`
        : v.nextDueMileage != null
          ? `due at ${v.nextDueMileage.toLocaleString()} mi (currently ${v.currentMileage?.toLocaleString() ?? "?"} mi)`
          : "due soon";
      const subject = `Service due — ${label}`;
      const body =
        `${label}${v.branch ? ` (${branchLabel(v.branch)})` : ""} is ${due}. ` +
        `Open the vehicle record to schedule the service and log it once done.`;
      const id = await postSystemThread({
        subject,
        body,
        recipients,
        contextType: "vehicle",
        contextLabel: label,
        contextHref: `/fleet/${v.id}`,
        branch: v.branch,
        authorName: "Buzz",
      });
      if (id) {
        await setStamp(key, id);
        posted++;
      }
    } catch (err) {
      console.error(`[nudgeVehicleServiceDue] service ${key} failed:`, err);
    }
  }

  // Registration expiring (or expired) — raw rows carry the renewal date.
  const raw = await prisma.vehicle.findMany({
    where: { status: "active" },
    select: { id: true, unitNumber: true, name: true, branch: true, registrationRenewal: true },
  });
  for (const v of raw) {
    if (!v.registrationRenewal) continue;
    const days = Math.round((v.registrationRenewal.getTime() - now) / DAY);
    if (days > REGISTRATION_WINDOW_DAYS) continue;
    const key = `nudge_vehicle_registration:${v.id}:${dkey(v.registrationRenewal)}`;
    try {
      if (await stampExists(key)) continue;
      const recipients = await branchOwnersOrAdmins(v.branch);
      const label = `${v.unitNumber ? `#${v.unitNumber} · ` : ""}${v.name}`;
      const subject = days <= 0 ? `Registration expired — ${label}` : `Registration expiring — ${label}`;
      const when = days <= 0 ? "has expired" : `renews in ${days} day${days === 1 ? "" : "s"}`;
      const body =
        `${label}${v.branch ? ` (${branchLabel(v.branch)})` : ""} registration ${when} ` +
        `(${v.registrationRenewal.toLocaleDateString()}). Open the vehicle record to file the renewal.`;
      const id = await postSystemThread({
        subject,
        body,
        recipients,
        contextType: "vehicle",
        contextLabel: label,
        contextHref: `/fleet/${v.id}`,
        branch: v.branch,
        authorName: "Buzz",
      });
      if (id) {
        await setStamp(key, id);
        posted++;
      }
    } catch (err) {
      console.error(`[nudgeVehicleServiceDue] registration ${key} failed:`, err);
    }
  }

  return { posted };
}

// ---------------------------------------------------------------------------
// Nudge 4 — Groundwork To-Do / Huddle follow-up due-soon + overdue → "Open My Work".
//
// Detection: open WorkItems (not done/cancelled, not Greenhouse/someday) with a
// due date that is DUE SOON (within 2 days) or OVERDUE. Recipient: the assignee's
// login for a person-assigned item; the branch supervisors (fallback admins) for
// a branch-assigned one. Action: deep-link to My Work / the source Huddle. NO
// write — the person acts in-portal.
//
// Dedup / no-double-notify: the one-time ASSIGNMENT notice fires at assignment
// (see lib/groundwork.notifyAssignment); THIS nudge is the deadline reminder, a
// separate purpose. Idempotent per item + due-date cycle + phase:
// `nudge_todo_due:<id>:<dueDate>:<soon|overdue>` — so re-running the cron never
// re-posts, moving the due date posts a fresh soon/overdue nudge, and soon then
// overdue each fire once per cycle. All best-effort/try-catch.
// ---------------------------------------------------------------------------
const TODO_SOON_DAYS = 2;

export async function nudgeWorkItemsDue(): Promise<{ candidates: number; posted: number }> {
  const now = Date.now();
  const soonEnd = new Date(now + (TODO_SOON_DAYS + 1) * DAY); // through end of the +2d window

  const items = await prisma.workItem.findMany({
    where: {
      status: { notIn: ["done", "cancelled"] },
      horizon: { not: "someday" },
      dueDate: { not: null, lt: soonEnd },
    },
    select: {
      id: true, title: true, dueDate: true, assigneeType: true, assigneeId: true, branch: true,
      meetingId: true, creatorId: true,
    },
  });

  let posted = 0;
  for (const it of items) {
    const due = it.dueDate!;
    const days = Math.round((due.getTime() - now) / DAY);
    const phase = due.getTime() < now ? "overdue" : "soon";
    const key = `nudge_todo_due:${it.id}:${dkey(due)}:${phase}`;
    try {
      if (await stampExists(key)) continue;

      // Resolve the recipient(s).
      let recipients: SystemRecipient[] = [];
      if (it.assigneeType === "person" && it.assigneeId) {
        const u = await prisma.user.findUnique({
          where: { id: it.assigneeId },
          select: { id: true, name: true, email: true, employeeId: true, active: true },
        });
        if (u?.active) recipients = [{ userId: u.id, employeeId: u.employeeId, name: u.name, email: u.email }];
      } else if (it.assigneeType === "branch" && it.branch) {
        recipients = await branchOwnersOrAdmins(it.branch);
      }
      if (recipients.length === 0) continue;

      const kindWord = it.meetingId ? "follow-up" : "To-Do";
      const when = phase === "overdue"
        ? `is overdue (was due ${due.toLocaleDateString()})`
        : days <= 0
          ? `is due today (${due.toLocaleDateString()})`
          : `is due in ${days} day${days === 1 ? "" : "s"} (${due.toLocaleDateString()})`;
      const subject = phase === "overdue" ? `Overdue ${kindWord}: ${it.title}` : `${kindWord} due soon: ${it.title}`;
      const body =
        `Your Groundwork ${kindWord} "${it.title}"${it.branch ? ` (${branchLabel(it.branch)})` : ""} ${when}. ` +
        `Open My Work to update or close it out.`;
      const id = await postSystemThread({
        subject,
        body,
        recipients,
        contextType: "reminder",
        contextLabel: it.title,
        contextHref: it.meetingId ? `/huddles/${it.meetingId}` : "/groundwork",
        branch: it.branch,
        authorName: "Buzz",
      });
      if (id) { await setStamp(key, id); posted++; }
    } catch (err) {
      console.error(`[nudgeWorkItemsDue] ${key} failed:`, err);
    }
  }
  return { candidates: items.length, posted };
}

/** Run every detect-then-offer-action nudge that isn't already wired into another
 *  job. (The goal-sheet nudge lives in `remindAdvisorGoalSheets`, which already
 *  owns the business-day detection.) Best-effort: one failing nudge can't abort
 *  the others. */
export async function runNudges() {
  const [lowStock, vehicles, workItems] = await Promise.allSettled([
    nudgeLowStockReorder(),
    nudgeVehicleServiceDue(),
    nudgeWorkItemsDue(),
  ]);
  return {
    lowStock: lowStock.status === "fulfilled" ? lowStock.value : { error: "failed — see logs" },
    vehicles: vehicles.status === "fulfilled" ? vehicles.value : { error: "failed — see logs" },
    workItems: workItems.status === "fulfilled" ? workItems.value : { error: "failed — see logs" },
  };
}
