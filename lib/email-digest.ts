import { prisma } from "@/lib/prisma";
import { sendEmail } from "@/lib/email";

// ---------------------------------------------------------------------------
// Daily digest collector + composer.
//
// Instead of one email PER ITEM PER DAY per recipient (a storm), each reminder
// source CONTRIBUTES items to a shared per-recipient bucket, and a single
// composer sends ONE "Your CanopyOS daily summary" email per recipient listing
// their pending items grouped by section. The in-app Alert rows are untouched —
// Alerts stay the primary channel; email becomes the once-daily digest.
//
// Cadence is TAPERED (see `dueForDigest`): an item is not repeated every day.
// A row's `lastReminderAt` is stamped ONLY when its item actually ships in a
// dispatched digest, so the taper measures real reminders sent.
// ---------------------------------------------------------------------------

export const DIGEST_SECTIONS = [
  "Training",
  "Reviews to sign",
  "Signatures",
  "Vehicle documents",
  "Reminders",
] as const;
export type DigestSection = (typeof DIGEST_SECTIONS)[number];

export type DigestItem = {
  /** Who this line belongs to. Normalized (trimmed + lowercased) on add. */
  recipientEmail: string;
  section: DigestSection;
  /** Plain one-line description of the pending item. */
  line: string;
  /** Absolute link to act on the item (optional). */
  link?: string | null;
  /**
   * Identifies the DB row this item reminds about, so `lastReminderAt` is
   * stamped exactly once per row even when two recipients share it (e.g. a
   * review that reminds both reviewer and employee). Omit (with `stamp`) for
   * one-shot items that carry no taper state (e.g. a review just created).
   */
  stampKey?: string | null;
  /** Stamps the row's `lastReminderAt`. Runs only if the item shipped. */
  stamp?: (() => Promise<void>) | null;
};

const DAY = 864e5;

/**
 * Taper gate. Include an item in today's digest when:
 *   - it has never been reminded, OR
 *   - age < 14 days AND >= 3 days since the last reminder, OR
 *   - age >= 14 days AND >= 7 days since the last reminder.
 *
 * `ageAnchor` is the best age proxy available for the row (sentAt / createdAt /
 * dueDate). A fresher item taps the recipient every 3 days; an aged one tapers
 * to weekly.
 */
export function dueForDigest(
  now: Date,
  lastReminderAt: Date | null | undefined,
  ageAnchor: Date | null | undefined,
): boolean {
  if (!lastReminderAt) return true;
  const ageDays = ageAnchor ? (now.getTime() - ageAnchor.getTime()) / DAY : 0;
  const sinceLastDays = (now.getTime() - lastReminderAt.getTime()) / DAY;
  const minGap = ageDays >= 14 ? 7 : 3;
  return sinceLastDays >= minGap;
}

/** Accumulates per-recipient digest items across every reminder source. */
export class DigestCollector {
  private items: DigestItem[] = [];
  /** The single "now" every source shares (for consistent taper + stamps). */
  readonly now: Date;

  constructor(now: Date = new Date()) {
    this.now = now;
  }

  add(item: DigestItem): void {
    const to = (item.recipientEmail ?? "").trim().toLowerCase();
    if (!to) return; // never queue a line we can't deliver
    this.items.push({ ...item, recipientEmail: to });
  }

  all(): DigestItem[] {
    return this.items;
  }

  get size(): number {
    return this.items.length;
  }
}

const sectionRank = new Map<DigestSection, number>(DIGEST_SECTIONS.map((s, i) => [s, i]));

/** Build the text + HTML body for one recipient's grouped items. */
function composeDigest(list: DigestItem[]): { text: string; html: string } {
  const bySection = new Map<DigestSection, DigestItem[]>();
  for (const it of list) {
    const arr = bySection.get(it.section) ?? [];
    arr.push(it);
    bySection.set(it.section, arr);
  }
  const sections = [...bySection.keys()].sort(
    (a, b) => (sectionRank.get(a) ?? 0) - (sectionRank.get(b) ?? 0),
  );

  const textParts: string[] = ["Here's your daily summary of items that still need your attention.", ""];
  const htmlParts: string[] = [
    `<p>Here's your daily summary of items that still need your attention.</p>`,
  ];

  for (const section of sections) {
    const rows = bySection.get(section) ?? [];
    textParts.push(`${section}:`);
    for (const r of rows) textParts.push(`  - ${r.line}${r.link ? ` (${r.link})` : ""}`);
    textParts.push("");
    htmlParts.push(`<h3 style="margin:18px 0 6px;font-weight:600">${section}</h3>`);
    htmlParts.push(
      `<ul>${rows
        .map((r) => `<li>${r.link ? `<a href="${r.link}">${r.line}</a>` : r.line}</li>`)
        .join("")}</ul>`,
    );
  }

  textParts.push("These items also appear as alerts in CanopyOS.", "", "— CanopyOS");
  htmlParts.push(
    `<p style="color:#5b7a70;font-size:13px">These items also appear as alerts in CanopyOS.</p>`,
    `<p>— CanopyOS</p>`,
  );

  return { text: textParts.join("\n"), html: htmlParts.join("") };
}

/**
 * Compose + send ONE digest per recipient, then stamp `lastReminderAt` for every
 * taper-tracked row that shipped (deduped by `stampKey`). Stamping follows the
 * prior always-stamp behavior (independent of the provider result) so the taper
 * still advances while email is off — the point being to redesign what WILL fire
 * once a provider is enabled.
 */
export async function sendDigests(
  collector: DigestCollector,
): Promise<{ recipients: number; items: number; emailed: number }> {
  const items = collector.all();
  if (items.length === 0) return { recipients: 0, items: 0, emailed: 0 };

  const byRecipient = new Map<string, DigestItem[]>();
  for (const it of items) {
    const arr = byRecipient.get(it.recipientEmail) ?? [];
    arr.push(it);
    byRecipient.set(it.recipientEmail, arr);
  }

  let emailed = 0;
  for (const [recipient, list] of byRecipient) {
    const { text, html } = composeDigest(list);
    const res = await sendEmail({
      to: recipient,
      subject: "Your CanopyOS daily summary",
      kind: "daily_digest",
      relatedType: "digest",
      text,
      html,
    });
    if (res.status === "sent") emailed++;
  }

  // Stamp once per row that was part of a dispatched digest.
  const stamped = new Set<string>();
  for (const it of items) {
    if (!it.stampKey || !it.stamp || stamped.has(it.stampKey)) continue;
    stamped.add(it.stampKey);
    await it.stamp().catch(() => {});
  }

  return { recipients: byRecipient.size, items: items.length, emailed };
}
