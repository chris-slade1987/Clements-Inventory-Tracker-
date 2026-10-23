import Link from "next/link";
import { Card } from "@/components/ui";
import {
  CONDITION_ITEMS,
  RATING_SCALE,
  CHECK_ITEMS,
  INSPECTION_PHOTO_KINDS,
  parseJson,
} from "@/lib/inspection";

// Read-only, printable view of a completed monthly vehicle inspection — the "filed
// report" you click into from the inspections list (editing stays on the form).
type InspectionWithPhotos = {
  id: string;
  date: Date;
  technicianName: string | null;
  inspectorName: string | null;
  mileage: number | null;
  ratings: string;
  ratingIssues: string;
  checks: string;
  oilChangeNextMileage: number | null;
  oilChangeNext: Date | null;
  notes: string | null;
  score: number;
  maxScore: number;
  scorePct: number;
  grade: string;
  photos: { kind: string; photoUrl: string }[];
};

const gradeChip = (grade: string) => {
  const c = grade === "A" || grade === "B" ? "bg-emerald-100 text-emerald-700" : grade === "C" ? "bg-amber-100 text-amber-700" : "bg-red-100 text-red-700";
  return `inline-grid h-9 w-9 place-items-center rounded-full text-base font-bold ${c}`;
};

export default function InspectionReport({
  vehicleId,
  vlabel,
  branchName,
  periodLabel,
  canEdit,
  inspection: i,
}: {
  vehicleId: string;
  vlabel: string;
  branchName: string | null;
  periodLabel: string;
  canEdit: boolean;
  inspection: InspectionWithPhotos;
}) {
  const ratings = parseJson<Record<string, number>>(i.ratings, {});
  const issues = parseJson<Record<string, string>>(i.ratingIssues, {});
  const checks = parseJson<Record<string, boolean>>(i.checks, {});
  const ratingLabel = (v: number) => RATING_SCALE.find((r) => r.value === v)?.short ?? "—";
  const photoByKind = new Map(i.photos.map((p) => [p.kind, p.photoUrl]));
  const oilMonth = i.oilChangeNext ? i.oilChangeNext.toLocaleString("en-US", { month: "long", year: "numeric" }) : null;

  const Row = ({ label, value }: { label: string; value: React.ReactNode }) => (
    <div className="flex justify-between gap-4 py-1 text-sm">
      <span className="text-muted">{label}</span>
      <span className="text-ink text-right">{value}</span>
    </div>
  );

  return (
    <Card className="p-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="text-sm font-medium text-ink">{vlabel}</div>
          <div className="text-xs text-muted">{[branchName, periodLabel].filter(Boolean).join(" · ")}</div>
        </div>
        <div className="flex items-center gap-2">
          <span className={gradeChip(i.grade)}>{i.grade}</span>
          <span className="text-sm tabular-nums text-ink">{i.score}/{i.maxScore} · {i.scorePct}%</span>
        </div>
      </div>

      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <div>
          <Row label="Date" value={i.date.toLocaleDateString("en-US")} />
          <Row label="Driver graded" value={i.technicianName ?? "—"} />
          <Row label="Inspector" value={i.inspectorName ?? "—"} />
          <Row label="Mileage" value={i.mileage != null ? i.mileage.toLocaleString() : "—"} />
          <Row label="Next oil — mileage" value={i.oilChangeNextMileage != null ? i.oilChangeNextMileage.toLocaleString() : "—"} />
          <Row label="Next oil — month" value={oilMonth ?? "—"} />
        </div>
        <div>
          <div className="text-xs font-semibold uppercase tracking-wide text-muted">Condition</div>
          {CONDITION_ITEMS.map((it) => (
            <div key={it.key} className="py-1 text-sm">
              <div className="flex justify-between gap-4">
                <span className="text-muted">{it.label}</span>
                <span className="text-ink">{ratings[it.key] ? ratingLabel(ratings[it.key]) : "—"}</span>
              </div>
              {issues[it.key] ? <div className="text-[11px] text-amber-700">Issue: {issues[it.key]}</div> : null}
            </div>
          ))}
        </div>
      </div>

      <div className="mt-4">
        <div className="text-xs font-semibold uppercase tracking-wide text-muted">Compliance</div>
        <div className="mt-1 grid gap-x-6 gap-y-1 sm:grid-cols-2">
          {CHECK_ITEMS.map((it) => {
            const pass = checks[it.key];
            const failedCritical = it.critical && pass === false;
            return (
              <div key={it.key} className="flex items-center justify-between gap-3 text-sm">
                <span className={failedCritical ? "text-red-700" : "text-muted"}>{it.label}</span>
                <span className={pass === false ? "font-medium text-red-700" : pass ? "text-emerald-700" : "text-muted"}>
                  {pass == null ? "—" : pass ? "Pass" : "Fail"}
                </span>
              </div>
            );
          })}
        </div>
      </div>

      {i.notes ? (
        <div className="mt-4 text-sm">
          <div className="text-xs font-semibold uppercase tracking-wide text-muted">Notes</div>
          <p className="mt-1 whitespace-pre-wrap text-ink">{i.notes}</p>
        </div>
      ) : null}

      <div className="mt-4">
        <div className="text-xs font-semibold uppercase tracking-wide text-muted">Photos</div>
        <div className="mt-2 grid grid-cols-2 gap-3 sm:grid-cols-4">
          {INSPECTION_PHOTO_KINDS.map((k) => {
            const url = photoByKind.get(k.key);
            return (
              <div key={k.key} className="text-center text-[11px] text-muted">
                {url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={url} alt={k.label} className="h-28 w-full rounded-lg border border-line object-cover" />
                ) : (
                  <div className="grid h-28 w-full place-items-center rounded-lg border border-dashed border-line text-muted">No photo</div>
                )}
                <div className="mt-1">{k.label}</div>
              </div>
            );
          })}
        </div>
      </div>

      {canEdit ? (
        <div className="mt-5 print:hidden">
          <Link
            href={`/fleet/${vehicleId}/inspect`}
            className="rounded-lg border border-line px-3 py-1.5 text-xs font-medium text-brand-700 hover:bg-black/5"
          >
            Edit inspection
          </Link>
        </div>
      ) : null}
    </Card>
  );
}
