import { redirect } from "next/navigation";
import { EmptyState } from "@/components/ui";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { uomLabel } from "@/lib/uom";
import { divisionLabel } from "@/lib/constants";
import ConfirmQueue from "./ConfirmQueue";

export const dynamic = "force-dynamic";

export default async function ConfirmQueuePage() {
  // Admin + HR only (data-quality gate). The layout already gates access; this
  // is an explicit belt-and-braces guard.
  const user = await requireUser();
  if (user.role !== "admin" && !user.hrAccess) redirect("/dashboard");

  const [pending, confirmedProducts] = await Promise.all([
    prisma.product.findMany({
      where: { confirmed: false, active: true },
      orderBy: { name: "asc" },
    }),
    prisma.product.findMany({
      where: { confirmed: true, active: true },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
  ]);

  if (pending.length === 0) {
    return (
      <EmptyState
        title="Nothing to confirm"
        hint="Every catalog product has been reviewed. Auto-added products (from invoices or history) will appear here for a manager to confirm before they can be checked out."
      />
    );
  }

  return (
    <>
      <p className="mb-4 text-sm text-muted">
        {pending.length} product{pending.length === 1 ? "" : "s"} auto-added from invoices or
        transfer history need a manager to confirm the details before they can be dispersed at
        check-out. Review each row, fix the name / classification / unit, then confirm — or merge a
        naming variant into an existing product.
      </p>
      <ConfirmQueue
        products={pending.map((p) => ({
          id: p.id,
          name: p.name,
          division: p.division,
          subdivision: p.subdivision,
          divisionLabel: divisionLabel(p.division),
          unitOfMeasure: p.unitOfMeasure,
          unitLabel: uomLabel(p.unitOfMeasure),
          unitsPerCase: p.unitsPerCase,
          category: p.category,
          manufacturer: p.manufacturer,
          notes: p.notes,
          distributorSku: p.distributorSku,
        }))}
        confirmedProducts={confirmedProducts}
      />
    </>
  );
}
