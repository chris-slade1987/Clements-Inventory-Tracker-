// Pure routing analytics — the numbers + findings behind the Routing Approval
// dashboard. No DB / server-only imports so it is unit-testable and the server
// and UI compute identically. Mileage / drive / fuel are MODELED estimates until
// the live geocode + Coast fuel join replace them (clearly labeled in the UI).

export const FLEET_MPG = 18; // modeled fleet average
export const GAS_PRICE = 3.45; // modeled $/gal (Coast trailing est.)

export type DayInput = { stops: { amount: number }[] };

export type RouteMetrics = {
  sizes: number[];
  stops: number;
  dollars: number;
  days: number;
  avg: number;
  median: number;
  max: number;
  min: number;
  balance: number; // 0-100, higher = more even daily load
  perStop: number;
  perDay: number;
  estMiles: number;
  estDriveMin: number;
  estFuel: number;
};

export type RouteKind = "route" | "commercial" | "senior" | "exclude";
export type Status = "good" | "warn" | "alarm" | "info";

function median(a: number[]): number {
  if (!a.length) return 0;
  const b = [...a].sort((x, y) => x - y);
  const m = b.length >> 1;
  return b.length % 2 ? b[m] : (b[m - 1] + b[m]) / 2;
}
function mean(a: number[]): number {
  return a.length ? a.reduce((s, x) => s + x, 0) / a.length : 0;
}
function std(a: number[]): number {
  const m = mean(a);
  return Math.sqrt(mean(a.map((x) => (x - m) ** 2)));
}

export function computeMetrics(days: DayInput[]): RouteMetrics {
  const working = days.filter((d) => d.stops.length > 0);
  const sizes = working.map((d) => d.stops.length);
  const stops = working.reduce((s, d) => s + d.stops.length, 0);
  const dollars = working.reduce((s, d) => s + d.stops.reduce((a, x) => a + (x.amount || 0), 0), 0);
  const nDays = working.length;
  const avg = stops / Math.max(1, nDays);
  const cv = avg ? std(sizes) / avg : 0;
  const balance = Math.max(0, Math.min(100, Math.round((1 - cv) * 100)));
  let estMiles = 0;
  let estDriveMin = 0;
  for (const n of sizes) {
    const md = 6 + n * 2.3; // modeled miles for a day of n stops
    estMiles += md;
    estDriveMin += md / 32 * 60 + n * 7; // travel + per-stop transition
  }
  return {
    sizes,
    stops,
    dollars,
    days: nDays,
    avg: +avg.toFixed(1),
    median: median(sizes),
    max: Math.max(0, ...sizes),
    min: sizes.length ? Math.min(...sizes) : 0,
    balance,
    perStop: dollars / Math.max(1, stops),
    perDay: dollars / Math.max(1, nDays),
    estMiles: Math.round(estMiles),
    estDriveMin: Math.round(estDriveMin),
    estFuel: (estMiles / FLEET_MPG) * GAS_PRICE,
  };
}

export function routeStatus(kind: RouteKind, m: RouteMetrics): Status {
  if (kind !== "route") return "info";
  if (m.max >= 30) return "alarm";
  if (m.avg < 6 || m.max >= 26 || m.balance < 55) return "warn";
  return "good";
}

export type Finding = {
  key: string;
  severity: Status;
  title: string;
  detail: string;
  rec?: string;
  question?: string;
  requiresResponse: boolean;
};

const money = (n: number) => "$" + Math.round(n).toLocaleString();

/** Rule-based findings — the deterministic baseline the AI layer later augments.
 *  Ordered by severity. Respects route kind (commercial/senior aren't graded on
 *  stops/day). `question` present ⇒ a written response is required to sign. */
export function buildFindings(opts: {
  name: string;
  kind: RouteKind;
  partner?: string | null;
  m: RouteMetrics;
}): Finding[] {
  const { name, kind, partner, m } = opts;
  const f: Finding[] = [];
  if (kind === "route" && m.max >= 26) {
    const over = Math.round((m.max / Math.max(1, m.median) - 1) * 100);
    const shift = Math.max(4, Math.round((m.max - m.median) / 1.5));
    f.push({
      key: "heavy-day",
      severity: m.max >= 30 ? "alarm" : "warn",
      title: `Heavy day — ${m.max} stops`,
      detail: `${name}'s biggest day is ${m.max} stops vs a ${m.median}-stop median (~${over}% over). Long days risk rushed service and late arrivals.`,
      rec: `Shift ~${shift} stops to a lighter day to even the week.`,
      question: "Why is this day loaded, and can it be rebalanced?",
      requiresResponse: true,
    });
  }
  if (kind === "route" && m.balance < 60) {
    f.push({
      key: "uneven",
      severity: "warn",
      title: `Uneven month — balance ${m.balance}`,
      detail: `Daily load swings from ${m.min} to ${m.max} stops. A lumpy month usually means some days are rushed and others light.`,
      rec: `Keep most days within a few stops of the ${m.median}-stop median.`,
      question: "Is the swing driven by the schedule, or can days be leveled?",
      requiresResponse: true,
    });
  }
  if (kind === "route" && m.avg < 7) {
    f.push({
      key: "light",
      severity: "warn",
      title: `Light route — ${m.avg} stops/day`,
      detail: `Averaging ${m.avg} stops/day across ${m.days} days. If not commercial or training, there may be room for more density.`,
      rec: "Consider adding stops or reassigning territory.",
      question: "Is the light load intentional?",
      requiresResponse: true,
    });
  }
  if (kind === "commercial") {
    f.push({
      key: "commercial",
      severity: "info",
      title: "Commercial route — fewer, larger stops (expected)",
      detail: `${name} runs commercial accounts${partner ? ` with route ${partner} (paired crew, overlapping jobs)` : ""}. Low stop counts and high $/stop (${money(m.perStop)}) are normal here — not graded on stops/day.`,
      rec: "Review coverage and $, not stop density.",
      question: "Confirm the commercial setup is correct this month.",
      requiresResponse: true,
    });
  }
  if (kind === "senior") {
    f.push({
      key: "senior",
      severity: "good",
      title: "Senior / manager schedule — included for visibility",
      detail: `${name} is senior staff; their ${m.stops} scheduled stops are shown so nothing is missed, but they're not graded on route efficiency.`,
      rec: "Scan for anything that shouldn't be on a senior schedule.",
      question: "Acknowledge you've reviewed it.",
      requiresResponse: true,
    });
  }
  f.push({
    key: "fuel",
    severity: "info",
    title: `Modeled fuel: ${money(m.estFuel)} this month`,
    detail: `~${m.estMiles.toLocaleString()} mi ÷ ${FLEET_MPG} mpg × $${GAS_PRICE}/gal (Coast est.) = ${money(m.estFuel / Math.max(1, m.stops))}/stop in fuel — a cost-to-serve lens that sharpens as real Coast fuel + odometer data accrue.`,
    requiresResponse: false,
  });
  const order: Record<Status, number> = { alarm: 0, warn: 1, info: 2, good: 3 };
  return f.sort((a, b) => order[a.severity] - order[b.severity]);
}
