import { PageHeader } from "@/components/ui";
import { redirect } from "next/navigation";
import { requireUser, isBoardObserver } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { invoiceReaderMode } from "@/lib/invoice/parse";
import type { ParsedLine } from "@/lib/invoice/types";
import CheckInClient, { type InitialDraft } from "./CheckInClient";

export const dynamic = "force-dynamic";

export default async function CheckInPage({
  searchParams,
}: {
  searchParams: Promise<{ draft?: string }>;
}) {
  const user = await requireUser();
  if (isBoardObserver(user)) redirect("/management/board");
  const [warehouses, products] = await Promise.all([
    prisma.warehouse.findMany({ where: { active: true }, orderBy: { name: "asc" } }),
    prisma.product.findMany({ where: { active: true }, orderBy: { name: "asc" } }),
  ]);

  // A staged draft from the Document Intake hand-off (`?draft=<id>`). We load its
  // parsed lines so the manager reviews → chat-edits → Confirms. Nothing posts
  // stock here; Confirm (POST /api/check-in/confirm) remains the only such path.
  const { draft: draftId } = await searchParams;
  let initialDraft: InitialDraft | null = null;
  if (draftId) {
    const d = await prisma.checkInDraft.findUnique({ where: { id: draftId } });
    if (d) {
      let lines: ParsedLine[] = [];
      try {
        const parsed = JSON.parse(d.lines) as unknown;
        if (Array.isArray(parsed)) lines = parsed as ParsedLine[];
      } catch {
        lines = [];
      }
      initialDraft = {
        warehouseId: d.warehouseId,
        distributor: d.distributor ?? "",
        invoiceNumber: d.invoiceNumber ?? "",
        invoiceDate: d.invoiceDate ?? "",
        subtotal: d.subtotal,
        total: d.total,
        filePath: d.filePath,
        lines,
      };
      // Stamp consumedAt on first open (best-effort; a refresh still reloads it).
      if (!d.consumedAt) {
        await prisma.checkInDraft.update({ where: { id: d.id }, data: { consumedAt: new Date() } }).catch(() => {});
      }
    }
  }

  return (
    <>
      <PageHeader
        title="Check-In"
        subtitle="Receive products into a warehouse from a distributor invoice."
      />
      <CheckInClient
        mode={invoiceReaderMode()}
        defaultWarehouseId={user.warehouseId ?? warehouses[0]?.id ?? ""}
        warehouses={warehouses.map((w) => ({ id: w.id, name: w.name }))}
        products={products.map((p) => ({
          id: p.id,
          name: p.name,
          unit: p.unitOfMeasure,
          distributorSku: p.distributorSku,
        }))}
        initialDraft={initialDraft}
      />
    </>
  );
}
