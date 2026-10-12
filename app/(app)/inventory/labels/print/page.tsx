import { requireAdmin } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { qrSvg, productQrPayload } from "@/lib/qr";
import PrintButton from "./PrintButton";

export const dynamic = "force-dynamic";

// Printable QR-label sheet. Each label carries the product name, distributor SKU,
// and a QR encoding `canopy:product:<id>` (the barcode route resolves it as a
// SHELF_QR scan). Sized for Avery 2"x1" (5160-style) or 2"x2" labels via print CSS.
export default async function LabelsPrintPage({
  searchParams,
}: {
  searchParams: Promise<{ ids?: string; size?: string }>;
}) {
  await requireAdmin();
  const sp = await searchParams;
  const ids = (sp.ids ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  const size = sp.size === "2x2" ? "2x2" : "2x1";

  const products = ids.length
    ? await prisma.product.findMany({ where: { id: { in: ids } }, select: { id: true, name: true, distributorSku: true } })
    : [];
  const byId = new Map(products.map((p) => [p.id, p]));
  // Preserve the requested order.
  const ordered = ids.map((id) => byId.get(id)).filter((p): p is NonNullable<typeof p> => !!p);

  const labels = await Promise.all(
    ordered.map(async (p) => ({ ...p, svg: await qrSvg(productQrPayload(p.id)) })),
  );

  const dims = size === "2x2" ? { w: "2in", h: "2in", qr: "1.3in" } : { w: "2in", h: "1in", qr: "0.8in" };

  return (
    <div>
      <style>{`
        @media print {
          body * { visibility: hidden !important; }
          #label-sheet, #label-sheet * { visibility: visible !important; }
          #label-sheet { position: absolute; left: 0; top: 0; }
          .no-print { display: none !important; }
          @page { margin: 0.25in; }
        }
        #label-sheet { display: flex; flex-wrap: wrap; gap: 0.1in; }
        .qr-label {
          width: ${dims.w}; height: ${dims.h};
          box-sizing: border-box; border: 1px dashed #cfe0d6;
          display: flex; align-items: center; gap: 0.1in; padding: 0.06in;
          overflow: hidden; page-break-inside: avoid;
        }
        .qr-label .qr { width: ${dims.qr}; height: ${dims.qr}; flex-shrink: 0; }
        .qr-label .qr svg { width: 100%; height: 100%; }
        .qr-label .meta { min-width: 0; font-family: ui-sans-serif, system-ui, sans-serif; }
        .qr-label .name { font-size: ${size === "2x2" ? "11px" : "9px"}; font-weight: 600; line-height: 1.1;
          display: -webkit-box; -webkit-line-clamp: ${size === "2x2" ? 4 : 3}; -webkit-box-orient: vertical; overflow: hidden; }
        .qr-label .sku { font-size: 8px; color: #4b5563; margin-top: 2px; }
      `}</style>

      <div className="no-print mb-4 flex items-center gap-3">
        <PrintButton />
        <span className="text-sm text-muted">{labels.length} label{labels.length === 1 ? "" : "s"} · Avery {size === "2x2" ? "2\" × 2\"" : "2\" × 1\""}</span>
      </div>

      {labels.length === 0 ? (
        <p className="text-sm text-muted">No products selected.</p>
      ) : (
        <div id="label-sheet">
          {labels.map((l) => (
            <div key={l.id} className="qr-label">
              <div className="qr" dangerouslySetInnerHTML={{ __html: l.svg }} />
              <div className="meta">
                <div className="name">{l.name}</div>
                {l.distributorSku ? <div className="sku">SKU {l.distributorSku}</div> : null}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
