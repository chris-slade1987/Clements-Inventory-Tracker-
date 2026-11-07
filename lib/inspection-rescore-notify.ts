import "server-only";
import { prisma } from "@/lib/prisma";
import { sendEmail } from "@/lib/email";
import { appUrl } from "@/lib/app-url";
import { BRANCHES, branchLabel } from "@/lib/management";
import { branchManagerEmail } from "@/lib/scorecard";
import { matchEmployeeByName } from "@/lib/people";
import { CONDITION_ITEMS, CHECK_ITEMS, MAX_SCORE, gradeLetter, scoreInspection, parseJson, type Ratings, type Checks } from "@/lib/inspection";

// One-time notices for the Nov-2026 vehicle-inspection scoring revision (Meets =
// full points; see conditionPoints in lib/inspection.ts + the rescore healer in
// lib/inspection-rescore.ts). The old score is reconstructed exactly from each
// row's stored raw ratings under the OLD rule (points = the rating value 1-3), so
// this works no matter when the rescore healer ran.
//
// Recipients: every technician with a re-scored inspection (one email listing
// their before -> after grades + the methodology change) and every branch manager
// (one email listing their branch's re-scored inspections + the methodology).
// Triggered by a super admin from Vehicle Inspections (preview first, then send).
// Idempotent: a recipient who already has a SENT notice (EmailLog) is skipped, so
// re-pressing Send only retries the ones that failed or had no address.

export const TECH_KIND = "inspection_rescore_tech";
export const MANAGER_KIND = "inspection_rescore_manager";

type Score = { score: number; pct: number; grade: string };

/** The score a row earned under the pre-Nov-2026 rule (rating value = points). */
function oldRuleScore(ratings: Ratings, checks: Checks): Score {
  let score = 0;
  for (const it of CONDITION_ITEMS) {
    const r = Number(ratings[it.key]);
    if (r >= 1 && r <= 3) score += r;
  }
  for (const it of CHECK_ITEMS) if (checks[it.key]) score += 1;
  const pct = Math.round((score / MAX_SCORE) * 1000) / 10;
  return { score, pct, grade: gradeLetter(pct) };
}

export type RescoredItem = {
  inspectionId: string;
  vehicleId: string;
  vehicleLabel: string;
  branch: string | null;
  year: number;
  month: number;
  technicianName: string;
  employeeId: string | null;
  before: Score;
  after: Score;
};

export type NoticePlan = {
  items: RescoredItem[];
  techs: { key: string; employeeId: string | null; name: string; email: string | null; items: RescoredItem[]; alreadySent: boolean }[];
  managers: { branch: string; name: string | null; email: string | null; items: RescoredItem[]; alreadySent: boolean }[];
};

const monthName = (y: number, m: number) => new Date(y, m - 1, 1).toLocaleString("en-US", { month: "long", year: "numeric" });
const scoreStr = (s: Score) => `${s.score}/${MAX_SCORE} (${s.pct}%, ${s.grade})`;

/** Every inspection whose score changed under the revision, grouped by recipient. */
export async function planRescoreNotices(): Promise<NoticePlan> {
  const rows = await prisma.vehicleInspection.findMany({
    include: { vehicle: { select: { unitNumber: true, name: true } } },
    orderBy: [{ branch: "asc" }, { year: "asc" }, { month: "asc" }],
  });
  const employees = await prisma.employee.findMany({
    select: { id: true, name: true, role: true, division: true, branch: true, nickname: true, email: true, user: { select: { email: true } } },
  });
  const empById = new Map(employees.map((e) => [e.id, e]));
  const roster = employees.map((e) => ({ id: e.id, name: e.name, role: e.role, division: e.division, branch: e.branch, nickname: e.nickname }));

  const items: RescoredItem[] = [];
  for (const r of rows) {
    const ratings = parseJson<Ratings>(r.ratings, {});
    const checks = parseJson<Checks>(r.checks, {});
    const before = oldRuleScore(ratings, checks);
    const n = scoreInspection(ratings, checks);
    if (before.score === n.score) continue;
    const employeeId = r.employeeId ?? matchEmployeeByName(r.technicianName, roster);
    items.push({
      inspectionId: r.id,
      vehicleId: r.vehicleId,
      vehicleLabel: `${r.vehicle?.unitNumber ? `#${r.vehicle.unitNumber} ` : ""}${r.vehicle?.name ?? "Vehicle"}`,
      branch: r.branch,
      year: r.year,
      month: r.month,
      technicianName: (employeeId ? empById.get(employeeId)?.name : null) ?? r.technicianName ?? "Technician",
      employeeId,
      before,
      after: { score: n.score, pct: n.scorePct, grade: n.grade },
    });
  }

  const sentLogs = await prisma.emailLog.findMany({
    where: { kind: { in: [TECH_KIND, MANAGER_KIND] }, status: "sent" },
    select: { kind: true, relatedId: true },
  });
  const sent = new Set(sentLogs.map((l) => `${l.kind}:${l.relatedId}`));

  // Technicians — one notice per person (keyed by employee, else by name).
  const techMap = new Map<string, NoticePlan["techs"][number]>();
  for (const it of items) {
    const key = it.employeeId ?? `name:${it.technicianName.toLowerCase()}`;
    let t = techMap.get(key);
    if (!t) {
      const e = it.employeeId ? empById.get(it.employeeId) : null;
      t = { key, employeeId: it.employeeId, name: it.technicianName, email: e?.email || e?.user?.email || null, items: [], alreadySent: sent.has(`${TECH_KIND}:${key}`) };
      techMap.set(key, t);
    }
    t.items.push(it);
  }

  // Managers — every branch manager hears about the change; their list is their branch.
  const managers: NoticePlan["managers"] = [];
  for (const b of BRANCHES) {
    const m = await branchManagerEmail(b.key).catch(() => ({ email: null, name: null, employeeId: null }));
    managers.push({ branch: b.key, name: m.name, email: m.email, items: items.filter((i) => i.branch === b.key), alreadySent: sent.has(`${MANAGER_KIND}:${b.key}`) });
  }

  return { items, techs: [...techMap.values()].sort((a, b) => a.name.localeCompare(b.name)), managers };
}

// ── Email copy ──────────────────────────────────────────────────────────────

const METHOD_TEXT =
  `What changed: Section A of the monthly vehicle inspection rates four areas — outside appearance, inside appearance, toolbox, and truck bed — as Exceeds, Meets, or Below standards. ` +
  `Before, Exceeds earned 3 points, Meets earned 2, and Below earned 1, so a truck that met every standard could only reach a B. ` +
  `We revised it so that meeting the standard earns full credit: Meets and Exceeds now both earn 3 points, and only Below standards loses points (1). ` +
  `Section C compliance checks are unchanged (1 point each, 8 total). Scores are still out of 20, and 90% or higher is an A. ` +
  `The ratings recorded on the inspection did not change — only how they are scored.`;

const METHOD_HTML =
  `<p style="margin:16px 0 4px;font-weight:600">What changed</p>` +
  `<p style="margin:0 0 8px">Section A of the monthly vehicle inspection rates four areas — outside appearance, inside appearance, toolbox, and truck bed — as <strong>Exceeds</strong>, <strong>Meets</strong>, or <strong>Below standards</strong>. Before, Exceeds earned 3 points, Meets earned 2, and Below earned 1, so a truck that met every standard could only reach a B.</p>` +
  `<p style="margin:0 0 8px">We revised it so that <strong>meeting the standard earns full credit</strong>: Meets and Exceeds now both earn 3 points, and only Below standards loses points (1 point). Section C compliance checks are unchanged (1 point each, 8 total). Scores are still out of 20, and 90% or higher is an A.</p>` +
  `<p style="margin:0 0 8px;color:#5b7a70">The ratings recorded on the inspection did not change — only how they are scored.</p>`;

const cell = "padding:6px 10px;border-bottom:1px solid #e2e8f0;font-size:13px";
const head = "padding:6px 10px;border-bottom:2px solid #cbd5e1;font-size:11px;text-transform:uppercase;letter-spacing:.04em;color:#64748b;text-align:left";

function reportUrl(it: RescoredItem) {
  const base = appUrl().replace(/\/$/, "");
  return base ? `${base}/fleet/${it.vehicleId}/inspect?view=report&year=${it.year}&month=${it.month}` : "";
}

export function techEmail(t: NoticePlan["techs"][number]) {
  const first = t.name.split(" ")[0];
  const lines = t.items.map((it) => `- ${monthName(it.year, it.month)} · ${it.vehicleLabel}: ${scoreStr(it.before)} -> ${scoreStr(it.after)}${reportUrl(it) ? `\n  Report: ${reportUrl(it)}` : ""}`).join("\n");
  const rowsHtml = t.items
    .map((it) => `<tr><td style="${cell}">${monthName(it.year, it.month)}</td><td style="${cell}">${it.vehicleLabel}</td><td style="${cell};color:#64748b">${scoreStr(it.before)}</td><td style="${cell};font-weight:600;color:#047857">${scoreStr(it.after)}</td></tr>`)
    .join("");
  const one = t.items.length === 1;
  return {
    subject: `Updated vehicle inspection grade${one ? "" : "s"} — scoring revised`,
    text: `Hi ${first},\n\nWe revised how monthly vehicle inspections are scored, and your inspection${one ? " was" : "s were"} re-scored under the new method. Here is your updated grade:\n\n${lines}\n\n${METHOD_TEXT}\n\nYour updated grade is the one on your personnel profile and the one that counts toward your reviews. No action is needed.\n\n— CanopyOS`,
    html: `<p>Hi ${first},</p><p>We revised how monthly vehicle inspections are scored, and your inspection${one ? " was" : "s were"} re-scored under the new method. Here is your updated grade:</p><table role="presentation" cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin:8px 0"><tr><th style="${head}">Month</th><th style="${head}">Vehicle</th><th style="${head}">Before</th><th style="${head}">Now</th></tr>${rowsHtml}</table>${t.items.map((it) => (reportUrl(it) ? `<p style="margin:2px 0;font-size:13px"><a href="${reportUrl(it)}">View the ${monthName(it.year, it.month)} report — ${it.vehicleLabel}</a></p>` : "")).join("")}${METHOD_HTML}<p>Your updated grade is the one on your personnel profile and the one that counts toward your reviews. No action is needed.</p><p>— CanopyOS</p>`,
  };
}

export function managerEmail(m: NoticePlan["managers"][number]) {
  const first = (m.name ?? "").split(" ")[0] || "there";
  const b = branchLabel(m.branch);
  const n = m.items.length;
  const lines = m.items.map((it) => `- ${it.technicianName} · ${it.vehicleLabel} (${monthName(it.year, it.month)}): ${scoreStr(it.before)} -> ${scoreStr(it.after)}`).join("\n");
  const rowsHtml = m.items
    .map((it) => `<tr><td style="${cell}">${it.technicianName}</td><td style="${cell}">${it.vehicleLabel}</td><td style="${cell}">${monthName(it.year, it.month)}</td><td style="${cell};color:#64748b">${scoreStr(it.before)}</td><td style="${cell};font-weight:600;color:#047857">${scoreStr(it.after)}</td></tr>`)
    .join("");
  const summary = n
    ? `${n} ${b} inspection${n === 1 ? " was" : "s were"} re-scored, and each technician has been emailed their updated grade.`
    : `None of ${b}'s inspections changed under the new method, but we wanted you to know how scoring works going forward.`;
  const link = `${appUrl().replace(/\/$/, "")}/my-branch/inspections?branch=${m.branch}`;
  return {
    subject: `Vehicle inspection scoring revised — ${b}`,
    text: `Hi ${first},\n\nWe revised how monthly vehicle inspections are scored. ${summary}\n${lines ? `\n${lines}\n` : ""}\n${METHOD_TEXT}\n\nThe technician grades on Vehicle Inspections and the quarterly scorecard now use the updated scores. Nothing changes in how you complete an inspection — keep rating each area exactly as you see it.\n\n${link}\n\n— CanopyOS`,
    html: `<p>Hi ${first},</p><p>We revised how monthly vehicle inspections are scored. ${summary}</p>${rowsHtml ? `<table role="presentation" cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin:8px 0"><tr><th style="${head}">Technician</th><th style="${head}">Vehicle</th><th style="${head}">Month</th><th style="${head}">Before</th><th style="${head}">Now</th></tr>${rowsHtml}</table>` : ""}${METHOD_HTML}<p>The technician grades on Vehicle Inspections and the quarterly scorecard now use the updated scores. Nothing changes in how you complete an inspection — keep rating each area exactly as you see it.</p><p><a href="${link}">Open Vehicle Inspections →</a></p><p>— CanopyOS</p>`,
  };
}

/** Send every notice not already sent. Returns per-recipient outcomes. */
export async function sendRescoreNotices() {
  const plan = await planRescoreNotices();
  const results: { who: string; email: string | null; kind: "technician" | "manager"; status: string }[] = [];
  for (const t of plan.techs) {
    if (t.alreadySent) { results.push({ who: t.name, email: t.email, kind: "technician", status: "already_sent" }); continue; }
    const e = techEmail(t);
    const r = await sendEmail({ to: t.email, subject: e.subject, text: e.text, html: e.html, kind: TECH_KIND, relatedType: "employee", relatedId: t.key }).catch(() => null);
    results.push({ who: t.name, email: t.email, kind: "technician", status: r?.status ?? "error" });
  }
  for (const m of plan.managers) {
    if (m.alreadySent) { results.push({ who: m.name ?? branchLabel(m.branch), email: m.email, kind: "manager", status: "already_sent" }); continue; }
    const e = managerEmail(m);
    const r = await sendEmail({ to: m.email, subject: e.subject, text: e.text, html: e.html, kind: MANAGER_KIND, relatedType: "branch", relatedId: m.branch }).catch(() => null);
    results.push({ who: `${m.name ?? "No manager on file"} (${branchLabel(m.branch)})`, email: m.email, kind: "manager", status: r?.status ?? "error" });
  }
  return results;
}
