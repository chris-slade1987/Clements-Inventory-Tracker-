import { WAREHOUSE_SECTIONS, WAREHOUSE_PHOTO_PROMPTS, parseJson, type Checks } from "@/lib/warehouse";
import { branchLabel } from "@/lib/management";

// Read-only, print-friendly rendering of a completed warehouse safety inspection —
// the "report" handed to FDACS/OSHA or filed. Shared shape with the edit form.

type Need = { id: string; itemKey: string | null; label: string | null; request: string; status: string };
type Photo = { promptKey: string; label: string | null; photoUrl: string; caption: string | null };
export type InspectionForReport = {
  id: string; branch: string; year: number; month: number; date: Date;
  inspectorName: string | null; score: number; maxScore: number; scorePct: number; grade: string;
  checks: string; comments: string; notes: string | null;
  inspectorSignedName: string | null; inspectorSignedAt: Date | null;
  needs: Need[]; photos: Photo[];
};

const MONTHS = ["", "January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const d = (x: Date | null) => (x ? new Date(x).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }) : "—");

function Verdict({ v }: { v: boolean | "na" | undefined }) {
  if (v === true) return <span className="font-medium text-emerald-700">Yes</span>;
  if (v === false) return <span className="font-medium text-red-600">No</span>;
  if (v === "na") return <span className="font-medium text-slate-500">N/A</span>;
  return <span className="text-slate-400">—</span>;
}

export default function WarehouseReport({ inspection, repeats }: { inspection: InspectionForReport; repeats: Set<string> }) {
  const checks = parseJson<Checks>(inspection.checks, {});
  const comments = parseJson<Record<string, string>>(inspection.comments, {});
  const photos = new Map(inspection.photos.map((p) => [p.promptKey, p]));
  const openNeeds = inspection.needs;

  return (
    <div className="text-slate-900">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="text-xs uppercase tracking-wider text-slate-500">Warehouse Safety Inspection · FL 482 / FDACS + OSHA</div>
          <h2 className="mt-1 text-xl font-semibold">{branchLabel(inspection.branch)} · {MONTHS[inspection.month]} {inspection.year}</h2>
          <p className="text-sm text-slate-500">Inspected {d(inspection.date)} · {inspection.inspectorName ?? "—"}</p>
        </div>
        <div className="shrink-0 rounded-xl bg-emerald-50 px-4 py-2.5 text-center ring-1 ring-emerald-100">
          <div className="text-2xl font-bold leading-none tabular-nums text-emerald-700">{inspection.grade}</div>
          <div className="mt-1 text-[11px] text-emerald-800">{inspection.score}/{inspection.maxScore} · {inspection.scorePct}%</div>
        </div>
      </div>

      {openNeeds.length > 0 ? (
        <div className="mt-4 rounded-lg border border-amber-300 bg-amber-50 p-3">
          <div className="text-sm font-semibold text-amber-900">{openNeeds.length} alert{openNeeds.length === 1 ? "" : "s"} for the supervisor</div>
          <ul className="mt-1 list-disc pl-5 text-sm text-slate-800">
            {openNeeds.map((n) => <li key={n.id}>{n.label ? <span className="text-slate-500">{n.label}: </span> : null}{n.request}{n.status === "resolved" ? <span className="ml-2 text-xs font-medium text-emerald-700">resolved</span> : <span className="ml-2 text-xs font-medium text-amber-700">open</span>}</li>)}
          </ul>
        </div>
      ) : null}

      {WAREHOUSE_SECTIONS.map((sec) => (
        <div key={sec.section} className="mt-5">
          <h3 className="mb-1 text-sm font-semibold uppercase tracking-wide text-brand-700">{sec.section}</h3>
          <table className="w-full text-sm">
            <tbody>
              {sec.items.map((it) => (
                <tr key={it.key} className="border-b border-slate-100 last:border-0 align-top">
                  <td className="py-1.5 pr-3 text-slate-800">
                    {it.label}
                    {it.critical ? <span className="ml-2 rounded-full bg-red-50 px-1.5 py-0.5 text-[10px] font-medium text-red-600">critical</span> : null}
                    {repeats.has(it.key) ? <span className="ml-2 rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-700">repeat</span> : null}
                    {checks[it.key] === false && comments[it.key] ? <div className="text-xs text-slate-500">Corrective action: {comments[it.key]}</div> : null}
                  </td>
                  <td className="w-16 py-1.5 text-right"><Verdict v={checks[it.key] as boolean | "na" | undefined} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}

      {inspection.notes ? (<div className="mt-4"><div className="text-[11px] font-medium uppercase tracking-wide text-slate-500">Notes</div><p className="whitespace-pre-wrap text-sm text-slate-800">{inspection.notes}</p></div>) : null}

      {/* Compliance photos */}
      <div className="mt-5">
        <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-brand-700">Compliance photos</h3>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {WAREHOUSE_PHOTO_PROMPTS.map((p) => {
            const ph = photos.get(p.key);
            return (
              <div key={p.key} className="rounded-lg ring-1 ring-slate-200 p-2">
                <div className="text-xs font-medium text-slate-700">{p.label}</div>
                {ph ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={ph.photoUrl} alt={p.label} className="mt-1 h-32 w-full rounded object-cover" />
                ) : (
                  <div className="mt-1 grid h-32 place-items-center rounded bg-slate-50 text-[11px] text-slate-400">No photo</div>
                )}
                {ph?.caption ? <div className="mt-1 text-[11px] text-slate-500">{ph.caption}</div> : null}
              </div>
            );
          })}
        </div>
      </div>

      {/* Signature */}
      <div className="mt-6 border-t border-slate-200 pt-4">
        <div className="text-[11px] uppercase tracking-wide text-slate-500">Inspector attestation</div>
        {inspection.inspectorSignedName ? (
          <>
            <div className="mt-1 text-lg" style={{ fontFamily: "'Segoe Script','Brush Script MT',cursive" }}>{inspection.inspectorSignedName}</div>
            <div className="text-xs text-slate-400">Signed {d(inspection.inspectorSignedAt)} — certified accurate</div>
          </>
        ) : (
          <div className="mt-1 text-sm text-slate-400">Not signed</div>
        )}
      </div>
    </div>
  );
}
