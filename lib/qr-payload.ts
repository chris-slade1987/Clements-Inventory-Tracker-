// Pure shelf-QR payload helpers (no server-only deps) so both server routes and
// lightweight tooling can use them. The QR *rendering* lives in lib/qr.ts.

/**
 * Shelf-label QR payload for a product. The barcode lookup route recognizes this
 * exact form (`canopy:product:<id>`) and resolves it directly to the product
 * (identifiedBy SHELF_QR), so a printed shelf label works like a barcode scan.
 */
export function productQrPayload(productId: string): string {
  return `canopy:product:${productId}`;
}

/** Parse a `canopy:product:<id>` payload back to the product id, or null. */
export function parseProductQrPayload(raw: string | null | undefined): string | null {
  const m = /^canopy:product:(.+)$/.exec((raw ?? "").trim());
  return m ? m[1].trim() : null;
}
