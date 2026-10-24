import "server-only";
import { prisma } from "@/lib/prisma";
import { sendEmail } from "@/lib/email";
import { appUrl } from "@/lib/app-url";
import { branchLabel } from "@/lib/management";
import { criticalFailures, inspectionPhotoLabel, parseJson, type Checks } from "@/lib/inspection";

// Rebuilds a filed inspection's report email from the stored row and sends a copy
// to the given recipients. Used by the "Resend report" action (and reusable by any
// future re-notify path). Content mirrors the original send: score line, items to
// correct, the four photos, and a link to the in-app report. De-dupes recipients
// (case-insensitive) and skips blanks; returns a per-address status map.
export async function resendInspectionReport(opts: {
  inspectionId: string;
  recipients: (string | null | undefined)[];
  reqUrl?: string;
}): Promise<{ ok: boolean; error?: string; statuses?: Record<string, string> }> {
  const insp = await prisma.vehicleInspection.findUnique({
    where: { id: opts.inspectionId },
    include: { photos: true, vehicle: true },
  });
  if (!insp) return { ok: false, error: "Inspection not found." };

  const to = [...new Set(opts.recipients.map((r) => (r ?? "").trim()).filter(Boolean).map((r) => r.toLowerCase()))];
  if (!to.length) return { ok: false, error: "No recipient email addresses available." };

  const vlabel = insp.vehicle
    ? [insp.vehicle.name, [insp.vehicle.make, insp.vehicle.model].filter(Boolean).join(" ")].filter(Boolean).join(" · ") ||
      insp.vehicle.name ||
      "Vehicle"
    : "Vehicle";
  const branch = insp.branch ? branchLabel(insp.branch) : null;
  const monthName = new Date(insp.year, insp.month - 1, 1).toLocaleString("en-US", { month: "long" });
  const checks = parseJson<Checks>(insp.checks, {});
  const fails = criticalFailures(checks);

  const origin =
    appUrl() ||
    (() => {
      try {
        return opts.reqUrl ? new URL(opts.reqUrl).origin : "";
      } catch {
        return "";
      }
    })();
  const abs = (u: string) => (/^https?:\/\//i.test(u) ? u : `${origin}${u.startsWith("/") ? "" : "/"}${u}`);
  const reportUrl = origin
    ? `${origin}/fleet/${insp.vehicleId}/inspect?view=report&year=${insp.year}&month=${insp.month}`
    : "";

  const photosHtml = insp.photos.length
    ? `<p style="margin-top:16px;font-weight:600">Inspection photos</p><table role="presentation" cellpadding="0" cellspacing="8"><tr>${insp.photos
        .map(
          (p) =>
            `<td style="text-align:center;font-size:11px;color:#475569"><a href="${abs(p.photoUrl)}"><img src="${abs(
              p.photoUrl,
            )}" alt="${inspectionPhotoLabel(p.kind)}" width="120" style="width:120px;height:90px;object-fit:cover;border:1px solid #e2e8f0;border-radius:6px;display:block" /></a><div style="margin-top:4px;max-width:120px">${inspectionPhotoLabel(
              p.kind,
            )}</div></td>`,
        )
        .join("")}</tr></table>`
    : "";
  const photosText = insp.photos.length
    ? `\nPhotos:\n${insp.photos.map((p) => `- ${inspectionPhotoLabel(p.kind)}: ${abs(p.photoUrl)}`).join("\n")}\n`
    : "";
  const failsHtml = fails.length
    ? `<p style="color:#b91c1c">Items to correct: ${fails.map((f) => f.label).join("; ")}.</p>`
    : "";
  const failsText = fails.length ? `\nItems to correct: ${fails.map((f) => f.label).join("; ")}.\n` : "";
  const reportHtml = reportUrl ? `<p><a href="${reportUrl}">View the full report</a></p>` : "";
  const reportText = reportUrl ? `\nFull report: ${reportUrl}\n` : "";
  const scoreLine = `Score: ${insp.score}/${insp.maxScore} (${insp.scorePct}%) — Grade ${insp.grade}`;
  const driver = insp.technicianName ? ` (driver: ${insp.technicianName})` : "";

  const statuses: Record<string, string> = {};
  for (const addr of to) {
    const r = await sendEmail({
      to: addr,
      subject: `Inspection report — ${vlabel} — ${monthName} ${insp.year} (grade ${insp.grade}, ${insp.scorePct}%)`,
      kind: "inspection_score_resend",
      relatedType: "vehicle_inspection",
      relatedId: insp.id,
      text: `${monthName} ${insp.year} vehicle inspection for ${vlabel}${driver}${branch ? `, ${branch}` : ""}.\n\n${scoreLine}.${failsText}${photosText}${reportText}\n— CanopyOS`,
      html: `<p>${monthName} ${insp.year} vehicle inspection for <strong>${vlabel}</strong>${driver}${branch ? `, ${branch}` : ""}.</p><p style="font-size:18px"><strong>${scoreLine}</strong></p>${failsHtml}${photosHtml}${reportHtml}<p>— CanopyOS</p>`,
    });
    statuses[addr] = r.status + (r.error ? `: ${r.error}` : "");
  }

  const anySent = Object.values(statuses).some((s) => s.startsWith("sent"));
  return { ok: anySent, statuses, error: anySent ? undefined : "No messages were sent — see statuses." };
}
