// Minimal dependency-free CSV parser. Handles quoted fields, escaped quotes
// (""), commas and newlines inside quotes, and CRLF line endings.

export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  const s = text.replace(/\r\n?/g, "\n");

  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inQuotes) {
      if (c === '"') {
        if (s[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += c;
    }
  }
  // last field/row (if file doesn't end in newline)
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  // Drop fully-empty trailing rows.
  return rows.filter((r) => r.some((cell) => cell.trim() !== ""));
}

/**
 * Parse CSV with a header row into objects keyed by normalized header names
 * (lowercased, non-alphanumerics stripped). Returns the raw header list too.
 */
export function parseCsvObjects(text: string): {
  headers: string[];
  rows: Record<string, string>[];
} {
  const table = parseCsv(text);
  if (table.length === 0) return { headers: [], rows: [] };
  const headers = table[0].map((h) => h.trim());
  const keys = headers.map((h) => h.toLowerCase().replace(/[^a-z0-9]/g, ""));
  const rows = table.slice(1).map((cells) => {
    const obj: Record<string, string> = {};
    keys.forEach((k, i) => {
      obj[k] = (cells[i] ?? "").trim();
    });
    return obj;
  });
  return { headers, rows };
}
