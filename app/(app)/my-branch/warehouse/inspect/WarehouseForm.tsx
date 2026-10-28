"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Card, btn } from "@/components/ui";
import DateInput from "@/components/DateInput";
import { fileToJpegDataUrl } from "@/lib/client-image";
import { WAREHOUSE_SECTIONS, WAREHOUSE_PHOTO_PROMPTS, scoreWarehouse, WAREHOUSE_ITEMS, type Checks, type CheckVal } from "@/lib/warehouse";

type PhotoState = { url?: string; dataUrl?: string; caption: string; notAvailable?: boolean; reason?: string };
type Prefill = {
  date: string; inspectorName: string;
  checks: Record<string, CheckVal>; comments: Record<string, string>; notes: string;
  needs: Record<string, string>; // itemKey -> request
  photos: Record<string, { url: string; caption: string; notAvailable: boolean }>; // promptKey -> saved photo / N-A
  naAlert: string[]; // promptKeys whose "not available" was flagged to the supervisor
  inspectorSignedName: string;
  repeats: string[]; // item keys that also failed the prior inspection
};

function gradeColor(g: string) {
  if (g === "A" || g === "B") return "bg-emerald-100 text-emerald-700";
  if (g === "C") return "bg-amber-100 text-amber-700";
  return "bg-red-100 text-red-700";
}

// Thin 1.6-stroke line icons (brand kit).
function IconCheck({ className = "" }: { className?: string }) {
  return <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth={1.8}><path d="M20 6 9 17l-5-5" strokeLinecap="round" strokeLinejoin="round" /></svg>;
}
function IconX({ className = "" }: { className?: string }) {
  return <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth={1.8}><path d="M18 6 6 18M6 6l12 12" strokeLinecap="round" strokeLinejoin="round" /></svg>;
}
function IconChevron({ className = "" }: { className?: string }) {
  return <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth={1.6}><path d="m6 9 6 6 6-6" strokeLinecap="round" strokeLinejoin="round" /></svg>;
}
function IconCamera({ className = "" }: { className?: string }) {
  return <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth={1.6}><path d="M3 9a2 2 0 0 1 2-2h2l1.4-2.1A1 1 0 0 1 9.2 4h5.6a1 1 0 0 1 .8.4L17 7h2a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V9Z" strokeLinecap="round" strokeLinejoin="round" /><circle cx="12" cy="13" r="3.2" /></svg>;
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
  // Per-item note (shown when the answer is No). Seed from any prior alert text.
  const [comments, setComments] = useState<Record<string, string>>(() => {
    const c = { ...(prefill.comments ?? {}) };
    for (const [k, v] of Object.entries(prefill.needs ?? {})) if (!c[k]?.trim() && v?.trim()) c[k] = v;
    return c;
  });
  const [notes, setNotes] = useState(prefill.notes);
  // "Create alert" set — failed items the inspector flags to notify the super admins.
  const [alertOn, setAlertOn] = useState<Set<string>>(new Set(Object.keys(prefill.needs ?? {})));
  const [photos, setPhotos] = useState<Record<string, PhotoState>>(() => {
    const o: Record<string, PhotoState> = {};
    for (const [k, v] of Object.entries(prefill.photos ?? {})) o[k] = v.notAvailable ? { notAvailable: true, reason: v.caption, caption: "" } : { url: v.url, caption: v.caption };
    return o;
  });
  // "Not available" photo prompts flagged to alert the supervisor (mirrors the No flow).
  const [naAlertOn, setNaAlertOn] = useState<Set<string>>(new Set(prefill.naAlert ?? []));
  const [sigName, setSigName] = useState(prefill.inspectorSignedName || prefill.inspectorName);
  const [certified, setCertified] = useState(!!prefill.inspectorSignedName);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const repeats = new Set(prefill.repeats ?? []);

  // Per-section stats computed from the current answers.
  const sectionStats = (sectionItems: { key: string }[]) => {
    let yes = 0, no = 0, answered = 0;
    for (const it of sectionItems) {
      const v = checks[it.key];
      if (v === true) { yes++; answered++; }
      else if (v === false) { no++; answered++; }
    }
    return { yes, no, answered, total: sectionItems.length, complete: answered === sectionItems.length, clean: answered === sectionItems.length && no === 0 };
  };

  // Collapsed sections. On first render: show the first unfinished section and
  // fold the rest, so a fresh inspection reads as one guided step at a time.
  const [collapsed, setCollapsed] = useState<Set<string>>(() => {
    const firstOpen = WAREHOUSE_SECTIONS.find((sec) => {
      const s = sectionStats(sec.items);
      return !s.complete || s.no > 0; // open the first incomplete section, or one with an issue
    })?.section;
    const set = new Set<string>();
    for (const sec of WAREHOUSE_SECTIONS) if (sec.section !== firstOpen) set.add(sec.section);
    return set;
  });
  const isCollapsed = (name: string) => collapsed.has(name);
  const toggleSection = (name: string) => setCollapsed((s) => { const n = new Set(s); if (n.has(name)) n.delete(name); else n.add(name); return n; });
  const collapse = (name: string) => setCollapsed((s) => new Set(s).add(name));
  const openOnly = (names: string[]) => setCollapsed((s) => { const n = new Set(s); for (const nm of names) n.delete(nm); return n; });

  const live = useMemo(() => scoreWarehouse(checks), [checks]);
  const critFails = WAREHOUSE_ITEMS.filter((it) => it.critical && checks[it.key] === false);
  const answered = WAREHOUSE_ITEMS.filter((it) => checks[it.key] != null).length;
  const pct = Math.round((answered / WAREHOUSE_ITEMS.length) * 100);
  const noCount = WAREHOUSE_ITEMS.filter((it) => checks[it.key] === false).length;
  const labelFor = (key: string) => WAREHOUSE_ITEMS.find((i) => i.key === key)?.label ?? null;
  const alertKeys = [...alertOn];
  const photoLabelFor = (key: string) => WAREHOUSE_PHOTO_PROMPTS.find((p) => p.key === key)?.label ?? key;
  const photoCount = Object.values(photos).filter((p) => p.url || p.dataUrl).length;
  const requiredShot = WAREHOUSE_PHOTO_PROMPTS.filter((p) => p.required).length;
  // A required photo is "done" when there's a photo OR it's marked not available.
  const requiredDone = WAREHOUSE_PHOTO_PROMPTS.filter((p) => p.required && (photos[p.key]?.url || photos[p.key]?.dataUrl || photos[p.key]?.notAvailable)).length;

  function toggleAlert(key: string) {
    setAlertOn((s) => { const n = new Set(s); if (n.has(key)) n.delete(key); else n.add(key); return n; });
  }
  function toggleNaAlert(key: string) {
    setNaAlertOn((s) => { const n = new Set(s); if (n.has(key)) n.delete(key); else n.add(key); return n; });
  }
  function markNotAvailable(key: string) {
    setPhotos((s) => ({ ...s, [key]: { notAvailable: true, reason: s[key]?.reason ?? "", caption: "" } }));
  }

  // Set every item to Yes. Scope "all" fills the whole form; a section name fills
  // just that section. The common case (everything passed) becomes one tap.
  function markAllPassing(scope: "all" | string) {
    setChecks((s) => {
      const n = { ...s };
      const items = scope === "all" ? WAREHOUSE_ITEMS : (WAREHOUSE_SECTIONS.find((x) => x.section === scope)?.items ?? []);
      for (const it of items) n[it.key] = true;
      return n;
    });
    if (scope === "all") {
      setCollapsed(new Set(WAREHOUSE_SECTIONS.map((x) => x.section)));
    } else {
      // Collapse the finished section and open the next one still needing work.
      collapse(scope);
      const idx = WAREHOUSE_SECTIONS.findIndex((x) => x.section === scope);
      const next = WAREHOUSE_SECTIONS.slice(idx + 1).find((x) => sectionStats(x.items).answered < x.items.length);
      if (next) openOnly([next.section]);
    }
  }

  function setAnswer(key: string, val: boolean) {
    setChecks((s) => ({ ...s, [key]: val }));
  }

  async function onPhoto(key: string, file: File) {
    try {
      const dataUrl = await fileToJpegDataUrl(file, 1280, 0.8);
      setPhotos((s) => ({ ...s, [key]: { ...(s[key] ?? { caption: "" }), notAvailable: false, dataUrl } }));
    } catch { setError("Couldn't read that image. Try again."); }
  }
  function removePhoto(key: string) {
    setPhotos((s) => { const n = { ...s }; delete n[key]; return n; });
    setNaAlertOn((s) => { if (!s.has(key)) return s; const n = new Set(s); n.delete(key); return n; });
  }

  async function save() {
    setBusy(true); setError(null);
    // New/replaced photos carry a dataUrl; prompts that HAD a saved photo but were
    // cleared go in removePhotoPromptKeys so the server deletes them.
    const photoPayload = [
      ...Object.entries(photos).filter(([, p]) => p.dataUrl).map(([promptKey, p]) => ({ promptKey, dataUrl: p.dataUrl, caption: p.caption })),
      ...Object.entries(photos).filter(([, p]) => p.notAvailable).map(([promptKey, p]) => ({ promptKey, notAvailable: true, caption: p.reason ?? "" })),
    ];
    const removePhotoPromptKeys = Object.keys(prefill.photos ?? {}).filter((k) => !photos[k]);
    // Checklist "No" alerts + "photo not available" alerts — both notify the supervisor.
    const needsPayload = [
      ...alertKeys.map((itemKey) => ({ itemKey, label: labelFor(itemKey), request: comments[itemKey]?.trim() || labelFor(itemKey) || "Attention needed" })),
      ...[...naAlertOn].filter((k) => photos[k]?.notAvailable).map((k) => ({ itemKey: `photo_${k}`, label: `Photo: ${photoLabelFor(k)}`, request: photos[k]?.reason?.trim() || `No ${photoLabelFor(k).toLowerCase()} available` })),
    ];
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
          <IconCheck className="h-6 w-6" />
          <h2 className="text-lg font-semibold">Inspection saved</h2>
        </div>
        <p className="mt-2 text-sm text-muted">Grade <span className="font-semibold text-ink">{live.grade}</span> ({live.score}/{live.maxScore}, {live.scorePct}%).{critFails.length ? ` ${critFails.length} critical item flagged.` : ""}</p>
        {alertKeys.length > 0 ? <p className="mt-1 text-sm text-amber-700">{alertKeys.length} alert{alertKeys.length === 1 ? "" : "s"} sent to the supervisor.</p> : null}
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

      {/* Quick-start + live progress. Most inspections pass, so lead with the one-tap path. */}
      <Card className="p-4 bg-card-grad">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="text-sm font-semibold text-ink">Walk the warehouse, tap as you go</div>
            <p className="mt-0.5 text-xs text-muted">Most items pass — tap <span className="font-medium text-ink">Mark all passing</span> to fill the checklist, then flip anything that failed to <span className="font-medium text-red-600">No</span> and add a note.</p>
          </div>
          <button onClick={() => markAllPassing("all")} className={`${btn.secondary} shrink-0`}>
            <IconCheck className="h-4 w-4 text-emerald-600" /> Mark all passing
          </button>
        </div>
        <div className="mt-3">
          <div className="flex items-center justify-between text-xs">
            <span className="font-medium text-ink">{answered} of {WAREHOUSE_ITEMS.length} answered</span>
            <span className="text-muted">{pct}%{noCount ? <span className="ml-2 font-medium text-red-600">{noCount} flagged No</span> : null}</span>
          </div>
          <div className="mt-1.5 h-2 w-full overflow-hidden rounded-full bg-slate-100">
            <div className={`h-full rounded-full transition-all ${answered === WAREHOUSE_ITEMS.length ? "bg-emerald-grad" : "bg-brand-400"}`} style={{ width: `${pct}%` }} />
          </div>
        </div>
      </Card>

      {WAREHOUSE_SECTIONS.map((sec, i) => {
        const st = sectionStats(sec.items);
        const open = !isCollapsed(sec.section);
        // Header accent: red when something failed, emerald when all passed, slate otherwise.
        const accent = st.no > 0 ? "border-l-red-400" : st.clean ? "border-l-emerald-400" : "border-l-slate-200";
        const dot = st.no > 0 ? "bg-red-500" : st.clean ? "bg-emerald-500" : st.answered > 0 ? "bg-brand-400" : "bg-slate-300";
        return (
          <Card key={sec.section} className={`overflow-hidden border-l-4 ${accent} p-0`}>
            <button type="button" onClick={() => toggleSection(sec.section)} className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-black/[0.015]">
              <span className={`grid h-6 w-6 shrink-0 place-items-center rounded-full text-[11px] font-semibold text-white ${dot}`}>
                {st.clean ? <IconCheck className="h-3.5 w-3.5" /> : st.no > 0 ? st.no : i + 1}
              </span>
              <span className="flex-1 min-w-0">
                <span className="block text-sm font-semibold text-ink">{sec.section}</span>
                <span className="block text-xs text-muted">
                  {st.answered}/{st.total} answered
                  {st.no > 0 ? <span className="ml-2 font-medium text-red-600">{st.no} issue{st.no === 1 ? "" : "s"}</span> : st.clean ? <span className="ml-2 font-medium text-emerald-700">all clear</span> : null}
                </span>
              </span>
              {!open && !st.complete ? (
                <span onClick={(e) => { e.stopPropagation(); markAllPassing(sec.section); }} className={`${btn.secondary} hidden sm:inline-flex !px-3 !py-1.5 text-xs`} role="button">All passing</span>
              ) : null}
              <IconChevron className={`h-4 w-4 shrink-0 text-muted transition-transform ${open ? "rotate-180" : ""}`} />
            </button>

            {open ? (
              <div className="space-y-2 border-t border-line px-3 py-3">
                <div className="flex justify-end">
                  <button type="button" onClick={() => markAllPassing(sec.section)} className="inline-flex items-center gap-1 text-xs font-medium text-brand-700 hover:underline">
                    <IconCheck className="h-3.5 w-3.5" /> Mark all passing in this section
                  </button>
                </div>
                {sec.items.map((it) => {
                  const val = checks[it.key];
                  const isNo = val === false;
                  const flagged = alertOn.has(it.key);
                  return (
                    <div key={it.key} className={`rounded-xl p-3 ${isNo ? "bg-red-50/60 ring-1 ring-red-200" : val === true ? "bg-emerald-50/40" : "bg-black/[0.015]"}`}>
                      <div className="flex items-center gap-3">
                        <div className="flex-1 text-sm text-ink">
                          {it.label}
                          {it.critical ? <span className="ml-2 rounded-full bg-red-50 px-1.5 py-0.5 text-[10px] font-medium text-red-600 align-middle">critical</span> : null}
                          {repeats.has(it.key) ? <span className="ml-2 rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-700 align-middle" title="Also failed the prior inspection">repeat</span> : null}
                        </div>
                        <div className="flex shrink-0 gap-1.5">
                          <button onClick={() => setAnswer(it.key, true)} aria-pressed={val === true} className={`inline-flex items-center gap-1 rounded-lg px-3.5 py-2 text-sm font-medium transition-colors ${val === true ? "bg-emerald-grad text-white shadow" : "bg-slate-100 text-slate-600 hover:bg-slate-200"}`}>
                            <IconCheck className="h-4 w-4" /> Yes
                          </button>
                          <button onClick={() => setAnswer(it.key, false)} aria-pressed={val === false} className={`inline-flex items-center gap-1 rounded-lg px-3.5 py-2 text-sm font-medium transition-colors ${val === false ? "bg-red-500 text-white shadow" : "bg-slate-100 text-slate-600 hover:bg-slate-200"}`}>
                            <IconX className="h-4 w-4" /> No
                          </button>
                        </div>
                      </div>
                      {isNo ? (
                        <div className="mt-2.5 space-y-2">
                          <textarea value={comments[it.key] ?? ""} onChange={(e) => setComments((s) => ({ ...s, [it.key]: e.target.value }))} rows={2} placeholder="What's wrong, what's needed, or corrective action (e.g. missing fire extinguisher — need a replacement)" className="w-full rounded-lg border border-red-200 bg-white px-3 py-2 text-sm" />
                          <label className="flex items-center gap-2 text-xs font-medium text-amber-800">
                            <input type="checkbox" checked={flagged} onChange={() => toggleAlert(it.key)} className="h-4 w-4" />
                            Create alert — notify supervisor
                          </label>
                          {flagged ? <p className="text-[11px] text-red-700">This note will be sent to the supervisor as an alert on save.</p> : null}
                        </div>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            ) : null}
          </Card>
        );
      })}

      {/* Guided compliance photos */}
      <div className="space-y-2">
        <div className="flex items-center justify-between pt-1">
          <div className="text-sm font-semibold text-ink">Compliance photos</div>
          <span className="text-[11px] text-muted">{requiredDone}/{requiredShot} required · {photoCount} total</span>
        </div>
        <p className="text-xs text-muted">Capture each so the record shows the branch was actually checked. Can&apos;t take one? Use <span className="font-medium text-amber-800">Not available</span> and say why.</p>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {WAREHOUSE_PHOTO_PROMPTS.map((p) => {
            const ph = photos[p.key];
            const src = ph?.dataUrl || ph?.url;
            const na = !!ph?.notAvailable;
            return (
              <Card key={p.key} className="p-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="text-sm font-medium text-ink">{p.label}{p.required ? <span className="ml-1 text-[10px] text-brand-600">required</span> : null}</div>
                    <div className="text-xs text-muted">{p.hint}</div>
                  </div>
                  {src || na ? <button onClick={() => removePhoto(p.key)} className="shrink-0 text-xs font-medium text-red-600 hover:underline">{na ? "Undo" : "Remove"}</button> : null}
                </div>

                {na ? (
                  <div className="mt-2 space-y-2 rounded-lg border border-amber-300 bg-amber-50 p-2">
                    <div className="text-xs font-semibold text-amber-900">Marked not available</div>
                    <textarea value={ph?.reason ?? ""} onChange={(e) => setPhotos((s) => ({ ...s, [p.key]: { ...(s[p.key] ?? { caption: "" }), notAvailable: true, reason: e.target.value } }))} rows={2} placeholder="Why isn't this available? e.g. no eyewash station on site" className="w-full rounded-lg border border-amber-300 bg-white px-2 py-1.5 text-xs" />
                    <label className="flex items-center gap-2 text-xs font-medium text-amber-800">
                      <input type="checkbox" checked={naAlertOn.has(p.key)} onChange={() => toggleNaAlert(p.key)} className="h-4 w-4" />
                      Create alert — notify supervisor
                    </label>
                    {naAlertOn.has(p.key) ? <p className="text-[11px] text-red-700">This will be sent to the supervisor as an alert on save.</p> : null}
                  </div>
                ) : src ? (
                  <>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={src} alt={p.label} className="mt-2 h-36 w-full rounded-lg object-cover" />
                    <input value={ph?.caption ?? ""} onChange={(e) => setPhotos((s) => ({ ...s, [p.key]: { ...(s[p.key] ?? {}), caption: e.target.value } }))} placeholder="Caption (optional)" className="mt-2 w-full rounded-lg border border-line px-2 py-1.5 text-xs" />
                  </>
                ) : (
                  <>
                    <label className="mt-2 flex h-24 cursor-pointer flex-col items-center justify-center gap-1 rounded-lg border border-dashed border-brand-300 text-xs font-medium text-brand-700 hover:bg-brand-50/50">
                      <IconCamera className="h-5 w-5" />
                      Take / upload photo
                      <input type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => e.target.files?.[0] && onPhoto(p.key, e.target.files[0])} />
                    </label>
                    <button type="button" onClick={() => markNotAvailable(p.key)} className="mt-2 inline-flex w-full items-center justify-center gap-1.5 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-800 hover:bg-amber-100">
                      <IconX className="h-3.5 w-3.5" /> Not available — explain why
                    </button>
                  </>
                )}
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
          <input type="checkbox" checked={certified} onChange={(e) => setCertified(e.target.checked)} className="mt-0.5 h-4 w-4" />
          I certify this inspection was completed accurately and the conditions recorded are true as of the inspection date.
        </label>
      </Card>

      {alertKeys.length > 0 ? (
        <Card className="p-3 ring-1 ring-amber-300 bg-amber-50">
          <div className="text-sm font-medium text-amber-900">{alertKeys.length} alert{alertKeys.length === 1 ? "" : "s"} will be sent to the supervisor on save:</div>
          <ul className="mt-1 list-disc pl-5 text-sm text-ink">
            {alertKeys.map((k) => <li key={k}>{labelFor(k) ? <span className="text-muted">{labelFor(k)}: </span> : null}{comments[k]?.trim() || "Needs attention"}</li>)}
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
              <div className="text-xs text-muted">{answered}/{WAREHOUSE_ITEMS.length} answered{critFails.length ? <span className="ml-2 text-red-600 font-medium">· {critFails.length} critical fail</span> : null}{alertKeys.length ? <span className="ml-2 text-amber-700 font-medium">· {alertKeys.length} alert{alertKeys.length === 1 ? "" : "s"}</span> : null}</div>
            </div>
          </div>
          <button onClick={save} disabled={busy} className={`${btn.primary} ml-auto`}>{busy ? "Saving…" : certified && sigName.trim() ? "Save & sign inspection" : isEdit ? "Update inspection" : "Save inspection"}</button>
        </div>
      </div>
    </div>
  );
}
