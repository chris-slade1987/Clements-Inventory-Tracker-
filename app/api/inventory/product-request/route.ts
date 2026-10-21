import { NextResponse } from "next/server";
import { fail } from "@/lib/http";
import { prisma } from "@/lib/prisma";
import { getSessionUser, isSuperAdmin, isBoardObserver } from "@/lib/auth";
import { saveUpload } from "@/lib/storage";
import { postSystemThread, type SystemRecipient } from "@/lib/threads";
import { superAdminRecipients } from "@/lib/product-requests";
import { appUrl } from "@/lib/app-url";
import { branchLabel } from "@/lib/management";

export const runtime = "nodejs";
export const maxDuration = 20;

const s = (v: unknown) => { const t = typeof v === "string" ? v.trim() : ""; return t === "" ? null : t; };
const REQUESTS_HREF = "/manage/product-requests";

export async function POST(req: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (isBoardObserver(user)) return NextResponse.json({ error: "Read-only access." }, { status: 403 });

  const body = await req.json().catch(() => null);
  const action = s(body?.action) ?? "create";

  try {
    // ── Create a request (any manager/admin who can reach Check-Out) ──────────
    if (action === "create") {
      if (user.role !== "admin" && user.role !== "manager") {
        return NextResponse.json({ error: "Only managers or admins can request a product." }, { status: 403 });
      }
      const proposedName = s(body?.proposedName);
      if (!proposedName) return NextResponse.json({ error: "Give the product a name." }, { status: 400 });

      // Optional photo of the sample (base64) — best-effort, never blocks.
      let photoUrl: string | null = null;
      const img = s(body?.image);
      if (img) {
        let data = img;
        const comma = data.indexOf(",");
        if (data.startsWith("data:") && comma !== -1) data = data.slice(comma + 1);
        photoUrl = await saveUpload(Buffer.from(data, "base64"), "product-request.jpg", "image/jpeg", "product-requests").catch(() => null);
      }

      const branch = user.branch ?? null;
      const request = await prisma.productRequest.create({
        data: {
          status: "pending",
          productId: s(body?.productId),
          proposedName,
          description: s(body?.description),
          manufacturer: s(body?.manufacturer),
          distributorSku: s(body?.distributorSku),
          reason: s(body?.reason),
          photoUrl,
          warehouseId: s(body?.warehouseId),
          branch,
          requestedByUserId: user.id,
          requestedByName: user.name,
        },
      });

      // Notify every super admin — Inbox thread (the dashboard alert) + email.
      const recipients = await superAdminRecipients(user.id);
      const where = branch ? ` at ${branchLabel(branch)}` : "";
      await postSystemThread({
        subject: `Product approval request: ${proposedName}`,
        body:
          `${user.name} is requesting that "${proposedName}" be added to the approved catalog${where} so it can be checked out.` +
          `${request.reason ? `\n\nReason: ${request.reason}` : ""}` +
          `\n\nApprove or deny it in Inventory Administration → Requests: ${appUrl()}${REQUESTS_HREF}`,
        recipients,
        contextType: "alert",
        contextLabel: "Product approval request",
        contextHref: REQUESTS_HREF,
        branch,
      }).catch(() => {});

      return NextResponse.json({ ok: true, id: request.id });
    }

    // ── Decide a request (super admins only) ─────────────────────────────────
    if (action === "approve" || action === "deny") {
      if (!isSuperAdmin(user)) {
        return NextResponse.json({ error: "Only a super admin can approve product requests." }, { status: 403 });
      }
      const id = s(body?.id);
      if (!id) return NextResponse.json({ error: "Missing request." }, { status: 400 });
      const request = await prisma.productRequest.findUnique({ where: { id } });
      if (!request) return NextResponse.json({ error: "Request not found." }, { status: 404 });
      if (request.status !== "pending") return NextResponse.json({ error: "This request was already decided." }, { status: 409 });

      const note = s(body?.note);
      const now = new Date();

      if (action === "approve") {
        // Catalog the product: flip an existing row cataloged, or create a fresh
        // approved + confirmed product so it's immediately checkout-eligible.
        const name = s(body?.name) ?? request.proposedName;
        const manufacturer = s(body?.manufacturer) ?? request.manufacturer;
        const distributorSku = s(body?.distributorSku) ?? request.distributorSku;
        let productId = request.productId;

        if (productId) {
          const existing = await prisma.product.findUnique({ where: { id: productId } });
          if (existing) {
            await prisma.product.update({
              where: { id: productId },
              data: {
                approved: true, confirmed: true, active: true,
                name, manufacturer: manufacturer ?? existing.manufacturer,
                distributorSku: distributorSku ?? existing.distributorSku,
                notes: [existing.notes, `Cataloged via approval request by ${user.name} on ${now.toISOString().slice(0, 10)}.`].filter(Boolean).join(" "),
              },
            });
          } else {
            productId = null; // referenced product vanished — create a new one below
          }
        }
        if (!productId) {
          const created = await prisma.product.create({
            data: {
              name,
              manufacturer,
              distributorSku,
              unitOfMeasure: "EA", // default — refine in the catalog
              approved: true, confirmed: true, active: true,
              notes: `Created via product approval request by ${user.name} on ${now.toISOString().slice(0, 10)}. Set the unit of measure / classification in the catalog.`,
            },
          });
          productId = created.id;
        }

        await prisma.productRequest.update({
          where: { id },
          data: { status: "approved", productId, decidedByUserId: user.id, decidedByName: user.name, decidedAt: now, decisionNote: note },
        });

        // Notify the requester — it's ready to dispense.
        await notifyRequester(request.requestedByUserId, request.requestedByName, {
          subject: `Approved: ${name}`,
          body:
            `Your request to catalog "${name}" was approved by ${user.name}. It's now on the approved catalog — ` +
            `go back to Check-Out and dispense it.${note ? `\n\nNote: ${note}` : ""}`,
          branch: request.branch,
        });
        return NextResponse.json({ ok: true, productId });
      }

      // Deny.
      await prisma.productRequest.update({
        where: { id },
        data: { status: "denied", decidedByUserId: user.id, decidedByName: user.name, decidedAt: now, decisionNote: note },
      });
      await notifyRequester(request.requestedByUserId, request.requestedByName, {
        subject: `Not approved: ${request.proposedName}`,
        body:
          `Your request to catalog "${request.proposedName}" was not approved by ${user.name}.` +
          `${note ? `\n\nReason: ${note}` : ""}\n\nReach out to a super admin if you have questions.`,
        branch: request.branch,
      });
      return NextResponse.json({ ok: true });
    }

    return NextResponse.json({ error: "Unknown action." }, { status: 400 });
  } catch (e) {
    return fail(e);
  }
}

/** Notify the original requester (Inbox + email) of the decision. */
async function notifyRequester(
  userId: string,
  name: string,
  opts: { subject: string; body: string; branch: string | null },
): Promise<void> {
  const u = await prisma.user.findUnique({ where: { id: userId }, select: { id: true, name: true, email: true, employeeId: true } });
  const recipient: SystemRecipient = u
    ? { userId: u.id, employeeId: u.employeeId, name: u.name, email: u.email }
    : { userId, name, email: null };
  await postSystemThread({
    subject: opts.subject,
    body: opts.body,
    recipients: [recipient],
    contextType: "alert",
    contextLabel: "Product approval request",
    contextHref: "/check-out",
    branch: opts.branch,
  }).catch(() => {});
}
