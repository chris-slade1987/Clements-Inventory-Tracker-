import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUser, isSuperAdmin } from "@/lib/auth";
import { isUomCode } from "@/lib/uom";
import { normalizeClassification } from "@/lib/constants";
import { Prisma } from "@prisma/client";

export const maxDuration = 20;

// Catalog create/update/deactivate — super-admin-only (Chris, Julie, April).
async function guard() {
  const user = await getSessionUser();
  if (!user || !isSuperAdmin(user)) return null;
  return user;
}

function clean(v: unknown): string | null {
  const s = typeof v === "string" ? v.trim() : "";
  return s === "" ? null : s;
}

export async function POST(req: Request) {
  const user = await guard();
  if (!user) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = await req.json().catch(() => null);
  const action: string = body?.action ?? "";

  try {
    if (action === "create" || action === "update") {
      const name = clean(body?.name);
      const unitOfMeasure = clean(body?.unitOfMeasure);
      if (!name) return NextResponse.json({ error: "Name is required." }, { status: 400 });
      if (!unitOfMeasure) return NextResponse.json({ error: "Unit of measure is required." }, { status: 400 });
      if (!isUomCode(unitOfMeasure)) return NextResponse.json({ error: "Pick a unit of measure from the list." }, { status: 400 });

      const data: Prisma.ProductUncheckedCreateInput = {
        name,
        unitOfMeasure,
        manufacturer: clean(body?.manufacturer),
        epaRegNumber: clean(body?.epaRegNumber),
        category: clean(body?.category),
        activeIngredient: clean(body?.activeIngredient),
        targetPest: clean(body?.targetPest),
        applicationMethod: clean(body?.applicationMethod),
        barcode: clean(body?.barcode),
        distributorSku: clean(body?.distributorSku),
      };

      // Extra profile fields the Edit screen sends. Only touched when present in
      // the body, so the catalog-list form (which omits them) never nulls them.
      const has = (k: string) => Object.prototype.hasOwnProperty.call(body ?? {}, k);
      if (has("form")) data.form = clean(body?.form);
      if (has("notes")) data.notes = clean(body?.notes);
      if (has("approved")) data.approved = body?.approved === true;
      if (has("active")) data.active = body?.active === true;
      if (has("division") || has("subdivision")) {
        const norm = normalizeClassification(body?.division, body?.subdivision);
        data.division = norm.division;
        data.subdivision = norm.subdivision;
      }

      // A super admin deliberately putting a product on the catalog: stamp it so the
      // approved-catalog reconcile keeps it (seed isHumanApproved / catalog cleanup).
      const stamp = `Approved onto catalog by ${user.name} on ${new Date().toISOString().slice(0, 10)}.`;
      if (action === "create") {
        if (data.approved !== false) data.notes = [data.notes, stamp].filter(Boolean).join(" ");
        const p = await prisma.product.create({ data });
        return NextResponse.json({ ok: true, id: p.id });
      } else {
        const id = String(body?.id ?? "");
        if (!id) return NextResponse.json({ error: "Missing id." }, { status: 400 });
        if (data.approved === true) {
          const cur = await prisma.product.findUnique({ where: { id }, select: { approved: true, notes: true } });
          if (cur && !cur.approved) data.notes = [has("notes") ? data.notes : cur.notes, stamp].filter(Boolean).join(" ");
        }
        await prisma.product.update({ where: { id }, data });
        return NextResponse.json({ ok: true });
      }
    }

    if (action === "setActive") {
      const id = String(body?.id ?? "");
      const active = body?.active === true;
      if (!id) return NextResponse.json({ error: "Missing id." }, { status: 400 });
      await prisma.product.update({ where: { id }, data: { active } });
      return NextResponse.json({ ok: true });
    }

    return NextResponse.json({ error: "Unknown action." }, { status: 400 });
  } catch (e) {
    const msg = (e as { code?: string }).code === "P2002"
      ? "That barcode is already used by another product."
      : (e as Error).message;
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}
