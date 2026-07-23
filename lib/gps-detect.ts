import "server-only";
import { prisma } from "@/lib/prisma";
import { branchLabel } from "@/lib/management";

// GPS intelligence layer (Phase 2): the deterministic detection engine, the
// optional Claude "AI pattern" layer, and the read helpers that power the GPS
// analytics dashboard + the dedicated GPS Alerts section.
//
// CORE RULE: detection operates ONLY on REAL telemetry (`sample:false`). Sample
// data may still render on the dashboard (with a banner), but we NEVER file an
// alert from synthesized rows. GpsAlert is separate from the inventory Alert
// model, and rows are never hard-deleted — ack/dismiss flips `status`.

// ---- Thresholds --------------------------------------------------------
// Documented defaults; each is overridable via env for a quick tune without a
// deploy of code (deploy-db uses `prisma db push`, so no migration is needed).

function envNum(name: string, fallback: number): number {
  const v = process.env[name];
  if (!v) return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

export const GPS_THRESHOLDS = {
  /** A position faster than this (mph) is a speeding event. */
  SPEED_MPH: envNum("GPS_SPEED_MPH", 80),
  /** Continuous ignition-on/near-stationary longer than this (minutes) is a long idle. */
  IDLE_MIN: envNum("GPS_IDLE_MIN", 15),
  /** Business hours in America/New_York; movement outside these (or on Sunday) is after-hours. */
  BUSINESS_START_HOUR: envNum("GPS_BUSINESS_START", 6),
  BUSINESS_END_HOUR: envNum("GPS_BUSINESS_END", 19),
  /** A linked vehicle with no real ping in more than this many hours is offline. */
  OFFLINE_HOURS: envNum("GPS_OFFLINE_HOURS", 24),
  /** A position farther than this (miles) from every FL branch center is out-of-area. */
  AREA_MILES: envNum("GPS_AREA_MILES", 60),
  /** Trailing analysis window (days). */
  WINDOW_DAYS: envNum("GPS_WINDOW_DAYS", 7),
  /** Speed (mph) above which a vehicle counts as "moving" for after-hours detection. */
  MOVING_SPEED_MPH: 5,
  /** Speed (mph) at/under which a vehicle counts as stationary for idle detection. */
  IDLE_SPEED_MPH: 1,
} as const;

// Approximate branch-office centers for the out-of-area haversine check.
const GPS_BRANCH_CENTERS: { key: string; lat: number; lng: number }[] = [
  { key: "vero", lat: 27.6386, lng: -80.3973 },
  { key: "stuart", lat: 27.1975, lng: -80.2528 },
  { key: "orlando", lat: 28.5383, lng: -81.3792 },
  { key: "naples", lat: 26.142, lng: -81.7948 },
];

// ---- Geo + time helpers ------------------------------------------------

function haversineMiles(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const R = 3958.8; // Earth radius, miles
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(bLat - aLat);
  const dLng = toRad(bLng - aLng);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
}

/** Miles to the nearest branch center. */
function milesFromNearestBranch(lat: number, lng: number): number {
  let min = Infinity;
  for (const b of GPS_BRANCH_CENTERS) {
    const d = haversineMiles(lat, lng, b.lat, b.lng);
    if (d < min) min = d;
  }
  return min;
}

const WD: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

/** ET (America/New_York) hour, weekday (0=Sun), and YYYY-MM-DD for a UTC instant. */
function etInfo(d: Date): { hour: number; dow: number; ymd: string } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hour12: false,
    weekday: "short",
  }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  let hour = parseInt(get("hour"), 10);
  if (Number.isNaN(hour) || hour === 24) hour = 0;
  return { hour, dow: WD[get("weekday")] ?? 0, ymd: `${get("year")}-${get("month")}-${get("day")}` };
}

// ---- Detection ---------------------------------------------------------

type PosRow = {
  vehicleId: string | null;
  verizonNumber: string;
  ts: Date;
  lat: number;
  lng: number;
  speed: number | null;
  ignition: boolean | null;
  address: string | null;
  vehicle: { id: string; name: string; unitNumber: string | null; branch: string | null } | null;
};

type Finding = {
  type: string;
  severity: string;
  vehicleId: string | null;
  verizonNumber: string;
  branch: string | null;
  title: string;
  detail: string;
  evidence: unknown;
  dedupeKey: string;
};

function label(v: PosRow["vehicle"], vn: string): string {
  if (v) return `${v.unitNumber ? `${v.unitNumber} · ` : ""}${v.name}`;
  return `Vehicle ${vn}`;
}

export type DetectResult = {
  ran: boolean;
  created: number;
  byType: Record<string, number>;
  scannedPositions: number;
};

/**
 * Run the deterministic detection rules over REAL telemetry in the trailing
 * window and upsert a GpsAlert per finding (stable dedupeKey; never reopens an
 * ack'd/dismissed alert). Never throws — returns a summary.
 */
export async function detectGpsIssues(now: Date = new Date()): Promise<DetectResult> {
  const byType: Record<string, number> = {};
  try {
    const since = new Date(now.getTime() - GPS_THRESHOLDS.WINDOW_DAYS * 864e5);
    const positions = (await prisma.gpsPosition.findMany({
      where: { sample: false, ts: { gte: since } },
      orderBy: [{ verizonNumber: "asc" }, { ts: "asc" }],
      select: {
        vehicleId: true,
        verizonNumber: true,
        ts: true,
        lat: true,
        lng: true,
        speed: true,
        ignition: true,
        address: true,
        vehicle: { select: { id: true, name: true, unitNumber: true, branch: true } },
      },
    })) as PosRow[];

    const findings: Finding[] = [];

    // Group positions by vehicle (verizonNumber) for the streaming rules.
    const byVehicle = new Map<string, PosRow[]>();
    for (const p of positions) {
      const arr = byVehicle.get(p.verizonNumber) ?? [];
      arr.push(p);
      byVehicle.set(p.verizonNumber, arr);
    }

    for (const [vn, rows] of byVehicle) {
      const v = rows.find((r) => r.vehicle)?.vehicle ?? null;
      const vehicleId = v?.id ?? rows.find((r) => r.vehicleId)?.vehicleId ?? null;
      const branch = v?.branch ?? null;

      // --- speeding (worst per ET day) ---
      const worstSpeed = new Map<string, PosRow>();
      // --- after-hours (representative per ET day) ---
      const afterHours = new Map<string, PosRow>();
      // --- out-of-area (farthest per ET day) ---
      const outArea = new Map<string, { p: PosRow; miles: number }>();

      for (const p of rows) {
        const { hour, dow, ymd } = etInfo(p.ts);
        const speed = p.speed ?? 0;

        if (speed > GPS_THRESHOLDS.SPEED_MPH) {
          const cur = worstSpeed.get(ymd);
          if (!cur || (p.speed ?? 0) > (cur.speed ?? 0)) worstSpeed.set(ymd, p);
        }

        const afterBiz = hour < GPS_THRESHOLDS.BUSINESS_START_HOUR || hour >= GPS_THRESHOLDS.BUSINESS_END_HOUR || dow === 0;
        if (speed > GPS_THRESHOLDS.MOVING_SPEED_MPH && afterBiz) {
          if (!afterHours.has(ymd)) afterHours.set(ymd, p);
        }

        const miles = milesFromNearestBranch(p.lat, p.lng);
        if (miles > GPS_THRESHOLDS.AREA_MILES) {
          const cur = outArea.get(ymd);
          if (!cur || miles > cur.miles) outArea.set(ymd, { p, miles });
        }
      }

      for (const [ymd, p] of worstSpeed) {
        const mph = Math.round(p.speed ?? 0);
        findings.push({
          type: "speeding",
          severity: mph >= 95 ? "critical" : "warning",
          vehicleId,
          verizonNumber: vn,
          branch,
          title: `${label(v, vn)} — ${mph} mph`,
          detail: `Recorded ${mph} mph (threshold ${GPS_THRESHOLDS.SPEED_MPH}) on ${ymd}${p.address ? ` near ${p.address}` : ""}.`,
          evidence: { ts: p.ts, speed: p.speed, lat: p.lat, lng: p.lng, thresholdMph: GPS_THRESHOLDS.SPEED_MPH },
          dedupeKey: `speeding:${vn}:${ymd}`,
        });
      }
      for (const [ymd, p] of afterHours) {
        const { hour } = etInfo(p.ts);
        findings.push({
          type: "after_hours",
          severity: "warning",
          vehicleId,
          verizonNumber: vn,
          branch,
          title: `${label(v, vn)} — after-hours movement`,
          detail: `Movement at ~${String(hour).padStart(2, "0")}:00 ET on ${ymd} (business hours ${GPS_THRESHOLDS.BUSINESS_START_HOUR}:00–${GPS_THRESHOLDS.BUSINESS_END_HOUR}:00 ET, and Sundays flagged).`,
          evidence: { ts: p.ts, speed: p.speed, etHour: hour, lat: p.lat, lng: p.lng },
          dedupeKey: `after_hours:${vn}:${ymd}`,
        });
      }
      for (const [ymd, { p, miles }] of outArea) {
        findings.push({
          type: "out_of_area",
          severity: "warning",
          vehicleId,
          verizonNumber: vn,
          branch,
          title: `${label(v, vn)} — ${Math.round(miles)} mi from nearest branch`,
          detail: `Position ~${Math.round(miles)} mi from the nearest FL branch center (threshold ${GPS_THRESHOLDS.AREA_MILES} mi) on ${ymd}${p.address ? ` near ${p.address}` : ""}.`,
          evidence: { ts: p.ts, lat: p.lat, lng: p.lng, miles: Math.round(miles), thresholdMiles: GPS_THRESHOLDS.AREA_MILES },
          dedupeKey: `out_of_area:${vn}:${ymd}`,
        });
      }

      // --- idle runs (ignition on + near-stationary spanning > IDLE_MIN) ---
      let runStart: PosRow | null = null;
      let runEnd: PosRow | null = null;
      let anchor: PosRow | null = null;
      const closeRun = () => {
        if (runStart && runEnd) {
          const mins = (runEnd.ts.getTime() - runStart.ts.getTime()) / 60000;
          if (mins > GPS_THRESHOLDS.IDLE_MIN) {
            const { ymd } = etInfo(runStart.ts);
            findings.push({
              type: "idle",
              severity: "warning",
              vehicleId,
              verizonNumber: vn,
              branch,
              title: `${label(v, vn)} — idling ${Math.round(mins)} min`,
              detail: `Engine on and stationary for ~${Math.round(mins)} min (threshold ${GPS_THRESHOLDS.IDLE_MIN} min) starting ${runStart.ts.toISOString()}${runStart.address ? ` near ${runStart.address}` : ""}.`,
              evidence: { startTs: runStart.ts, endTs: runEnd.ts, minutes: Math.round(mins), lat: runStart.lat, lng: runStart.lng },
              dedupeKey: `idle:${vn}:${runStart.ts.toISOString()}`,
            });
          }
        }
        runStart = runEnd = anchor = null;
      };
      for (const p of rows) {
        const stationary = p.ignition === true && (p.speed == null || p.speed <= GPS_THRESHOLDS.IDLE_SPEED_MPH);
        if (stationary) {
          if (!runStart || !anchor) {
            runStart = p;
            anchor = p;
            runEnd = p;
          } else if (haversineMiles(anchor.lat, anchor.lng, p.lat, p.lng) <= 0.3) {
            runEnd = p; // same spot — extend the run
          } else {
            closeRun(); // moved to a different spot — new run
            runStart = p;
            anchor = p;
            runEnd = p;
          }
        } else {
          closeRun();
        }
      }
      closeRun();
    }

    // --- offline: linked vehicles with a verizonNumber but no recent real ping ---
    const linked = await prisma.vehicle.findMany({
      where: { status: "active", verizonNumber: { not: null } },
      select: { id: true, name: true, unitNumber: true, branch: true, verizonNumber: true },
    });
    const cutoff = new Date(now.getTime() - GPS_THRESHOLDS.OFFLINE_HOURS * 3600 * 1000);
    const todayYmd = etInfo(now).ymd;
    for (const vh of linked) {
      const vn = vh.verizonNumber!;
      const latest = await prisma.gpsPosition.findFirst({
        where: { verizonNumber: vn, sample: false },
        orderBy: { ts: "desc" },
        select: { ts: true },
      });
      if (!latest || latest.ts < cutoff) {
        const hoursAgo = latest ? Math.round((now.getTime() - latest.ts.getTime()) / 3600000) : null;
        findings.push({
          type: "offline",
          severity: "warning",
          vehicleId: vh.id,
          verizonNumber: vn,
          branch: vh.branch,
          title: `${vh.unitNumber ? `${vh.unitNumber} · ` : ""}${vh.name} — offline`,
          detail: latest
            ? `No GPS report in ~${hoursAgo}h (threshold ${GPS_THRESHOLDS.OFFLINE_HOURS}h). Last seen ${latest.ts.toISOString()}.`
            : `No GPS report on record (threshold ${GPS_THRESHOLDS.OFFLINE_HOURS}h).`,
          evidence: { lastSeen: latest?.ts ?? null, offlineHours: GPS_THRESHOLDS.OFFLINE_HOURS },
          dedupeKey: `offline:${vn}:${todayYmd}`,
        });
      }
    }

    const created = await fileFindings(findings);
    for (const f of findings) byType[f.type] = (byType[f.type] ?? 0) + 1;
    return { ran: true, created, byType, scannedPositions: positions.length };
  } catch (e) {
    console.error("[gps-detect] detection failed:", e instanceof Error ? e.message : e);
    return { ran: false, created: 0, byType, scannedPositions: 0 };
  }
}

/**
 * Upsert findings by dedupeKey. Creates open alerts for new keys, refreshes
 * still-open ones, and NEVER reopens an ack'd/dismissed alert. Returns the
 * number of newly-created alerts.
 */
async function fileFindings(findings: Finding[], aiGenerated = false): Promise<number> {
  let created = 0;
  for (const f of findings) {
    const existing = await prisma.gpsAlert.findUnique({ where: { dedupeKey: f.dedupeKey } });
    const evidence = JSON.stringify(f.evidence).slice(0, 8000);
    if (!existing) {
      await prisma.gpsAlert.create({
        data: {
          type: f.type,
          severity: f.severity,
          vehicleId: f.vehicleId,
          verizonNumber: f.verizonNumber,
          branch: f.branch,
          title: f.title,
          detail: f.detail,
          evidence,
          dedupeKey: f.dedupeKey,
          status: "open",
          aiGenerated,
        },
      });
      created++;
    } else if (existing.status === "open") {
      await prisma.gpsAlert.update({
        where: { id: existing.id },
        data: { title: f.title, detail: f.detail, evidence, severity: f.severity, branch: f.branch, vehicleId: f.vehicleId },
      });
    }
    // ack'd / dismissed → leave untouched (do not reopen for the same key).
  }
  return created;
}

// ---- AI layer (optional, mirrors lib/insights.ts) ----------------------

export function hasGpsInsightsKey(): boolean {
  return !!(process.env.INSIGHTS_ANTHROPIC_API_KEY || process.env.ANTHROPIC_API_KEY);
}

const GPS_SYSTEM_PROMPT =
  "You are the fleet operations analyst for Clements Pest Control, a multi-branch (Vero Beach HQ, Stuart, Orlando, Naples FL) pest-control company. You review a COMPACT summary of GPS fleet activity (miles, idle, after-hours, exception tallies — never raw coordinates). Surface notable patterns and non-obvious operational issues (utilization gaps, recurring exceptions, vehicles that stand out) for a manager dashboard. Be concise and specific. Never invent data not in the summary; if nothing stands out, say the fleet looks normal. This does NOT track chemical usage at customer sites — never infer it.";

type AiOutput = { narrative: string; issues: { vehicle?: string; title: string; detail?: string; severity?: string }[] };

async function callGpsModel(summary: string): Promise<AiOutput> {
  const apiKey = process.env.INSIGHTS_ANTHROPIC_API_KEY || process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("No Anthropic API key configured");
  const model = process.env.ANTHROPIC_MODEL || "claude-opus-4-8";

  const prompt =
    `${summary}\n\n---\n\nReturn ONLY a JSON object of the form ` +
    `{"narrative": "2-4 sentence plain-language summary of notable patterns for a manager dashboard", ` +
    `"issues": [{"vehicle": "unit·name or FLEET", "title": "short issue title", "detail": "why it matters (one sentence)", "severity": "info|warning|critical"}]}. ` +
    `The issues array is for non-obvious problems worth a manager's attention and may be empty. No prose outside the JSON.`;

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({ model, max_tokens: 1200, system: GPS_SYSTEM_PROMPT, messages: [{ role: "user", content: prompt }] }),
  });
  if (!res.ok) throw new Error(`Anthropic API error ${res.status}: ${await res.text()}`);
  const data = (await res.json()) as { content?: { text?: string }[] };
  const text = data.content?.map((c) => c.text ?? "").join("").trim() ?? "";
  const json = text.replace(/^```(?:json)?/i, "").replace(/```$/i, "").trim();
  const parsed = JSON.parse(json) as Partial<AiOutput>;
  return {
    narrative: typeof parsed.narrative === "string" ? parsed.narrative.trim() : "",
    issues: Array.isArray(parsed.issues) ? parsed.issues.filter((i) => i && typeof i.title === "string") : [],
  };
}

function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "issue";
}

/**
 * Run the AI pattern layer: send a COMPACT summary to Claude, file any surfaced
 * issues as `ai_pattern` GpsAlerts (deduped, aiGenerated:true), and return the
 * narrative + count. With no key (or on any failure) returns a deterministic
 * summary and files nothing. Never throws.
 */
export async function aiGpsInsights(now: Date = new Date(), branch?: string): Promise<{ narrative: string; aiGenerated: boolean; issuesFiled: number }> {
  const summaryData = await buildGpsSummary(now, branch);
  if (!hasGpsInsightsKey()) {
    return { narrative: deterministicNarrative(summaryData), aiGenerated: false, issuesFiled: 0 };
  }
  try {
    const out = await callGpsModel(summaryData.text);
    // Map each issue back to a vehicle where we can, and file it.
    const findings: Finding[] = [];
    const ymd = etInfo(now).ymd;
    for (const issue of out.issues) {
      const match = issue.vehicle ? matchSummaryVehicle(issue.vehicle, summaryData.vehicles) : null;
      const sev = ["info", "warning", "critical"].includes(issue.severity ?? "") ? issue.severity! : "info";
      const vnKey = match?.verizonNumber ?? "fleet";
      findings.push({
        type: "ai_pattern",
        severity: sev,
        vehicleId: match?.vehicleId ?? null,
        verizonNumber: match?.verizonNumber ?? "",
        branch: match?.branch ?? branch ?? null,
        title: issue.title,
        detail: issue.detail ?? "",
        evidence: { source: "ai", vehicle: issue.vehicle ?? null },
        dedupeKey: `ai_pattern:${vnKey}:${ymd}:${slug(issue.title)}`,
      });
    }
    const issuesFiled = await fileFindings(findings.map((f) => ({ ...f, verizonNumber: f.verizonNumber || "fleet" })), true);
    return { narrative: out.narrative || deterministicNarrative(summaryData), aiGenerated: true, issuesFiled };
  } catch (e) {
    console.error("[gps-detect] AI layer failed (falling back):", e instanceof Error ? e.message : e);
    return { narrative: deterministicNarrative(summaryData), aiGenerated: false, issuesFiled: 0 };
  }
}

/** Narrative for the dashboard panel: AI when keyed, else deterministic. Never throws. */
export async function gpsNarrative(now: Date = new Date(), branch?: string): Promise<{ text: string; aiGenerated: boolean }> {
  const summaryData = await buildGpsSummary(now, branch);
  if (!hasGpsInsightsKey()) return { text: deterministicNarrative(summaryData), aiGenerated: false };
  try {
    const out = await callGpsModel(summaryData.text);
    return { text: out.narrative || deterministicNarrative(summaryData), aiGenerated: true };
  } catch (e) {
    console.error("[gps-detect] narrative AI failed (falling back):", e instanceof Error ? e.message : e);
    return { text: deterministicNarrative(summaryData), aiGenerated: false };
  }
}

type SummaryVehicle = { verizonNumber: string; vehicleId: string | null; branch: string | null; label: string; unitNumber: string | null; name: string };

function matchSummaryVehicle(needle: string, vehicles: SummaryVehicle[]): SummaryVehicle | null {
  const n = needle.toLowerCase().replace(/[^a-z0-9]/g, "");
  if (!n || n === "fleet") return null;
  return (
    vehicles.find((v) => (v.unitNumber ?? "").toLowerCase().replace(/[^a-z0-9]/g, "") === n) ??
    vehicles.find((v) => v.label.toLowerCase().replace(/[^a-z0-9]/g, "").includes(n) || n.includes(v.name.toLowerCase().replace(/[^a-z0-9]/g, ""))) ??
    null
  );
}

// ---- Compact fleet summary (shared by AI + deterministic fallback) -----

type GpsSummaryData = {
  text: string;
  vehicles: SummaryVehicle[];
  exceptions: Record<string, number>;
  util: GpsUtilization;
};

async function buildGpsSummary(now: Date, branch?: string): Promise<GpsSummaryData> {
  const [util, rollup, exceptions] = await Promise.all([
    gpsUtilization(now, branch),
    gpsVehicleRollup(now, branch),
    gpsExceptionCounts(branch),
  ]);

  const vehicles: SummaryVehicle[] = rollup.map((r) => ({
    verizonNumber: r.verizonNumber,
    vehicleId: r.vehicleId,
    branch: r.branch,
    label: `${r.unitNumber ? `${r.unitNumber} · ` : ""}${r.name}`,
    unitNumber: r.unitNumber,
    name: r.name,
  }));

  const lines: string[] = [];
  lines.push(`GPS FLEET SUMMARY — window ${GPS_THRESHOLDS.WINDOW_DAYS} days, as of ${etInfo(now).ymd} (ET).${branch ? ` Branch: ${branchLabel(branch)}.` : " All branches."}`);
  lines.push(`Utilization today: ${util.activeToday} active vehicle(s), ${util.milesToday} mi, ${util.stopsToday} stop(s), avg trip ${util.avgTripMi} mi. Miles this week: ${util.milesWeek}.`);
  lines.push(`Open exceptions — speeding ${exceptions.speeding ?? 0}, long idle ${exceptions.idle ?? 0}, after-hours ${exceptions.after_hours ?? 0}, offline ${exceptions.offline ?? 0}, out-of-area ${exceptions.out_of_area ?? 0}, AI patterns ${exceptions.ai_pattern ?? 0}.`);
  lines.push("Per vehicle:");
  for (const r of rollup) {
    const seen = r.lastSeen ? `${Math.round((now.getTime() - r.lastSeen.getTime()) / 3600000)}h ago` : "never";
    lines.push(`- ${r.unitNumber ? `${r.unitNumber} · ` : ""}${r.name}${r.branch ? ` (${branchLabel(r.branch)})` : ""}: last seen ${seen}, today ${r.todayMiles} mi, ${r.trips} trip(s), open flags: ${r.openAlertTypes.length ? r.openAlertTypes.join(", ") : "none"}.`);
  }
  if (rollup.length === 0) lines.push("- (no tracked vehicles with data)");

  return { text: lines.join("\n"), vehicles, exceptions, util };
}

function deterministicNarrative(d: GpsSummaryData): string {
  const parts: string[] = [];
  parts.push(
    `Today the fleet logged ${d.util.milesToday} mi across ${d.util.activeToday} active vehicle(s) (${d.util.milesWeek} mi this week, ${d.util.stopsToday} stops, avg trip ${d.util.avgTripMi} mi).`
  );
  const ex = d.exceptions;
  const flagged: string[] = [];
  if (ex.speeding) flagged.push(`${ex.speeding} speeding`);
  if (ex.idle) flagged.push(`${ex.idle} long idle`);
  if (ex.after_hours) flagged.push(`${ex.after_hours} after-hours`);
  if (ex.offline) flagged.push(`${ex.offline} offline`);
  if (ex.out_of_area) flagged.push(`${ex.out_of_area} out-of-area`);
  if (flagged.length) {
    parts.push(`Open exceptions: ${flagged.join(", ")}. Review these in GPS Alerts.`);
  } else {
    parts.push("No open rule-based exceptions — the fleet looks within normal parameters.");
  }
  parts.push("Connect an Anthropic API key to enable AI-written pattern analysis; rule-based detection runs without it.");
  return parts.join(" ");
}

// ---- Analytics read helpers (dashboard) --------------------------------

export type GpsUtilization = {
  activeToday: number;
  milesToday: number;
  milesWeek: number;
  stopsToday: number;
  avgTripMi: number;
  sample: boolean;
};

function startOfUtcDay(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

/** Utilization stats over stored trips/positions (sample-inclusive for display). */
export async function gpsUtilization(now: Date = new Date(), branch?: string): Promise<GpsUtilization> {
  const dayStart = startOfUtcDay(now);
  const weekStart = new Date(now.getTime() - 7 * 864e5);
  const vehWhere = branch ? { vehicle: { branch } } : {};

  const [todayTrips, weekJourneys, positionsToday] = await Promise.all([
    prisma.gpsTrip.findMany({
      where: { startTs: { gte: dayStart }, ...vehWhere },
      select: { kind: true, distanceMi: true, vehicleId: true, sample: true },
    }),
    prisma.gpsTrip.findMany({
      where: { kind: "journey", startTs: { gte: weekStart }, ...vehWhere },
      select: { distanceMi: true },
    }),
    prisma.gpsPosition.findMany({
      where: { ts: { gte: dayStart }, vehicleId: { not: null }, ...vehWhere },
      select: { vehicleId: true, sample: true },
    }),
  ]);

  const journeysToday = todayTrips.filter((t) => t.kind === "journey");
  const milesToday = Math.round(journeysToday.reduce((s, t) => s + (t.distanceMi ?? 0), 0));
  const milesWeek = Math.round(weekJourneys.reduce((s, t) => s + (t.distanceMi ?? 0), 0));
  const stopsToday = todayTrips.filter((t) => t.kind === "stop").length;
  const activeToday = new Set(positionsToday.map((p) => p.vehicleId)).size;
  const avgTripMi = journeysToday.length ? Math.round((milesToday / journeysToday.length) * 10) / 10 : 0;
  const sample = todayTrips.some((t) => t.sample) || positionsToday.some((p) => p.sample);

  return { activeToday, milesToday, milesWeek, stopsToday, avgTripMi, sample };
}

/** Open-alert counts by type (for the exception tiles + nav badge math). */
export async function gpsExceptionCounts(branch?: string): Promise<Record<string, number>> {
  const rows = await prisma.gpsAlert.groupBy({
    by: ["type"],
    where: { status: "open", ...(branch ? { branch } : {}) },
    _count: { _all: true },
  });
  const out: Record<string, number> = {};
  for (const r of rows) out[r.type] = r._count._all;
  return out;
}

export type VehicleRollup = {
  vehicleId: string | null;
  verizonNumber: string;
  name: string;
  unitNumber: string | null;
  branch: string | null;
  lastSeen: Date | null;
  todayMiles: number;
  trips: number;
  openAlertTypes: string[];
};

/** Per-vehicle rollup: last seen, today's miles/trips, and open GPS-alert flags. */
export async function gpsVehicleRollup(now: Date = new Date(), branch?: string): Promise<VehicleRollup[]> {
  const dayStart = startOfUtcDay(now);
  const vehWhere = branch ? { branch } : {};

  const vehicles = await prisma.vehicle.findMany({
    where: { status: "active", ...vehWhere, gpsPositions: { some: {} } },
    select: { id: true, name: true, unitNumber: true, branch: true, verizonNumber: true },
    orderBy: { name: "asc" },
  });

  const rollup: VehicleRollup[] = [];
  for (const v of vehicles) {
    const [latest, trips, openAlerts] = await Promise.all([
      prisma.gpsPosition.findFirst({ where: { vehicleId: v.id }, orderBy: { ts: "desc" }, select: { ts: true, verizonNumber: true } }),
      prisma.gpsTrip.findMany({ where: { vehicleId: v.id, startTs: { gte: dayStart } }, select: { kind: true, distanceMi: true } }),
      prisma.gpsAlert.findMany({ where: { vehicleId: v.id, status: "open" }, select: { type: true }, distinct: ["type"] }),
    ]);
    const todayMiles = Math.round(trips.filter((t) => t.kind === "journey").reduce((s, t) => s + (t.distanceMi ?? 0), 0));
    rollup.push({
      vehicleId: v.id,
      verizonNumber: v.verizonNumber ?? latest?.verizonNumber ?? "",
      name: v.name,
      unitNumber: v.unitNumber,
      branch: v.branch,
      lastSeen: latest?.ts ?? null,
      todayMiles,
      trips: trips.length,
      openAlertTypes: openAlerts.map((a) => a.type),
    });
  }
  return rollup;
}

// ---- Alert list + lifecycle (GPS Alerts section) -----------------------

export const GPS_ALERT_TYPES = ["speeding", "idle", "after_hours", "offline", "out_of_area", "ai_pattern"] as const;

export const GPS_ALERT_TYPE_META: Record<string, { label: string; chip: string }> = {
  speeding: { label: "Speeding", chip: "bg-red-100 text-red-700" },
  idle: { label: "Long idle", chip: "bg-amber-100 text-amber-700" },
  after_hours: { label: "After-hours", chip: "bg-indigo-100 text-indigo-700" },
  offline: { label: "Offline", chip: "bg-slate-200 text-slate-600" },
  out_of_area: { label: "Out of area", chip: "bg-orange-100 text-orange-700" },
  ai_pattern: { label: "AI pattern", chip: "bg-emerald-100 text-emerald-700" },
};

export type GpsAlertRow = {
  id: string;
  type: string;
  severity: string;
  vehicleId: string | null;
  verizonNumber: string | null;
  branch: string | null;
  title: string;
  detail: string | null;
  evidence: string | null;
  status: string;
  aiGenerated: boolean;
  acknowledgedBy: string | null;
  resolvedAt: Date | null;
  createdAt: Date;
  vehicle: { id: string; name: string; unitNumber: string | null } | null;
};

export async function listGpsAlerts(opts: {
  status?: "open" | "ack" | "dismissed" | "cleared" | "all";
  branch?: string;
  type?: string;
  severity?: string;
} = {}): Promise<GpsAlertRow[]> {
  const status = opts.status ?? "open";
  const where: Record<string, unknown> = {};
  if (status === "cleared") where.status = { in: ["ack", "dismissed"] };
  else if (status !== "all") where.status = status;
  if (opts.branch) where.branch = opts.branch;
  if (opts.type) where.type = opts.type;
  if (opts.severity) where.severity = opts.severity;

  return prisma.gpsAlert.findMany({
    where,
    orderBy: [{ createdAt: "desc" }],
    include: { vehicle: { select: { id: true, name: true, unitNumber: true } } },
  }) as unknown as Promise<GpsAlertRow[]>;
}

/** Count of OPEN GPS alerts (optionally branch-scoped) — powers the nav badge. */
export async function openGpsAlertCount(branch?: string): Promise<number> {
  return prisma.gpsAlert.count({ where: { status: "open", ...(branch ? { branch } : {}) } });
}

/** Acknowledge or dismiss an alert. Never hard-deletes — flips status + records who/when. */
export async function setGpsAlertStatus(id: string, action: "ack" | "dismiss", userName: string): Promise<boolean> {
  const alert = await prisma.gpsAlert.findUnique({ where: { id }, select: { id: true } });
  if (!alert) return false;
  await prisma.gpsAlert.update({
    where: { id },
    data: {
      status: action === "ack" ? "ack" : "dismissed",
      acknowledgedBy: userName,
      resolvedAt: new Date(),
    },
  });
  return true;
}
