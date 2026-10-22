import { Card } from "@/components/ui";

// Corporate role / "who to go to" reference, shown on an employee profile and
// mirrored (in brief) on their org-chart card. Seeded from the Corporate Contact
// & Reference Sheet; editable by any non-technician staff member on the org chart.
// Pure presentation — all fields nullable; renders nothing useful-less state via
// the caller's guard. Bullet fields are newline-separated.

function toBullets(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((s) => s.replace(/^\s*[-•·*]\s*/, "").trim())
    .filter(Boolean);
}

function Bullets({ text }: { text: string }) {
  const items = toBullets(text);
  if (items.length <= 1) return <p className="text-sm text-ink whitespace-pre-line">{items[0] ?? text}</p>;
  return (
    <ul className="list-disc space-y-1 pl-5 text-sm text-ink">
      {items.map((b, i) => <li key={i}>{b}</li>)}
    </ul>
  );
}

export default function RoleReferenceCard({
  roleResponsibilities,
  contactReasons,
  contactGuidance,
  editHref,
}: {
  roleResponsibilities: string | null;
  contactReasons: string | null;
  contactGuidance: string | null;
  editHref?: string | null;
}) {
  const has = !!roleResponsibilities || !!contactReasons || !!contactGuidance;
  if (!has) return null;

  return (
    <Card className="p-4 mb-5">
      <div className="flex items-center justify-between gap-2 mb-3">
        <div className="text-sm font-medium text-ink">Role &amp; responsibilities</div>
        {editHref ? (
          <a href={editHref} className="text-xs font-medium text-brand-700 hover:underline">Edit on org chart →</a>
        ) : null}
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        {roleResponsibilities ? (
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-wide text-muted">What they do</div>
            <div className="mt-1"><Bullets text={roleResponsibilities} /></div>
          </div>
        ) : null}
        {contactReasons ? (
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-wide text-muted">When to go to them for help</div>
            <div className="mt-1"><Bullets text={contactReasons} /></div>
          </div>
        ) : null}
      </div>
      {contactGuidance ? (
        <div className="mt-3 inline-flex items-start gap-2 rounded-lg bg-brand-50 px-3 py-2 text-sm text-brand-800">
          <svg viewBox="0 0 24 24" className="mt-0.5 h-4 w-4 shrink-0" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M4 4h4l2 5-2.5 1.5a11 11 0 006 6L15 14l5 2v4a1 1 0 01-1 1A16 16 0 013 5a1 1 0 011-1z" /></svg>
          <span><span className="font-semibold">How to reach:</span> {contactGuidance}</span>
        </div>
      ) : null}
    </Card>
  );
}
