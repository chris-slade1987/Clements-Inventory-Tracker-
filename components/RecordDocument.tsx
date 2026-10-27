import { branchLabel } from "@/lib/management";

// Read-only, print-friendly rendering of ONE personnel record (write-up, accident
// report, note, recognition) — so each can be printed / saved as its own PDF.

const LABEL: Record<string, string> = { writeup: "Employee Write-up", note: "Personnel Note", recognition: "Recognition", accident: "Workplace Accident Report" };
const ROLE: Record<string, string> = { employee: "Employee", supervisor: "Supervisor", hr: "HR", witness: "Witness" };

type Sig = { role: string; signerName: string; statement: string | null; signedAt: Date };
export type RecordForDoc = {
  type: string; category: string | null; title: string | null; body: string | null;
  incidentDate: Date | null; actionTaken: string | null; followUp: string | null;
  details: string | null; attachmentName: string | null; attachmentFile: string | null;
  authorName: string | null; acknowledgedAt: Date | null; createdAt: Date;
  signatures: Sig[];
};
type Emp = { name: string; role: string | null; division: string | null; branch: string | null };

const d = (x: Date | null) => (x ? new Date(x).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" }) : "—");
const dt = (x: Date | null) => (x ? new Date(x).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" }) : "—");

function parseDetails(s: string | null): [string, string][] {
  if (!s) return [];
  try {
    const o = JSON.parse(s) as Record<string, unknown>;
    return Object.entries(o)
      .filter(([, v]) => v != null && v !== "" && typeof v !== "object")
      .map(([k, v]) => [k.replace(/([A-Z])/g, " $1").replace(/^./, (c) => c.toUpperCase()).replace(/_/g, " "), String(v)]);
  } catch { return []; }
}

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  if (!value) return null;
  return <div className="mt-3"><div className="text-[11px] font-medium uppercase tracking-wide text-slate-500">{label}</div><div className="whitespace-pre-wrap text-sm text-slate-900">{value}</div></div>;
}

export default function RecordDocument({ record, employee }: { record: RecordForDoc; employee: Emp }) {
  const title = LABEL[record.type] ?? "Personnel Record";
  const details = record.type === "accident" ? parseDetails(record.details) : [];

  return (
    <div className="text-slate-900">
      <div className="flex flex-wrap items-start justify-between gap-4 border-b border-slate-200 pb-3">
        <div>
          <div className="text-xs uppercase tracking-wider text-slate-500">Clements Pest Control · Personnel Record</div>
          <h2 className="mt-1 text-xl font-semibold">{title}{record.category ? <span className="text-slate-500"> · {record.category}</span> : null}</h2>
        </div>
        <div className="text-right text-sm text-slate-500">
          <div>Filed {d(record.createdAt)}</div>
          {record.authorName ? <div>by {record.authorName}</div> : null}
        </div>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-x-6 gap-y-1 text-sm">
        <div><span className="text-slate-500">Employee:</span> <span className="font-medium">{employee.name}</span></div>
        <div><span className="text-slate-500">Branch:</span> {employee.branch ? branchLabel(employee.branch) : "—"}</div>
        <div><span className="text-slate-500">Role:</span> {employee.role ?? "—"}</div>
        <div><span className="text-slate-500">Division:</span> {employee.division ?? "—"}</div>
        {record.incidentDate ? <div><span className="text-slate-500">Incident date:</span> {d(record.incidentDate)}</div> : null}
      </div>

      {record.title ? <div className="mt-4 text-base font-semibold text-slate-900">{record.title}</div> : null}
      <Field label="Details" value={record.body} />

      {details.length > 0 ? (
        <div className="mt-3">
          <div className="text-[11px] font-medium uppercase tracking-wide text-slate-500">Report fields</div>
          <table className="mt-1 w-full text-sm">
            <tbody>
              {details.map(([k, v]) => (
                <tr key={k} className="border-b border-slate-100 last:border-0 align-top"><td className="py-1 pr-4 text-slate-500">{k}</td><td className="py-1 text-slate-900">{v}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      <Field label="Action taken" value={record.actionTaken} />
      <Field label="Follow-up" value={record.followUp} />
      {record.attachmentName ? <Field label="Attachment" value={record.attachmentName} /> : null}

      {/* Signatures */}
      <div className="mt-6 border-t border-slate-200 pt-4">
        <div className="text-[11px] uppercase tracking-wide text-slate-500">Signatures</div>
        {record.signatures.length === 0 ? (
          <p className="mt-1 text-sm text-slate-400">No signatures on file.</p>
        ) : (
          <div className="mt-2 grid gap-3 sm:grid-cols-2">
            {record.signatures.map((s, i) => (
              <div key={i} className="rounded-lg ring-1 ring-slate-200 p-3">
                <div className="text-[11px] uppercase tracking-wide text-slate-500">{ROLE[s.role] ?? s.role}</div>
                <div className="mt-1 text-lg" style={{ fontFamily: "'Segoe Script','Brush Script MT',cursive" }}>{s.signerName}</div>
                <div className="text-xs text-slate-400">Signed {dt(s.signedAt)}</div>
                {s.statement ? <div className="mt-1 text-[11px] italic text-slate-500">&ldquo;{s.statement}&rdquo;</div> : null}
              </div>
            ))}
          </div>
        )}
        {record.acknowledgedAt ? <div className="mt-2 text-xs text-slate-500">Employee acknowledged {dt(record.acknowledgedAt)}.</div> : null}
      </div>
    </div>
  );
}
