// PURE parser for the PestPac "Appointment List" export (no DB / no server-only
// imports, so it can be unit-tested and reused by the server ingest). Each 4-line
// record carries the scheduled TIME; records with a blank Time Range are "floated".

export type ParsedAppt = {
  route: string;
  techLabel: string; // raw "01 JOSH  Josh Main"
  date: string; // YYYY/MM/DD
  time: string | null; // "06:50 AM-06:55 AM" or null (floated)
  account: string | null;
  customer: string | null;
  service: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  amount: number;
};

const money = (s: string | undefined): number => {
  const n = parseFloat((s ?? "").replace(/[^0-9.-]/g, ""));
  return Number.isFinite(n) ? n : 0;
};

/** Short display label from a PestPac tech label: "26 ROB  Rob Segroves" -> "ROB". */
export function shortTechLabel(label: string): string {
  return label.replace(/^\d+\s*/, "").split(/\s{2,}/)[0].trim() || label.trim();
}

/** Split "Vero Beach, FL 32968-1039" -> {city, state, zip}. */
export function splitCityStateZip(v: string | undefined): { city: string | null; state: string | null; zip: string | null } {
  const s = (v ?? "").trim();
  if (!s) return { city: null, state: null, zip: null };
  const comma = s.lastIndexOf(",");
  const city = comma >= 0 ? s.slice(0, comma).trim() : s;
  const rest = comma >= 0 ? s.slice(comma + 1).trim() : "";
  const m = rest.match(/^([A-Za-z]{2})\s+(\S+)/);
  return { city: city || null, state: m?.[1] ?? null, zip: m?.[2] ?? null };
}

/** Parse the Appointment List (4-line records) preserving file order. */
export function parseAppointmentSchedule(text: string): ParsedAppt[] {
  const rows = text.split(/\r?\n/).map((l) => l.split("\t"));
  const out: ParsedAppt[] = [];
  for (let i = 0; i < rows.length; i++) {
    const cur = rows[i];
    // The service-date line anchors a record: col0 = "YYYY/MM/DD  Weekday".
    if (!/^\d{4}\/\d{2}\/\d{2}\s/.test(cur[0] ?? "")) continue;
    const prev = rows[i - 1] ?? [];
    const next = rows[i + 1] ?? [];
    const route = (next[5] ?? "").trim();
    const account = (cur[2] ?? "").trim();
    if (!route || !/^\d/.test(account)) continue; // not a real appointment row
    const csz = splitCityStateZip(next[3]);
    const timeRaw = (next[0] ?? "").trim();
    out.push({
      route,
      techLabel: (prev[0] ?? "").trim(),
      date: (cur[0] ?? "").trim().split(/\s+/)[0],
      time: timeRaw || null,
      account,
      customer: (prev[3] ?? "").trim() || null,
      service: (cur[6] ?? "").trim().toUpperCase() || null,
      address: (cur[3] ?? "").trim() || null,
      city: csz.city,
      state: csz.state,
      zip: csz.zip,
      amount: money(prev[1]),
    });
  }
  return out;
}

export function periodLabelOf(periodKey: string): string {
  const [y, m] = periodKey.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
}

export function previewAppointmentSchedule(text: string): {
  ok: boolean; error?: string; periodKey?: string; periodLabel?: string; appts?: number; timed?: number; floated?: number;
} {
  const appts = parseAppointmentSchedule(text);
  if (appts.length === 0) return { ok: false, error: "No appointments found — is this the PestPac Appointment List export?" };
  const dates = appts.map((a) => a.date).filter(Boolean).sort();
  const [y, m] = dates[0].split("/").map(Number);
  const periodKey = `${y}-${String(m).padStart(2, "0")}`;
  return {
    ok: true,
    periodKey,
    periodLabel: periodLabelOf(periodKey),
    appts: appts.length,
    timed: appts.filter((a) => a.time).length,
    floated: appts.filter((a) => !a.time).length,
  };
}
