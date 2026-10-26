"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Card, btn } from "@/components/ui";
import DateInput from "@/components/DateInput";
import { fileToJpegDataUrl } from "@/lib/client-image";
import { WAREHOUSE_SECTIONS, WAREHOUSE_PHOTO_PROMPTS, scoreWarehouse, WAREHOUSE_ITEMS, type Checks, type CheckVal } from "@/lib/warehouse";

type PhotoState = { url?: string; dataUrl?: string; caption: string };
type Prefill = {
  date: string; inspectorName: string;
  checks: Record<string, CheckVal>; comments: Record<string, string>; notes: string;
  needs: Record<string, string>; // itemKey -> request
  photos: Record<string, { url: string; caption: string }>; // promptKey -> saved photo
  inspectorSignedName: string;
  repeats: string[]; // item keys that also failed the prior inspection
};

function gradeColor(g: string) {
  if (g === "A" || g === "B") return "bg-emerald-100 text-emerald-700";
  if (g === "C") return "bg-amber-100 text-amber-700";
  return "bg-red-100 text-red-700";
}

export default function WarehouseForm({
  branch, year, month, isEdit, prefill,
}: {
  branch: string; year: number; month: number; isEdit: boolean; prefill: Prefill;
}) {
  const router = useRouter();
  const [date, setDate] = useState(prefill.date);
  const [inspectorName, setInspectorName] = useState(prefill.inspectorName);
  const [checks, setChecks] = useState<Checks>(prefill.checks ?? {});
  const [comments, setComments] = useState<Record<string, string>>(prefill.comments ?? {});
  const [notes, setNotes] = useState(prefill.notes);
  // Needs: itemKey -> "what I need" text; open set reveals the field for an item.
  const [needs, setNeeds] = useState<Record<string, string>>(prefill.needs ?? {});
  const [needOpen, setNeedOpen] = useState<Set<string>>(new Set(Object.keys(prefill.needs ?? {})));
  const [photos, setPhotos] = useState<Record<string, PhotoState>>(() => {
    const o: Record<string, PhotoState> = {};
    for (const [k, v] of Object.entries(prefill.photos ?? {})) o[k] = { url: v.url, caption: v.caption };
    return o;
  });
  const [sigName, setSigName] = useState(prefill.inspectorSignedName || prefill.inspectorName);
  const [certified, setCertified] = useState(!!prefill.inspectorSignedName);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const repeats = new Set(prefill.repeats ?? []);
  const live = useMemo(() => scoreWarehouse(checks), [checks]);
  const critFails = WAREHOUSE_ITEMS.filter((it) => it.critical && checks[it.key] === false);
  const answered = WAREHOUSE_ITEMS.filter((it) => checks[it.key] != null).length;
  const labelFor = (key: string) => WAREHOUSE_ITEMS.find((i) => i.key === key)?.label ?? null;
  const needList = Object.entries(needs).filter(([, v]) => v.trim());
  const photoCount = Object.values(photos).filter((p) => p.url || p.dataUrl).length;
  const requiredShot = WAREHOUSE_PHOTO_PROMPTS.filter((p) => p.required).length;
  const requiredDone = WAREHOUSE_PHOTO_PROMPTS.filter((p) => p.required && (photos[p.key]?.url || photos[p.key]?.dataUrl)).length;

  function toggleNeed(key: string) {
    setNeedOpen((s) => { const n = new Set(s); if (n.has(key)) { n.delete(key); setNeeds((m) => { const c = { ...m }; delete c[key]; return c; }); } else n.add(key); return n; });
  }

  async function onPhoto(key: string, file: File) {
    try {
      const dataUrl = await fileToJpegDataUrl(file, 1280, 0.8);
      setPhotos((s) => ({ ...s, [key]: { ...(s[key] ?? { caption: "" }), dataUrl } }));
    } catch { setError("Couldn't read that image. Try again."); }
  }
  function removePhoto(key: string) {
    setPhotos((s) => { const n = { ...s }; delete n[key]; return n; });
  }

  async function save() {
    setBusy(true); setError(null);
    // New/replaced photos carry a dataUrl; prompts that HAD a saved photo but were
    // cleared go in removePhotoPromptKeys so the server deletes them.
    const photoPayload = Object.entries(photos).filter(([, p]) => p.dataUrl).map(([promptKey, p]) => ({ promptKey, dataUrl: p.dataUrl, caption: p.caption }));
    const removePhotoPromptKeys = Object.keys(prefill.photos ?? {}).filter((k) => !photos[k]);
    const needsPayload = needList.map(([itemKey, request]) => ({ itemKey, label: labelFor(itemKey), request }));
    const res = await fetch("/api/fleet/warehouse", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ branch, year, month, date, inspectorName, checks, comments, notes, needs: needsPayload, photos: photoPayload, removePhotoPromptKeys, inspectorSignedName: certified && sigName.trim() ? sigName.trim() : undefined }),
    });
    const data = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) return setError(data.error ?? "Save failed.");
    setDone(true); router.refresh();
  }

  if (done) {
    return (
      <Card className="p-5 max-w-md">
        <div className="flex items-center gap-2 text-brand-700">
          <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth={2}><path d="M20 6 9 17l-5-5" strokeLinecap="round" strokeLinejoin="round" /></svg>
          <h2 className="text-lg font-semibold">Inspection saved</h2>
        </div>
        <p className="mt-2 text-sm text-muted">Grade <span className="font-semibold text-ink">{live.grade}</span> ({live.score}/{live.maxScore}, {live.scorePct}%).{critFails.length ? ` ${critFails.length} critical item flagged.` : ""}</p>
        {needList.length > 0 ? <p className="mt-1 text-sm text-amber-700">{needList.length} escalation{needList.length === 1 ? "" : "s"} sent to the Director of Field Ops + super admins.</p> : null}
        <div className="mt-5 flex gap-2">
          <button onClick={() => router.push("/my-branch/warehouse")} className={btn.primary}>Back to warehouse</button>
          <button onClick={() => setDone(false)} className={btn.secondary}>Keep editing</button>
        </div>
      </Card>
    );
  }

  return (
    <div className="space-y-4 max-w-3xl pb-28">
      <Card className="p-4 grid gap-3 sm:grid-cols-2">
        <label className="block text-sm font-medium">Inspector
          <input value={inspectorName} onChange={(e) => setInspectorName(e.target.value)} className="mt-1 w-full rounded-lg border border-line px-3 py-2.5 text-sm" />
        </label>
        <label className="block text-sm font-medium">Date of inspection
          <DateInput className="mt-1" value={date} onChange={setDate} />
        </label>
      </Card>

      {WAREHOUSE_SECTIONS.map((sec) => (
        <div key={sec.section} className="space-y-2">
          <div className="text-sm font-semibold text-ink pt-1">{sec.section}</div>
          {sec.items.map((it) => {
            const val = checks[it.key];
            const isNo = val === false;
            const flagged = needOpen.has(it.key);
            return (
              <Card key={it.key} className={`p-3 ${it.critical && isNo ? "ring-1 ring-red-300" : ""}`}>
                <div className="flex items-center gap-3">
                  <div className="flex-1 text-sm text-ink">
                    {it.label}
                    {it.critical ? <span className="ml-2 rounded-full bg-red-50 px-1.5 py-0.5 text-[10px] font-medium text-red-600 align-middle">critical</span> : null}
                    {repeats.has(it.key) ? <span className="ml-2 rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-700 align-middle" title="Also failed the prior inspection">repeat</span> : null}
                  </div>
                  <div className="flex gap-1 rounded-xl bg-slate-100 p-1">
                    <button onClick={() => setChecks((s) => ({ ...s, [it.key]: true }))} className={`rounded-lg px-3 py-2 text-xs font-medium transition-colors ${val === true ? "bg-emerald-grad text-white shadow" : "text-slate-600 hover:text-slate-900"}`}>Yes</button>
                    <button onClick={() => setChecks((s) => ({ ...s, [it.key]: false }))} className={`rounded-lg px-3 py-2 text-xs font-medium transition-colors ${val === false ? "bg-red-500 text-white shadow" : "text-slate-600 hover:text-slate-900"}`}>No</button>
                    <button onClick={() => setChecks((s) => ({ ...s, [it.key]: "na" }))} className={`rounded-lg px-3 py-2 text-xs font-medium transition-colors ${val === "na" ? "bg-slate-500 text-white shadow" : "text-slate-600 hover:text-slate-900"}`}>N/A</button>
                  </div>
                </div>
                {isNo ? (
                  <div className="mt-2 space-y-2">
                    <input value={comments[it.key] ?? ""} onChange={(e) => setComments((s) => ({ ...s, [it.key]: e.target.value }))} placeholder="Corrective action you're taking" className="w-full rounded-lg border border-amber-300 px-3 py-2 text-sm" />
                    <label className="flex items-center gap-2 text-xs font-medium text-amber-800">
                      <input type="checkbox" checked={flagged} onChange={() => toggleNeed(it.key)} />
                      Escalate to leadership — resource or repair needed
                    </label>
                    {flagged ? (
                      <input value={needs[it.key] ?? ""} onChange={(e) => setNeeds((s) => ({ ...s, [it.key]: e.target.value }))} placeholder="What's needed? e.g. new chem-room lock, restock first-aid kit" className="w-full rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-sm" />
                    ) : null}
                  </div>
                ) : null}
              </Card>
            );
          })}
        </div>
      ))}

      {/* Guided compliance photos */}
      <div className="space-y-2">
        <div className="flex items-center justify-between pt-1">
          <div className="text-sm font-semibold text-ink">Compliance photos</div>
          <span className="text-[11px] text-muted">{requiredDone}/{requiredShot} required · {photoCount} total</span>
        </div>
        <p className="text-xs text-muted">Capture each so the record shows the branch was actually checked. Tap a tile to take or upload a photo.</p>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {WAREHOUSE_PHOTO_PROMPTS.map((p) => {
            const ph = photos[p.key];
            const src = ph?.dataUrl || ph?.url;
            return (
              <Card key={p.key} className="p-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="text-sm font-medium text-ink">{p.label}{p.required ? <span className="ml-1 text-[10px] text-brand-600">required</span> : null}</div>
                    <div className="text-xs text-muted">{p.hint}</div>
                  </div>
                  {src ? <button onClick={() => removePhoto(p.key)} className="shrink-0 text-xs font-medium text-red-600 hover:underline">Remove</button> : null}
                </div>
                {src ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={src} alt={p.label} className="mt-2 h-36 w-full rounded-lg object-cover" />
                ) : (
                  <label className="mt-2 flex h-24 cursor-pointer items-center justify-center rounded-lg border border-dashed border-line text-xs font-medium text-brand-700 hover:bg-black/[0.02]">
                    + Take / upload photo
                    <input type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => e.target.files?.[0] && onPhoto(p.key, e.target.files[0])} />
                  </label>
                )}
                {src ? (
                  <input value={ph?.caption ?? ""} onChange={(e) => setPhotos((s) => ({ ...s, [p.key]: { ...(s[p.key] ?? {}), caption: e.target.value } }))} placeholder="Caption (optional)" className="mt-2 w-full rounded-lg border border-line px-2 py-1.5 text-xs" />
                ) : null}
              </Card>
            );
          })}
        </div>
      </div>

      <Card className="p-4">
        <label className="block text-sm font-medium">Notes
          <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} className="mt-1 w-full rounded-lg border border-line px-3 py-2 text-sm" />
        </label>
      </Card>

      {/* Inspector attestation / e-signature */}
      <Card className="p-4">
        <div className="text-sm font-medium text-ink">Inspector attestation</div>
        <p className="mt-0.5 text-xs text-muted">Your typed name is your signature on this safety record (FL 482 / FDACS / OSHA).</p>
        <div className="mt-2 flex flex-col gap-2 sm:flex-row sm:items-center">
          <input value={sigName} onChange={(e) => setSigName(e.target.value)} placeholder="Type your full name" className="flex-1 rounded-lg border border-line px-3 py-2 text-sm" />
        </div>
        <label className="mt-2 flex items-start gap-2 text-xs text-ink">
          <input type="checkbox" checked={certified} onChange={(e) => setCertified(e.target.checked)} className="mt-0.5" />
          I certify this inspection was completed accurately and the conditions recorded are true as of the inspection date.
        </label>
      </Card>

      {needList.length > 0 ? (
        <Card className="p-3 ring-1 ring-amber-300 bg-amber-50">
          <div className="text-sm font-medium text-amber-900">{needList.length} escalation{needList.length === 1 ? "" : "s"} will be sent to the Director of Field Ops + super admins on save:</div>
          <ul className="mt-1 list-disc pl-5 text-sm text-ink">
            {needList.map(([k, v]) => <li key={k}>{labelFor(k) ? <span className="text-muted">{labelFor(k)}: </span> : null}{v}</li>)}
          </ul>
        </Card>
      ) : null}

      {error ? <p className="text-sm text-red-600">{error}</p> : null}

      <div className="fixed bottom-0 inset-x-0 sm:left-60 border-t border-line bg-surface/95 backdrop-blur px-4 py-3 z-20">
        <div className="max-w-3xl mx-auto flex items-center gap-4">
          <div className="flex items-center gap-3">
            <div className={`grid h-12 w-12 place-items-center rounded-full text-lg font-bold ${gradeColor(live.grade)}`}>{live.grade}</div>
            <div className="text-sm">
              <div className="font-semibold tabular-nums">{live.score}/{live.maxScore} · {live.scorePct}%</div>
              <div className="text-xs text-muted">{answered}/{WAREHOUSE_ITEMS.length} answered{critFails.length ? <span className="ml-2 text-red-600 font-medium">· {critFails.length} critical fail</span> : null}{needList.length ? <span className="ml-2 text-amber-700 font-medium">· {needList.length} escalation{needList.length === 1 ? "" : "s"}</span> : null}</div>
            </div>
          </div>
          <button onClick={save} disabled={busy} className={`${btn.primary} ml-auto`}>{busy ? "Saving…" : certified && sigName.trim() ? "Save & sign inspection" : isEdit ? "Update inspection" : "Save inspection"}</button>
        </div>
      </div>
    </div>
  );
}
