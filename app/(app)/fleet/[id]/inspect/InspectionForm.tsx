"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Card, btn } from "@/components/ui";
import DateInput from "@/components/DateInput";
import { fileToJpegDataUrl } from "@/lib/client-image";
import {
  CONDITION_ITEMS,
  RATING_SCALE,
  CHECK_ITEMS,
  MAX_SCORE,
  INSPECTION_PHOTO_KINDS,
  scoreInspection,
  type Ratings,
  type Checks,
} from "@/lib/inspection";

const MONTHS = ["", "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

type Prefill = {
  date: string;
  employeeId: string;
  technicianName: string;
  inspectorName: string;
  mileage: string;
  oilChangeNextMileage: string;
  oilChangeNext: string;
  notes: string;
  ratings: Record<string, number>;
  ratingIssues: Record<string, string>;
  checks: Record<string, boolean>;
  photos: Record<string, string>; // kind -> existing photo URL
};

export default function InspectionForm({
  vehicleId,
  vehicleLabel,
  year,
  month,
  isEdit,
  prefill,
  employees,
}: {
  vehicleId: string;
  vehicleLabel: string;
  year: number;
  month: number;
  isEdit: boolean;
  prefill: Prefill;
  employees: { id: string; name: string }[];
}) {
  const router = useRouter();
  const [f, setF] = useState({
    date: prefill.date,
    employeeId: prefill.employeeId,
    technicianName: prefill.technicianName,
    inspectorName: prefill.inspectorName,
    mileage: prefill.mileage,
    oilChangeNextMileage: prefill.oilChangeNextMileage,
    oilChangeNext: prefill.oilChangeNext,
    notes: prefill.notes,
  });
  const [ratings, setRatings] = useState<Ratings>(prefill.ratings ?? {});
  const [ratingIssues, setRatingIssues] = useState<Record<string, string>>(prefill.ratingIssues ?? {});
  const [checks, setChecks] = useState<Checks>(prefill.checks ?? {});
  // Photos: kind -> data URL (new capture) or existing URL. All four required.
  const [photos, setPhotos] = useState<Record<string, string>>(prefill.photos ?? {});
  const [photoBusy, setPhotoBusy] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [dirty, setDirty] = useState(false);

  const set = (patch: Partial<typeof f>) => { setDirty(true); setF((s) => ({ ...s, ...patch })); };

  // Warn before leaving with unsaved edits (close/reload/back).
  useEffect(() => {
    if (!dirty || done) return;
    const handler = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ""; };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [dirty, done]);

  // Odometer sanity: the pre-filled mileage is what's on file for this vehicle.
  const mileageWarning = (() => {
    const onFile = parseInt(String(prefill.mileage).replace(/[^0-9]/g, ""), 10);
    const typed = parseInt(String(f.mileage).replace(/[^0-9]/g, ""), 10);
    if (!Number.isFinite(typed) || !Number.isFinite(onFile) || !onFile) return null;
    if (typed < onFile) return `Entered ${typed.toLocaleString()} mi is below the ${onFile.toLocaleString()} mi on file — odometers don't go backward.`;
    if (typed > onFile + 100000) return `Entered ${typed.toLocaleString()} mi jumps >100k over the ${onFile.toLocaleString()} mi on file — typo?`;
    return null;
  })();

  const live = useMemo(() => scoreInspection(ratings, checks), [ratings, checks]);
  const critFails = CHECK_ITEMS.filter((it) => it.critical && checks[it.key] === false);
  const answered = CONDITION_ITEMS.filter((it) => ratings[it.key]).length + CHECK_ITEMS.filter((it) => checks[it.key] != null).length;
  const totalItems = CONDITION_ITEMS.length + CHECK_ITEMS.length;

  // ── Required-field validation (mirrored server-side) ──────────────────────
  const mileageNum = parseInt(String(f.mileage).replace(/[^0-9]/g, ""), 10);
  const mileageValid = Number.isFinite(mileageNum) && mileageNum > 0;
  const oilMileageNum = parseInt(String(f.oilChangeNextMileage).replace(/[^0-9]/g, ""), 10);
  const oilValid = (Number.isFinite(oilMileageNum) && oilMileageNum > 0) || f.oilChangeNext.trim() !== "";
  const missingPhotos = INSPECTION_PHOTO_KINDS.filter((p) => !photos[p.key]);
  const photosComplete = missingPhotos.length === 0;
  const canSubmit = mileageValid && oilValid && photosComplete && !busy && !photoBusy;

  function validationMessage(): string | null {
    if (!mileageValid) return "Enter the current odometer mileage.";
    if (!oilValid) return "Enter the next oil change — a next-due mileage and/or a next-due month.";
    if (!photosComplete) return `Capture all 4 required photos (missing: ${missingPhotos.map((p) => p.label).join(", ")}).`;
    return null;
  }

  async function onPhoto(kind: string, file: File | null | undefined) {
    if (!file) return;
    setPhotoBusy(kind);
    setError(null);
    try {
      const dataUrl = await fileToJpegDataUrl(file, 1280, 0.8);
      setDirty(true);
      setPhotos((s) => ({ ...s, [kind]: dataUrl }));
    } catch {
      setError("Could not read that image. Try another photo.");
    } finally {
      setPhotoBusy(null);
    }
  }

  async function save() {
    const vmsg = validationMessage();
    if (vmsg) return setError(vmsg);
    setBusy(true);
    setError(null);
    const res = await fetch("/api/fleet/inspection", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ vehicleId, year, month, ...f, ratings, ratingIssues, checks, photos }),
    });
    const data = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) return setError(data.error ?? "Save failed.");
    setDone(true);
    router.refresh();
  }

  if (done) {
    return (
      <Card className="p-5 max-w-md">
        <div className="flex items-center gap-2 text-brand-700">
          <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth={2}><path d="M20 6 9 17l-5-5" strokeLinecap="round" strokeLinejoin="round" /></svg>
          <h2 className="text-lg font-semibold">Inspection saved</h2>
        </div>
        <p className="mt-2 text-sm text-muted">
          {vehicleLabel} — {MONTHS[month]} {year}. Grade <span className="font-semibold text-ink">{live.grade}</span> ({live.score}/{MAX_SCORE}, {live.scorePct}%).
          {critFails.length > 0 ? ` ${critFails.length} critical item flagged for follow-up.` : ""}
        </p>
        <div className="mt-5 flex gap-2">
          <button onClick={() => router.push(`/fleet/${vehicleId}`)} className={btn.primary}>Back to vehicle</button>
          <button onClick={() => setDone(false)} className={btn.secondary}>Keep editing</button>
        </div>
      </Card>
    );
  }

  return (
    <div className="space-y-4 max-w-3xl pb-28">
      {/* Header */}
      <Card className="p-4 grid gap-3 sm:grid-cols-2">
        <div className="sm:col-span-2 text-xs uppercase tracking-wider text-muted">
          Inspection period · <span className="text-ink font-medium">{MONTHS[month]} {year}</span>
          {isEdit ? <span className="ml-2 rounded-full bg-amber-100 px-2 py-0.5 text-[11px] text-amber-700">Editing existing</span> : null}
        </div>
        <label className="block text-sm font-medium">Technician (assigned driver)
          <select
            value={f.employeeId}
            onChange={(e) => {
              const emp = employees.find((x) => x.id === e.target.value);
              set({ employeeId: e.target.value, technicianName: emp ? emp.name : f.technicianName });
            }}
            className="mt-1 w-full rounded-lg border border-line px-3 py-2.5 text-sm bg-surface"
          >
            <option value="">{f.technicianName ? `${f.technicianName} (not linked)` : "— Select employee —"}</option>
            {employees.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
          </select>
          <span className="mt-0.5 block text-[11px] font-normal text-muted">Report &amp; score tag to this profile</span>
        </label>
        <Field label="Inspector (manager)" v={f.inspectorName} on={(v) => set({ inspectorName: v })} />
        <label className="block text-sm font-medium">Inspection date
          <DateInput className="mt-1" value={f.date} onChange={(v) => set({ date: v })} />
        </label>
        <Field label="Mileage" required v={f.mileage} on={(v) => set({ mileage: v })} hint="Required — pre-filled from file; updating syncs the vehicle" invalid={!mileageValid} />
        {mileageWarning ? <p className="sm:col-span-2 text-xs text-amber-700">{mileageWarning}</p> : null}
      </Card>

      {/* Section A — condition ratings */}
      <SectionTitle n="A" title="Condition" hint="Rate each area." />
      <div className="space-y-2">
        {CONDITION_ITEMS.map((it) => (
          <Card key={it.key} className="p-3">
            <div className="flex flex-col sm:flex-row sm:items-center gap-3">
              <div className="flex-1 text-sm font-medium text-ink">{it.label}</div>
              <div className="flex gap-1 rounded-xl bg-slate-100 p-1">
                {RATING_SCALE.map((r) => {
                  const sel = ratings[it.key] === r.value;
                  return (
                    <button
                      key={r.value}
                      onClick={() => { setDirty(true); setRatings((s) => ({ ...s, [it.key]: r.value })); }}
                      className={`rounded-lg px-3 py-2 text-xs font-medium min-w-[84px] transition-colors ${
                        sel ? "bg-emerald-grad text-white shadow" : "text-slate-600 hover:text-slate-900"
                      }`}
                    >
                      {r.short} · {r.value}
                    </button>
                  );
                })}
              </div>
            </div>
            <input
              value={ratingIssues[it.key] ?? ""}
              onChange={(e) => { setDirty(true); setRatingIssues((s) => ({ ...s, [it.key]: e.target.value })); }}
              placeholder="Issues to address (optional)"
              className="mt-2 w-full rounded-lg border border-line px-3 py-2 text-sm"
            />
          </Card>
        ))}
      </div>

      {/* Section B — next oil change (from the truck's service sticker) */}
      <SectionTitle n="B" title="Next oil change" hint="From the sticker on the truck — enter a mileage and/or a month. At least one is required." />
      <Card className={`p-4 grid gap-3 sm:grid-cols-2 ${!oilValid ? "ring-1 ring-amber-300" : ""}`}>
        <Field
          label="Next due — mileage"
          v={f.oilChangeNextMileage}
          on={(v) => set({ oilChangeNextMileage: v })}
          hint="Odometer reading the next oil change is due at"
        />
        <label className="block text-sm font-medium">Next due — month/year
          <MonthYearSelect value={f.oilChangeNext} onChange={(v) => set({ oilChangeNext: v })} />
          <span className="mt-0.5 block text-[11px] font-normal text-muted">The month/year on the truck&apos;s oil-change sticker (no day needed)</span>
        </label>
        {!oilValid ? <p className="sm:col-span-2 text-xs text-amber-700">Enter a next-due mileage and/or a next-due date.</p> : null}
      </Card>

      {/* Section B2 — required photos */}
      <SectionTitle n="D" title="Required photos" hint="Capture all 4. Use the camera or upload from your phone." />
      <div className="grid gap-2 sm:grid-cols-2">
        {INSPECTION_PHOTO_KINDS.map((p) => (
          <PhotoTile
            key={p.key}
            label={p.label}
            value={photos[p.key] ?? null}
            busy={photoBusy === p.key}
            onPick={(file) => onPhoto(p.key, file)}
            onClear={() => { setDirty(true); setPhotos((s) => { const n = { ...s }; delete n[p.key]; return n; }); }}
          />
        ))}
      </div>

      {/* Section C — compliance checks */}
      <SectionTitle n="C" title="FDACS / insurance / maintenance" hint="1 point each. Critical items flag a safety alert when failed." />
      <div className="space-y-2">
        {CHECK_ITEMS.map((it) => {
          const val = checks[it.key];
          return (
            <Card key={it.key} className={`p-3 ${it.critical && val === false ? "ring-1 ring-red-300" : ""}`}>
              <div className="flex items-center gap-3">
                <div className="flex-1 text-sm text-ink">
                  {it.label}
                  {it.critical ? <span className="ml-2 rounded-full bg-red-50 px-1.5 py-0.5 text-[10px] font-medium text-red-600 align-middle">critical</span> : null}
                </div>
                <div className="flex gap-1 rounded-xl bg-slate-100 p-1">
                  <button
                    onClick={() => { setDirty(true); setChecks((s) => ({ ...s, [it.key]: true })); }}
                    className={`rounded-lg px-4 py-2 text-xs font-medium transition-colors ${val === true ? "bg-emerald-grad text-white shadow" : "text-slate-600 hover:text-slate-900"}`}
                  >Pass</button>
                  <button
                    onClick={() => { setDirty(true); setChecks((s) => ({ ...s, [it.key]: false })); }}
                    className={`rounded-lg px-4 py-2 text-xs font-medium transition-colors ${val === false ? "bg-red-500 text-white shadow" : "text-slate-600 hover:text-slate-900"}`}
                  >Fail</button>
                </div>
              </div>
            </Card>
          );
        })}
      </div>

      {/* Notes */}
      <Card className="p-4">
        <label className="block text-sm font-medium">Notes
          <textarea value={f.notes} onChange={(e) => set({ notes: e.target.value })} rows={3} className="mt-1 w-full rounded-lg border border-line px-3 py-2 text-sm" />
        </label>
      </Card>

      {error ? <p className="text-sm text-red-600">{error}</p> : null}

      {/* Sticky live score / save bar — offset to clear the mobile bottom nav
          (the app's bottom-20 md:bottom-4 floating pattern). */}
      <div className="copilot-safe-actions fixed bottom-20 md:bottom-4 inset-x-0 sm:left-60 px-4 z-20">
        <div className="max-w-3xl mx-auto flex items-center gap-4 rounded-xl border border-line bg-surface/95 backdrop-blur px-4 py-3 shadow-lg">
          <div className="flex items-center gap-3">
            <div className={`grid h-12 w-12 place-items-center rounded-full text-lg font-bold ${gradeColor(live.grade)}`}>{live.grade}</div>
            <div className="text-sm">
              <div className="font-semibold tabular-nums">{live.score}/{MAX_SCORE} · {live.scorePct}%</div>
              <div className="text-xs text-muted">
                {answered}/{totalItems} answered
                {critFails.length > 0 ? <span className="ml-2 text-red-600 font-medium">· {critFails.length} critical fail</span> : null}
                {!canSubmit && !busy ? <span className="ml-2 text-amber-600 font-medium">· {validationMessage()}</span> : null}
              </div>
            </div>
          </div>
          <button onClick={save} disabled={!canSubmit} className={`${btn.primary} ml-auto`}>
            {busy ? "Saving…" : isEdit ? "Update inspection" : "Save inspection"}
          </button>
        </div>
      </div>
    </div>
  );
}

function gradeColor(g: string) {
  if (g === "A" || g === "B") return "bg-emerald-100 text-emerald-700";
  if (g === "C") return "bg-amber-100 text-amber-700";
  return "bg-red-100 text-red-700";
}

function SectionTitle({ n, title, hint }: { n: string; title: string; hint?: string }) {
  return (
    <div className="flex items-baseline gap-2 pt-1">
      <span className="grid h-6 w-6 place-items-center rounded-full bg-brand-100 text-xs font-bold text-brand-700">{n}</span>
      <h3 className="text-sm font-semibold text-ink">{title}</h3>
      {hint ? <span className="text-xs text-muted">· {hint}</span> : null}
    </div>
  );
}

// Month + Year dropdowns for the next oil change — mechanics give a month/year on
// the sticker, never a specific day. Stores the value as "YYYY-MM-01" so the server
// keeps reading it as a date; shows nothing picked until both are chosen.
const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
function MonthYearSelect({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [yStr, mStr] = (value ? value.slice(0, 7) : "").split("-");
  const month = mStr ?? "";
  const year = yStr ?? "";
  const nowY = new Date().getFullYear();
  const yearsSet = new Set<string>();
  for (let y = nowY - 1; y <= nowY + 4; y++) yearsSet.add(String(y));
  if (year) yearsSet.add(year); // keep an already-saved out-of-range year selectable
  const years = [...yearsSet].sort();
  const cls = "mt-1 w-full rounded-lg border border-line px-3 py-2.5 text-sm";
  const emit = (m: string, y: string) => onChange(m && y ? `${y}-${m}-01` : "");
  return (
    <div className="mt-1 grid grid-cols-2 gap-2">
      <select aria-label="Oil change due month" className={cls} value={month} onChange={(e) => emit(e.target.value, year)}>
        <option value="">Month</option>
        {MONTH_NAMES.map((nm, i) => (
          <option key={nm} value={String(i + 1).padStart(2, "0")}>{nm}</option>
        ))}
      </select>
      <select aria-label="Oil change due year" className={cls} value={year} onChange={(e) => emit(month, e.target.value)}>
        <option value="">Year</option>
        {years.map((y) => (
          <option key={y} value={y}>{y}</option>
        ))}
      </select>
    </div>
  );
}

function Field({ label, v, on, hint, required, invalid }: { label: string; v: string; on: (v: string) => void; hint?: string; required?: boolean; invalid?: boolean }) {
  return (
    <label className="block text-sm font-medium">{label}{required ? <span className="ml-1 text-red-600">*</span> : null}
      <input value={v} onChange={(e) => on(e.target.value)} className={`mt-1 w-full rounded-lg border px-3 py-2.5 text-sm ${invalid ? "border-amber-400 ring-1 ring-amber-300" : "border-line"}`} />
      {hint ? <span className="mt-0.5 block text-[11px] font-normal text-muted">{hint}</span> : null}
    </label>
  );
}

// A single required-photo tile: shows a thumbnail once captured, otherwise a
// camera-capture + upload control. `capture="environment"` opens the rear camera
// on phones; it silently degrades to a normal file picker where no camera exists.
function PhotoTile({ label, value, busy, onPick, onClear }: { label: string; value: string | null; busy: boolean; onPick: (file: File | null) => void; onClear: () => void }) {
  const inputId = `photo-${label.replace(/[^a-z0-9]/gi, "-").toLowerCase()}`;
  return (
    <Card className={`p-3 ${value ? "" : "ring-1 ring-amber-300"}`}>
      <div className="flex items-center gap-2">
        <div className="flex-1 text-sm font-medium text-ink">{label}<span className="ml-1 text-red-600">*</span></div>
        {value ? (
          <button type="button" onClick={onClear} className="text-xs font-medium text-red-600 hover:underline">Remove</button>
        ) : null}
      </div>
      {value ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={value} alt={label} className="mt-2 h-40 w-full rounded-lg border border-line object-cover" />
      ) : (
        <label htmlFor={inputId} className="mt-2 flex h-40 w-full cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-line bg-slate-50 text-center text-xs text-muted hover:bg-slate-100">
          {busy ? (
            <span>Processing…</span>
          ) : (
            <>
              <svg viewBox="0 0 24 24" className="h-7 w-7 text-brand-400" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
                <circle cx="12" cy="13" r="4" />
              </svg>
              <span>Tap to take a photo or upload</span>
            </>
          )}
        </label>
      )}
      <input
        id={inputId}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={(e) => { onPick(e.target.files?.[0] ?? null); e.target.value = ""; }}
      />
    </Card>
  );
}
