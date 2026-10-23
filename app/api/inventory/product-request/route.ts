import { NextResponse } from "next/server";
import { fail } from "@/lib/http";
import { prisma } from "@/lib/prisma";
import { getSessionUser, isSuperAdmin, isBoardObserver } from "@/lib/auth";
import { saveUpload } from "@/lib/storage";
import { postSystemThread, type SystemRecipient } from "@/lib/threads";
import { superAdminRecipients } from "@/lib/product-requests";
import { resolveWarehouseId } from "@/lib/inventory-scope";
import { autofillProduct, classifyPhoto } from "@/lib/inventory-identify";
import { uomCode } from "@/lib/uom";
import { normalizeClassification } from "@/lib/constants";
import { appUrl } from "@/lib/app-url";
import { branchLabel } from "@/lib/management";

export const runtime = "nodejs";
export const maxDuration = 30;

const s = (v: unknown) => { const t = typeof v === "string" ? v.trim() : ""; return t === "" ? null : t; };
const REQUESTS_HREF = "/manage/product-requests";
const MAX_REQUEST_PHOTOS = 3;

function rawBase64(v: unknown): string {
  let data = String(v ?? "").trim();
  if (!data) return "";
  const comma = data.indexOf(",");
  if (data.startsWith("data:") && comma !== -1) data = data.slice(comma + 1);
  return data;
}

function intOrNull(v: unknown): number | null {
  if (v === "" || v == null) return null;
  const n = Math.trunc(Number(v));
  return Number.isFinite(n) && n >= 0 ? n : null;
}

/** Pull up to 3 base64 images out of the request body (array `images`, or legacy
 *  single `image`). */
function imagesFrom(body: Record<string, unknown> | null): string[] {
  const out: string[] = [];
  const arr = Array.isArray(body?.images) ? body?.images : [];
  for (const it of arr) { const b = rawBase64(it); if (b) out.push(b); }
  const single = rawBase64(body?.image);
  if (single && out.length === 0) out.push(single);
  return out.slice(0, MAX_REQUEST_PHOTOS);
}

export async function POST(req: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (isBoardObserver(user)) return NextResponse.json({ error: "Read-only access." }, { status: 403 });

  const body = await req.json().catch(() => null);
  const action = s(body?.action) ?? "create";

  try {
    // ── AI autofill (managers): read photos, suggest the catalog fields ────────
    // Stateless — nothing is saved; the client shows the suggestions in an editable
    // form and only `create` persists. Degrades to empty suggestions without AI.
    if (action === "autofill") {
      if (user.role !== "admin" && user.role !== "manager") {
        return NextResponse.json({ error: "Only managers or admins can request a product." }, { status: 403 });
      }
      const images = imagesFrom(body);
      if (images.length === 0) return NextResponse.json({ error: "Add at least one photo." }, { status: 400 });
      const fill = await autofillProduct(images.map((b) => ({ base64: b, mime: "image/jpeg" })));
      // Classify each photo so the client can pre-tag them (product/label/barcode).
      const kinds = await Promise.all(images.map((b) => classifyPhoto(b, "image/jpeg").then((c) => c.kind).catch(() => "other")));
      return NextResponse.json({ ok: true, ai: fill.ai, suggestion: fill, kinds });
    }

    // ── Create a request (any manager/admin who can reach Check-Out) ──────────
    if (action === "create") {
      if (user.role !== "admin" && user.role !== "manager") {
        return NextResponse.json({ error: "Only managers or admins can request a product." }, { status: 403 });
      }
      const proposedName = s(body?.proposedName);
      if (!proposedName) return NextResponse.json({ error: "Give the product a name." }, { status: 400 });

      // Resolve the requester's branch warehouse so the on-hand count can be posted
      // there on approval (branch-locked managers → their own warehouse).
      const warehouseId = await resolveWarehouseId(user, s(body?.warehouseId));
      const branch = user.branch ?? null;
      const onHandQty = intOrNull(body?.onHandQty);

      // Save each submitted photo, AI-classify its kind, and tie it to the request
      // as an unassigned ProductPhoto (best-effort — a failed upload never blocks).
      const images = imagesFrom(body);
      const saved: { photoUrl: string; kind: string }[] = [];
      for (const b of images) {
        const url = await saveUpload(Buffer.from(b, "base64"), "product-request.jpg", "image/jpeg", "product-photos").catch(() => null);
        if (!url) continue;
        const kind = await classifyPhoto(b, "image/jpeg").then((c) => c.kind).catch(() => "other");
        saved.push({ photoUrl: url, kind });
      }

      const request = await prisma.productRequest.create({
        data: {
          status: "pending",
          productId: s(body?.productId),
          proposedName,
          description: s(body?.description),
          manufacturer: s(body?.manufacturer),
          distributorSku: s(body?.distributorSku),
          unitOfMeasure: uomCode(s(body?.unitOfMeasure)) ?? null,
          division: s(body?.division),
          onHandQty,
          reason: s(body?.reason),
          photoUrl: saved[0]?.photoUrl ?? null, // legacy thumbnail field
          warehouseId,
          branch,
          requestedByUserId: user.id,
          requestedByName: user.name,
          photos: saved.length
            ? { create: saved.map((p) => ({
                photoUrl: p.photoUrl, kind: p.kind, status: "unassigned",
                capturedByUserId: user.id, capturedByName: user.name, warehouseId, branch,
              })) }
            : undefined,
        },
      });

      // Notify every super admin — Inbox thread (the dashboard alert) + email.
      const recipients = await superAdminRecipients(user.id);
      const where = branch ? ` at ${branchLabel(branch)}` : "";
      await postSystemThread({
        subject: `Product approval request: ${proposedName}`,
        body:
          `${user.name} is requesting that "${proposedName}" be added to the approved catalog${where} so it can be checked out.` +
          `${onHandQty != null ? `\n\nOn hand now: ${onHandQty}` : ""}` +
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
        // Catalog the product from the REVIEWED fields (the reviewer may correct
        // the AI-filled name/unit/division/etc. in the approval form).
        const name = s(body?.name) ?? request.proposedName;
        const manufacturer = s(body?.manufacturer) ?? request.manufacturer;
        const distributorSku = s(body?.distributorSku) ?? request.distributorSku;
        const description = s(body?.description) ?? request.description;
        const unitOfMeasure = uomCode(s(body?.unitOfMeasure) ?? request.unitOfMeasure) ?? "EA";
        const { division } = normalizeClassification(s(body?.division) ?? request.division, null);
        const onHandQty = intOrNull(body?.onHandQty ?? request.onHandQty);
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
                unitOfMeasure, division: division ?? existing.division,
                usedFor: description ?? existing.usedFor,
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
              unitOfMeasure,
              division,
              usedFor: description,
              approved: true, confirmed: true, active: true,
              notes: `Created via product approval request by ${user.name} on ${now.toISOString().slice(0, 10)}.`,
            },
          });
          productId = created.id;
        }

        // Attach the request's photos to the new product (assigned, keeping their
        // AI kinds). The first becomes primary if the product has none yet.
        const reqPhotos = await prisma.productPhoto.findMany({ where: { productRequestId: id, status: "unassigned" }, orderBy: { createdAt: "asc" } });
        if (reqPhotos.length) {
          const hasPrimary = (await prisma.productPhoto.count({ where: { productId, status: "assigned", primary: true } })) > 0;
          await prisma.$transaction(
            reqPhotos.map((p, i) => prisma.productPhoto.update({
              where: { id: p.id },
              data: {
                productId, status: "assigned", primary: !hasPrimary && i === 0,
                assignedByUserId: user.id, assignedByName: user.name, assignedAt: now,
              },
            })),
          );
        }

        // Post the on-hand count as an adjustment movement at the request's branch
        // warehouse (NEVER write on-hand directly — follow the core data rule).
        let onHandPosted = false;
        if (onHandQty && onHandQty > 0 && request.warehouseId) {
          const wh = await prisma.warehouse.findUnique({ where: { id: request.warehouseId }, select: { id: true } });
          if (wh) {
            await prisma.stockMovement.create({
              data: {
                type: "adjustment",
                productId,
                warehouseId: wh.id,
                quantity: onHandQty,
                unit: unitOfMeasure,
                reason: "Initial count — new product approved from request",
                userId: user.id,
              },
            });
            onHandPosted = true;
          }
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
            `go back to Check-Out and dispense it.` +
            `${onHandPosted ? `\n\nYour on-hand count of ${onHandQty} was posted at ${request.branch ? branchLabel(request.branch) : "your branch"}.` : ""}` +
            `${note ? `\n\nNote: ${note}` : ""}`,
          branch: request.branch,
        });
        return NextResponse.json({ ok: true, productId, onHandPosted });
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
