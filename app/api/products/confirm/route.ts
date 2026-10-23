import { fail } from "@/lib/http";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUser, isSuperAdmin } from "@/lib/auth";
import { isUomCode, uomCode } from "@/lib/uom";
import { normalizeClassification } from "@/lib/constants";

export const maxDuration = 20;

// The new-product formal-approval (confirm) queue actions. Confirming a product
// marks it human-reviewed (confirmed=true) and saves any edits; merging repoints
// a naming variant into a canonical product and deactivates the variant (never a
// hard-delete). SUPER-ADMIN-ONLY (Chris, Julie, April) — catalog edits are locked
// to super admins; see lib/access-catalog.ts.
async function guard() {
  const user = await getSessionUser();
  if (!user || !isSuperAdmin(user)) return null;
  return user;
}

function clean(v: unknown): string | null {
  const s = typeof v === "string" ? v.trim() : "";
  return s === "" ? null : s;
}

// The seed marks auto-added products unconfirmed while their "Added from transfer
// history" note is intact; dropping that phrase on confirm stops the reconcile
// from re-asserting confirmed=false on the next deploy.
const ADD_NOTE_MARK = "Added from transfer history";
// Must match DISCARD_MARK in prisma/seed-products-approved.ts so the deploy
// reconcile keeps a discarded product inactive/off-catalog.
const DISCARD_MARK = "Discarded from confirm queue";

export async function POST(req: Request) {
  const user = await guard();
  if (!user) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = await req.json().catch(() => null);
  const action: string = body?.action ?? "";

  try {
    if (action === "confirm") {
      const id = String(body?.id ?? "");
      if (!id) return NextResponse.json({ error: "Missing id." }, { status: 400 });
      const existing = await prisma.product.findUnique({ where: { id } });
      if (!existing) return NextResponse.json({ error: "Product not found." }, { status: 404 });

      const name = clean(body?.name) ?? existing.name;
      // Standardize the unit: an explicit edit must be a valid code; otherwise resolve
      // the stored legacy unit to its canonical code (Each if unknown) so a messy
      // existing value never blocks confirming.
      const providedUom = clean(body?.unitOfMeasure);
      if (providedUom && !isUomCode(providedUom)) {
        return NextResponse.json({ error: "Pick a unit of measure from the list." }, { status: 400 });
      }
      const unitOfMeasure = providedUom ?? uomCode(existing.unitOfMeasure) ?? "EA";
      const { division, subdivision } = normalizeClassification(body?.division, body?.subdivision);
      const upcRaw = body?.unitsPerCase;
      const unitsPerCase =
        upcRaw === "" || upcRaw == null ? null : Number.isFinite(Number(upcRaw)) ? Math.trunc(Number(upcRaw)) : existing.unitsPerCase;

      // Drop the "added from history" marker so the reconcile keeps this confirmed.
      const notes = existing.notes && existing.notes.includes(ADD_NOTE_MARK)
        ? clean(existing.notes.replace(/Added from transfer history[^.]*\.\s*/i, ""))
        : existing.notes;

      await prisma.product.update({
        where: { id },
        data: { name, unitOfMeasure, division, subdivision, unitsPerCase, confirmed: true, notes },
      });
      return NextResponse.json({ ok: true });
    }

    if (action === "merge") {
      const id = String(body?.id ?? "");
      const targetId = String(body?.targetId ?? "");
      if (!id || !targetId) return NextResponse.json({ error: "Pick a product to merge into." }, { status: 400 });
      if (id === targetId) return NextResponse.json({ error: "Can't merge a product into itself." }, { status: 400 });
      const [src, target] = await Promise.all([
        prisma.product.findUnique({ where: { id } }),
        prisma.product.findUnique({ where: { id: targetId } }),
      ]);
      if (!src || !target) return NextResponse.json({ error: "Product not found." }, { status: 404 });

      // Repoint ALL of the variant's history — purchase lines, stock movements,
      // barcodes, and checkout lines — onto the canonical product so ON-HAND
      // CONSOLIDATES onto one row, then deactivate the variant. Nothing is
      // hard-deleted; repointing a movement's productId keeps the full audit trail,
      // just attributed to the canonical product (the core data rule is preserved).
      await prisma.$transaction([
        prisma.invoiceLine.updateMany({ where: { productId: id }, data: { productId: targetId } }),
        prisma.stockMovement.updateMany({ where: { productId: id }, data: { productId: targetId } }),
        prisma.productBarcode.updateMany({ where: { productId: id }, data: { productId: targetId } }),
        prisma.checkoutLine.updateMany({ where: { productId: id }, data: { productId: targetId } }),
        prisma.product.update({
          where: { id },
          data: {
            active: false,
            confirmed: true,
            notes: [src.notes, `Merged into "${target.name}" (${target.id}) by ${user.name}.`].filter(Boolean).join(" "),
          },
        }),
      ]);
      return NextResponse.json({ ok: true, mergedInto: target.id });
    }

    // Approve an off-catalog product onto the approved catalog. Saves any edited
    // name/classification/unit (same fields as confirm) and sets approved+confirmed
    // so it becomes checkout-eligible and leaves the review queue.
    if (action === "approve") {
      const id = String(body?.id ?? "");
      if (!id) return NextResponse.json({ error: "Missing id." }, { status: 400 });
      const existing = await prisma.product.findUnique({ where: { id } });
      if (!existing) return NextResponse.json({ error: "Product not found." }, { status: 404 });
      const name = clean(body?.name) ?? existing.name;
      // STANDARDIZE the unit of measure to a canonical code — the same judgment used
      // when reading invoices. An explicit edit must be a valid code; otherwise resolve
      // the product's stored (often legacy, e.g. "bottle"→B, "gallon"→J, "box"→PK,
      // "pail"→BU) value to its canonical code, falling back to Each only if truly
      // unknown. Approving must never be blocked by a messy legacy unit.
      const providedUom = clean(body?.unitOfMeasure);
      if (providedUom && !isUomCode(providedUom)) return NextResponse.json({ error: "Pick a unit of measure from the list." }, { status: 400 });
      const unitOfMeasure = providedUom ?? uomCode(existing.unitOfMeasure) ?? "EA";
      const { division, subdivision } = normalizeClassification(body?.division, body?.subdivision);
      const notes = clean((existing.notes ?? "").replace(/Flagged for review by catalog cleanup[^.]*\.\s*/i, "").replace(/Added from transfer history[^.]*\.\s*/i, ""));
      await prisma.product.update({
        where: { id },
        data: {
          name, unitOfMeasure,
          division: division ?? existing.division, subdivision: subdivision ?? existing.subdivision,
          approved: true, confirmed: true, active: true, notes,
        },
      });
      return NextResponse.json({ ok: true });
    }

    if (action === "discard") {
      const id = String(body?.id ?? "");
      if (!id) return NextResponse.json({ error: "Missing id." }, { status: 400 });
      const existing = await prisma.product.findUnique({ where: { id } });
      if (!existing) return NextResponse.json({ error: "Product not found." }, { status: 404 });

      // Discard = remove from the catalog + confirm queue WITHOUT hard-deleting
      // (stock movements / history are preserved). Deactivate + un-approve, mark
      // confirmed so it leaves the queue, and stamp the discard marker so the
      // deploy reconcile won't resurrect it. Drop the "added from history" note.
      const base = clean((existing.notes ?? "").replace(/Added from transfer history[^.]*\.\s*/i, ""));
      const note = [base, `${DISCARD_MARK} by ${user.name} on ${new Date().toISOString().slice(0, 10)}.`]
        .filter(Boolean)
        .join(" ");
      await prisma.product.update({
        where: { id },
        data: { active: false, approved: false, confirmed: true, notes: note },
      });
      return NextResponse.json({ ok: true, discarded: id });
    }

    // Restore a rejected product — undo an accidental reject. Reactivates and
    // re-approves it back onto the catalog, standardizes the unit, and strips the
    // discard marker so the deploy reconcile won't re-reject it.
    if (action === "restore") {
      const id = String(body?.id ?? "");
      if (!id) return NextResponse.json({ error: "Missing id." }, { status: 400 });
      const existing = await prisma.product.findUnique({ where: { id } });
      if (!existing) return NextResponse.json({ error: "Product not found." }, { status: 404 });
      const notes = clean((existing.notes ?? "").replace(/Discarded from confirm queue[^.]*\.\s*/i, ""));
      const unitOfMeasure = uomCode(existing.unitOfMeasure) ?? "EA";
      await prisma.product.update({
        where: { id },
        data: { active: true, approved: true, confirmed: true, unitOfMeasure, notes },
      });
      return NextResponse.json({ ok: true, restored: id });
    }

    return NextResponse.json({ error: "Unknown action." }, { status: 400 });
  } catch (e) {
    return fail(e);
  }
}
