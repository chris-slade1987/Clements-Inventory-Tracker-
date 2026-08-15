import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth";
import { isUomCode } from "@/lib/uom";
import { normalizeClassification } from "@/lib/constants";

export const maxDuration = 20;

// The new-product formal-approval (confirm) queue actions. Confirming a product
// marks it human-reviewed (confirmed=true) and saves any edits; merging repoints
// a naming variant into a canonical product and deactivates the variant (never a
// hard-delete). Admin + HR only — this is a data-quality gate.
async function guard() {
  const user = await getSessionUser();
  if (!user) return null;
  if (user.role !== "admin" && !user.hrAccess) return null;
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
      const unitOfMeasure = clean(body?.unitOfMeasure) ?? existing.unitOfMeasure;
      if (!isUomCode(unitOfMeasure)) {
        return NextResponse.json({ error: "Pick a unit of measure from the list." }, { status: 400 });
      }
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

      // Repoint the variant's purchase-history lines onto the canonical product,
      // then deactivate the variant. Stock movements are NEVER touched (on-hand is
      // preserved); nothing is hard-deleted.
      await prisma.$transaction([
        prisma.invoiceLine.updateMany({ where: { productId: id }, data: { productId: targetId } }),
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

    return NextResponse.json({ error: "Unknown action." }, { status: 400 });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
