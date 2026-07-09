import { unzipSync, strFromU8 } from "fflate";

// Minimal .xlsx reader (first worksheet) with no heavy dependencies. Good
// enough for simple, flat employee/catalog sheets exported from Excel/Sheets.

function decode(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)));
}

function colIndex(ref: string): number {
  const m = ref.match(/^([A-Z]+)\d+$/);
  if (!m) return 0;
  let n = 0;
  for (const ch of m[1]) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}
function rowNum(ref: string): number {
  return Number(ref.match(/(\d+)$/)?.[1] ?? "0");
}

/** Parse the first worksheet into a grid of string cells keyed by [row][col]. */
function readGrid(buf: Uint8Array): Map<number, Map<number, string>> {
  const files = unzipSync(buf);

  // Shared strings.
  const shared: string[] = [];
  const ssFile = files["xl/sharedStrings.xml"];
  if (ssFile) {
    const xml = strFromU8(ssFile);
    for (const si of xml.match(/<si>[\s\S]*?<\/si>/g) ?? []) {
      const parts = [...si.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((m) => m[1]);
      shared.push(decode(parts.join("")));
    }
  }

  // First worksheet.
  const sheetName =
    Object.keys(files)
      .filter((f) => /^xl\/worksheets\/sheet\d+\.xml$/.test(f))
      .sort()[0] ?? "xl/worksheets/sheet1.xml";
  const sheet = strFromU8(files[sheetName]);

  const grid = new Map<number, Map<number, string>>();
  const cellRe = /<c\s+([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g;
  let m: RegExpExecArray | null;
  while ((m = cellRe.exec(sheet))) {
    const attrs = m[1];
    const inner = m[2] ?? "";
    const ref = attrs.match(/r="([A-Z]+\d+)"/)?.[1];
    if (!ref) continue;
    const t = attrs.match(/t="([^"]+)"/)?.[1];
    let val = "";
    if (t === "s") {
      const idx = Number(inner.match(/<v>(\d+)<\/v>/)?.[1] ?? "-1");
      val = shared[idx] ?? "";
    } else if (t === "inlineStr") {
      val = decode(
        [...inner.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((x) => x[1]).join("")
      );
    } else {
      val = decode(inner.match(/<v>([\s\S]*?)<\/v>/)?.[1] ?? "");
    }
    const r = rowNum(ref);
    if (!grid.has(r)) grid.set(r, new Map());
    grid.get(r)!.set(colIndex(ref), val.trim());
  }
  return grid;
}

/**
 * Read the first worksheet into row objects keyed by normalized header names.
 * The header is the first row with 2+ non-empty cells.
 */
export function readXlsxObjects(buf: Uint8Array): {
  headers: string[];
  rows: Record<string, string>[];
} {
  const grid = readGrid(buf);
  const rowNums = [...grid.keys()].sort((a, b) => a - b);
  let headerRow = -1;
  for (const r of rowNums) {
    const nonEmpty = [...grid.get(r)!.values()].filter((v) => v !== "").length;
    if (nonEmpty >= 2) {
      headerRow = r;
      break;
    }
  }
  if (headerRow === -1) return { headers: [], rows: [] };

  const headerCells = grid.get(headerRow)!;
  const maxCol = Math.max(...headerCells.keys());
  const headers: string[] = [];
  const keys: string[] = [];
  for (let c = 0; c <= maxCol; c++) {
    const h = headerCells.get(c) ?? "";
    headers.push(h);
    keys.push(h.toLowerCase().replace(/[^a-z0-9]/g, ""));
  }

  const rows: Record<string, string>[] = [];
  for (const r of rowNums) {
    if (r <= headerRow) continue;
    const cells = grid.get(r)!;
    if (![...cells.values()].some((v) => v !== "")) continue;
    const obj: Record<string, string> = {};
    keys.forEach((k, c) => {
      if (k) obj[k] = cells.get(c) ?? "";
    });
    rows.push(obj);
  }
  return { headers, rows };
}
