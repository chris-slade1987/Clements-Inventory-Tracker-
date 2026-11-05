import "server-only";
import { prisma } from "@/lib/prisma";
import { postSystemThread } from "@/lib/threads";
import { superAdminRecipients } from "@/lib/product-requests";
import { appUrl } from "@/lib/app-url";

// Over-dispense (would-go-negative) notification. Raised when a manager tries to
// check out MORE of a product than is on hand at a branch — the checkout is hard-
// blocked (on-hand never actually goes negative), but the attempt is a signal that
// the ledger is out of step with reality. It prompts the inventory approvers
// (Julie + the other super admins) to reconcile what's been logged coming IN
// (invoices/check-ins) versus going OUT (check-outs).
//
// Two surfaces, both deduped per product+warehouse so repeated attempts don't spam:
//   • a dashboard Alert (type "negative_stock_attempt") — shows in the Inventory
//     dashboard "Open alerts" panel and on /alerts until cleared;
//   • an Inbox + email thread to the approvers (only when the alert is newly raised
//     or recurs after being cleared — an open alert just refreshes its wording).

export type OverDispenseOffender = {
  productId: string;
  name: string;
  onHand: number;
  requested: number;
  after: number;
};

export async function notifyOverDispenseAttempt(opts: {
  warehouseId: string;
  warehouseName: string;
  attemptedByName: string;
  offenders: OverDispenseOffender[];
}): Promise<void> {
  const { warehouseId, warehouseName, attemptedByName, offenders } = opts;
  if (offenders.length === 0) return;

  const freshlyRaised: OverDispenseOffender[] = [];
  for (const o of offenders) {
    const dedupeKey = `negative_stock_attempt:${o.productId}:${warehouseId}`;
    const message =
      `Over-dispense attempt: ${attemptedByName} tried to check out ${o.requested} of "${o.name}" at ${warehouseName}, ` +
      `but only ${o.onHand} is on hand. Reconcile check-ins vs check-outs.`;
    const existing = await prisma.alert.findUnique({ where: { dedupeKey } }).catch(() => null);
    if (!existing) {
      await prisma.alert.create({
        data: { dedupeKey, type: "negative_stock_attempt", productId: o.productId, message, severity: "warning", status: "open" },
      }).catch(() => {});
      freshlyRaised.push(o);
    } else if (existing.status === "dismissed") {
      // Recurred after being cleared — re-open and notify again.
      await prisma.alert.update({ where: { dedupeKey }, data: { status: "open", message, severity: "warning" } }).catch(() => {});
      freshlyRaised.push(o);
    } else {
      // Still open — just refresh the wording, no new Inbox thread.
      await prisma.alert.update({ where: { dedupeKey }, data: { message } }).catch(() => {});
    }
  }

  if (freshlyRaised.length === 0) return;

  const recipients = await superAdminRecipients().catch(() => []);
  if (recipients.length === 0) return;

  const lines = freshlyRaised
    .map((o) => `• ${o.name}: tried ${o.requested}, only ${o.onHand} on hand`)
    .join("\n");
  await postSystemThread({
    subject: `Over-dispense attempt at ${warehouseName}`,
    body:
      `${attemptedByName} tried to check out more than is on hand at ${warehouseName}:\n\n${lines}\n\n` +
      `The check-out was blocked. Please reconcile what's been logged coming in (invoices / check-ins) ` +
      `versus going out (check-outs) for ${freshlyRaised.length === 1 ? "this product" : "these products"}.\n\n` +
      `Review inventory: ${appUrl()}/dashboard`,
    recipients,
    contextType: "alert",
    contextLabel: "Over-dispense attempt",
    contextHref: "/dashboard",
  }).catch(() => {});
}
