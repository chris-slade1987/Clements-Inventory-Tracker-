import "server-only";
import QRCode from "qrcode";

export { productQrPayload, parseProductQrPayload } from "@/lib/qr-payload";

/**
 * Render a QR code for `text` as a self-contained inline SVG string (no external
 * requests — the printable label sheet works offline). Error-correction level M
 * balances density and print scan reliability; a 1-module quiet zone is added.
 */
export async function qrSvg(text: string): Promise<string> {
  return QRCode.toString(text, {
    type: "svg",
    errorCorrectionLevel: "M",
    margin: 1,
    width: 160,
  });
}
