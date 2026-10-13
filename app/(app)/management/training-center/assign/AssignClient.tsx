"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Card, btn } from "@/components/ui";
import type { AssignmentPreview } from "@/lib/training-assign";
import type { EmployeePick, CoursePick } from "@/lib/training-center-types";
import type { Situation } from "@/lib/certifications";

type ModulePick = { code: string; name: string; certificationsEarned: string | null };

const ADVANCEMENT_PROGRAMS = new Set(["PRG-SLS", "PRG-MGT"]);

const fieldClass = "w-full rounded-lg border border-line px-3 py-2.5 text-sm bg-surface";

export default function AssignClient({
  employees,
  situations,
  modules,
  courses,
}: {
  employees: EmployeePick[];
  situations: Situation[];
  modules: ModulePick[];
  courses: CoursePick[];
}) {
  const [empId, setEmpId] = useState("");
  const [empQuery, setEmpQuery] = useState("");
  const [kind, setKind] = useState<"module" | "course">("module");
  const [moduleSource, setModuleSource] = useState<"situation" | "direct">("situation");
  const [situationIdx, setSituationIdx] = useState<string>("");
  const [moduleCode, setModuleCode] = useState("");
  const [courseCode, setCourseCode] = useState("");
  const [overridePacing, setOverridePacing] = useState(false);

  const [preview, setPreview] = useState<AssignmentPreview | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);

  const selectedEmp = employees.find((e) => e.id === empId) ?? null;
  const filteredEmps = useMemo(() => {
    const q = empQuery.trim().toLowerCase();
    if (!q) return employees.slice(0, 50);
    return employees.filter((e) => e.name.toLowerCase().includes(q) || (e.branch ?? "").toLowerCase().includes(q)).slice(0, 50);
  }, [employees, empQuery]);

  const sit = situationIdx === "" ? null : situations[Number(situationIdx)] ?? null;
  const isProgramSteps = kind === "module" && moduleSource === "situation" && sit?.mode === "program_steps";

  // Modules offered for a "pick" situation. pick_service / service_with_fc point at
  // the service-expansion modules (SVC-*); pick_module and direct offer all modules.
  // VERIFY: exact per-situation module sets aren't encoded in the guide, so this is
  // a reasonable filter — refine if the catalog later scopes modules per program.
  const offeredModules = useMemo(() => {
    if (kind !== "module") return [];
    if (moduleSource === "direct") return modules;
    if (!sit) return [];
    if (sit.mode === "pick_service" || sit.mode === "service_with_fc")
      return modules.filter((m) => m.code.startsWith("SVC-"));
    return modules; // pick_module
  }, [kind, moduleSource, sit, modules]);

  // Resolve the concrete assignment params from the current selections.
  function resolveParams(): {
    moduleCode?: string;
    programCode?: string;
    standaloneCourseCode?: string;
    advancement?: boolean;
  } | null {
    if (!empId) return null;
    if (kind === "course") return courseCode ? { standaloneCourseCode: courseCode } : null;
    // module
    if (moduleSource === "direct") return moduleCode ? { moduleCode } : null;
    // by situation
    if (!sit) return null;
    if (sit.mode === "module") return sit.moduleCode ? { moduleCode: sit.moduleCode, programCode: sit.programCode } : null;
    if (sit.mode === "program_steps") return { programCode: sit.programCode, advancement: true };
    // pick_module / pick_service / service_with_fc
    return moduleCode ? { moduleCode, programCode: sit.programCode } : null;
  }

  const params = resolveParams();
  const canPreview = !!params && !params.advancement;
  const readyToConfirm = !!params && (params.advancement || !!preview);

  function reset(clearEmp = false) {
    setPreview(null);
    setError(null);
    setResult(null);
    setOverridePacing(false);
    if (clearEmp) setEmpId("");
  }

  async function doPreview() {
    if (!params || params.advancement) return;
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch("/api/training-center/preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ employeeId: empId, ...params }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? "Preview failed.");
      setPreview(data.preview as AssignmentPreview);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  async function doConfirm() {
    if (!params) return;
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch("/api/training-center/assign", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ employeeId: empId, ...params, overridePacing }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? "Assignment failed.");
      if (data.advancement) {
        setResult(
          data.assignedModuleCode
            ? `Assigned the next advancement step: ${data.assignedModuleCode}.${data.skipped?.length ? ` Skipped already-complete: ${data.skipped.join(", ")}.` : ""}`
            : data.message ?? "Nothing to assign — all steps complete.",
        );
      } else {
        const certs = (data.preview?.certsEarned ?? []).map((c: { code: string }) => c.code);
        setResult(`Assignment created.${certs.length ? ` On completion earns: ${certs.join(", ")}.` : ""}`);
      }
      setPreview(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-5">
      {/* Step 1 — employee */}
      <Card className="p-4">
        <div className="mb-2 text-sm font-semibold text-ink">1 · Employee</div>
        {selectedEmp ? (
          <div className="flex items-center justify-between gap-3">
            <div>
              <span className="font-medium text-ink">{selectedEmp.name}</span>
              <span className="ml-2 text-xs text-muted">
                {[selectedEmp.role, selectedEmp.branch].filter(Boolean).join(" · ") || "—"}
              </span>
            </div>
            <div className="flex items-center gap-3">
              <Link
                href={`/management/training-center/employee/${selectedEmp.id}`}
                className="text-xs font-medium text-brand-700 hover:underline"
              >
                View record →
              </Link>
              <button
                type="button"
                className="text-xs font-medium text-muted hover:text-ink"
                onClick={() => {
                  setEmpId("");
                  reset();
                }}
              >
                Change
              </button>
            </div>
          </div>
        ) : (
          <>
            <input
              className={fieldClass}
              placeholder="Search employees by name or branch…"
              value={empQuery}
              onChange={(e) => setEmpQuery(e.target.value)}
            />
            <div className="mt-2 max-h-64 overflow-y-auto rounded-lg border border-line divide-y divide-line">
              {filteredEmps.length === 0 ? (
                <div className="px-3 py-3 text-sm text-muted">No matching active employees.</div>
              ) : (
                filteredEmps.map((e) => (
                  <button
                    key={e.id}
                    type="button"
                    className="flex w-full items-center justify-between gap-3 px-3 py-3 text-left hover:bg-black/[0.03]"
                    onClick={() => {
                      setEmpId(e.id);
                      reset();
                    }}
                  >
                    <span className="text-sm font-medium text-ink">{e.name}</span>
                    <span className="text-xs text-muted">{[e.role, e.branch].filter(Boolean).join(" · ")}</span>
                  </button>
                ))
              )}
            </div>
          </>
        )}
      </Card>

      {/* Step 2 — what to assign */}
      {selectedEmp ? (
        <Card className="p-4">
          <div className="mb-3 text-sm font-semibold text-ink">2 · What to assign</div>
          <div className="mb-4 flex flex-wrap gap-2">
            <TogglePill active={kind === "module"} onClick={() => { setKind("module"); reset(); }}>
              Assign a module
            </TogglePill>
            <TogglePill active={kind === "course"} onClick={() => { setKind("course"); reset(); }}>
              Assign a single course
            </TogglePill>
          </div>

          {kind === "module" ? (
            <div className="space-y-3">
              <div className="flex flex-wrap gap-2">
                <TogglePill active={moduleSource === "situation"} onClick={() => { setModuleSource("situation"); setPreview(null); }}>
                  By situation
                </TogglePill>
                <TogglePill active={moduleSource === "direct"} onClick={() => { setModuleSource("direct"); setPreview(null); }}>
                  Pick module directly
                </TogglePill>
              </div>

              {moduleSource === "situation" ? (
                <div>
                  <label className="mb-1 block text-xs font-medium text-muted">Situation (Assignment Guide)</label>
                  <select
                    className={fieldClass}
                    value={situationIdx}
                    onChange={(e) => {
                      setSituationIdx(e.target.value);
                      setModuleCode("");
                      setPreview(null);
                    }}
                  >
                    <option value="">— Select a situation —</option>
                    {situations.map((s, i) => (
                      <option key={i} value={i}>
                        {s.situation}
                      </option>
                    ))}
                  </select>
                  {sit?.note ? <p className="mt-1 text-xs text-muted">{sit.note}</p> : null}
                  {sit && (sit.mode === "pick_module" || sit.mode === "pick_service" || sit.mode === "service_with_fc") ? (
                    <div className="mt-3">
                      <label className="mb-1 block text-xs font-medium text-muted">Choose the module</label>
                      <ModuleSelect modules={offeredModules} value={moduleCode} onChange={(v) => { setModuleCode(v); setPreview(null); }} />
                    </div>
                  ) : null}
                  {sit?.mode === "module" && sit.moduleCode ? (
                    <p className="mt-2 text-sm text-ink">
                      Module: <span className="rounded-md bg-brand-50 px-1.5 py-0.5 text-[11px] font-semibold text-brand-700">{sit.moduleCode}</span>
                    </p>
                  ) : null}
                  {isProgramSteps ? (
                    <div className="mt-3 rounded-lg border border-sky-200 bg-sky-50 px-3 py-2.5 text-sm text-sky-900">
                      Advancement program <strong>{sit?.programCode}</strong>. The system will assign the next incomplete
                      step and skip any already complete. Confirm to assign it (no course-level preview for advancement).
                    </div>
                  ) : null}
                </div>
              ) : (
                <div>
                  <label className="mb-1 block text-xs font-medium text-muted">Module</label>
                  <ModuleSelect modules={modules} value={moduleCode} onChange={(v) => { setModuleCode(v); setPreview(null); }} />
                </div>
              )}
            </div>
          ) : (
            <div>
              <label className="mb-1 block text-xs font-medium text-muted">Single course (standalone — exempt from pacing)</label>
              <select
                className={fieldClass}
                value={courseCode}
                onChange={(e) => { setCourseCode(e.target.value); setPreview(null); }}
              >
                <option value="">— Select a course —</option>
                {courses.map((c) => (
                  <option key={c.code} value={c.code}>
                    {c.code} — {c.name} ({c.group})
                  </option>
                ))}
              </select>
            </div>
          )}

          <div className="mt-4 flex flex-wrap gap-2">
            {canPreview ? (
              <button type="button" className={btn.secondary} disabled={loading} onClick={doPreview}>
                {loading ? "Working…" : preview ? "Refresh preview" : "Preview"}
              </button>
            ) : null}
            {readyToConfirm ? (
              <button type="button" className={btn.primary} disabled={loading} onClick={doConfirm}>
                {loading ? "Working…" : "Confirm & assign"}
              </button>
            ) : null}
          </div>
        </Card>
      ) : null}

      {error ? (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
      ) : null}
      {result ? (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
          {result}{" "}
          {selectedEmp ? (
            <Link href={`/management/training-center/employee/${selectedEmp.id}`} className="font-medium underline">
              View {selectedEmp.name}&rsquo;s record →
            </Link>
          ) : null}
        </div>
      ) : null}

      {preview ? <PreviewPanel preview={preview} overridePacing={overridePacing} setOverridePacing={setOverridePacing} /> : null}
    </div>
  );
}

function TogglePill({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-full px-4 py-2 text-sm font-medium transition-colors ${
        active ? "bg-emerald-grad text-white shadow-sm" : "border border-line bg-white text-ink hover:bg-black/[0.03]"
      }`}
    >
      {children}
    </button>
  );
}

function ModuleSelect({
  modules,
  value,
  onChange,
}: {
  modules: ModulePick[];
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <select className={fieldClass} value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">— Select a module —</option>
      {modules.map((m) => (
        <option key={m.code} value={m.code}>
          {m.code} — {m.name}
          {m.certificationsEarned ? ` (earns ${m.certificationsEarned})` : ""}
        </option>
      ))}
    </select>
  );
}

function PreviewPanel({
  preview,
  overridePacing,
  setOverridePacing,
}: {
  preview: AssignmentPreview;
  overridePacing: boolean;
  setOverridePacing: (v: boolean) => void;
}) {
  return (
    <Card className="p-4">
      <div className="mb-3 flex items-center justify-between gap-2">
        <div className="text-sm font-semibold text-ink">Preview</div>
        <span className="text-xs text-muted">
          {preview.kind === "standalone"
            ? `Single course: ${preview.standaloneCourseCode}`
            : `${preview.moduleCode} — ${preview.moduleName}`}
        </span>
      </div>

      {preview.prereqAdded.length > 0 ? (
        <div className="mb-3 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2.5 text-sm text-amber-900">
          <div className="font-semibold">Prerequisite added</div>
          <div>{preview.prereqNote}</div>
          <div className="mt-1 text-xs">Added ahead: {preview.prereqAdded.join(", ")}</div>
        </div>
      ) : null}

      {preview.pacing.enabled && preview.pacing.blockedThisMonth ? (
        <div className="mb-3 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2.5 text-sm text-amber-900">
          <div className="font-semibold">Pacing: blocked this month</div>
          <div>
            This employee has already started a module this month (limit {preview.pacing.limit}/month). Earliest start{" "}
            {preview.pacing.earliestStartMonth} ({preview.pacing.earliestStartDate}).
          </div>
          <label className="mt-2 flex items-center gap-2 text-sm">
            <input type="checkbox" checked={overridePacing} onChange={(e) => setOverridePacing(e.target.checked)} />
            Override pacing and start now anyway
          </label>
        </div>
      ) : (
        <p className="mb-3 text-xs text-muted">
          Earliest start: {preview.pacing.earliestStartDate}
          {preview.pacing.enabled ? ` · pacing ${preview.pacing.limit}/month` : " · pacing off"}
        </p>
      )}

      <Section title={`Courses to complete (${preview.toComplete.length})`}>
        {preview.toComplete.length === 0 ? (
          <Muted>None — everything is already credited.</Muted>
        ) : (
          <ol className="space-y-1">
            {preview.toComplete.map((c) => (
              <li key={c.code} className="flex items-center gap-2 text-sm">
                <span className="w-6 text-right text-xs tabular-nums text-muted">{c.sequence}.</span>
                <span className="rounded-md bg-brand-50 px-1.5 py-0.5 text-[11px] font-semibold text-brand-700">{c.code}</span>
                <span className="text-ink">{c.name}</span>
                {c.courseType === "field_signoff" ? (
                  <span className="rounded-full bg-sky-100 px-2 py-0.5 text-[10px] font-medium text-sky-800">field sign-off</span>
                ) : null}
              </li>
            ))}
          </ol>
        )}
      </Section>

      {preview.credited.length > 0 ? (
        <Section title={`Credited (${preview.credited.length})`}>
          <ul className="space-y-1">
            {preview.credited.map((c) => (
              <li key={c.code} className="flex items-center gap-2 text-sm">
                <span className="rounded-md bg-emerald-50 px-1.5 py-0.5 text-[11px] font-semibold text-emerald-700">{c.code}</span>
                <span className="text-ink">{c.name}</span>
                {c.completedDate ? <span className="text-xs text-muted">completed {c.completedDate}</span> : null}
              </li>
            ))}
          </ul>
        </Section>
      ) : null}

      {preview.linked.length > 0 ? (
        <Section title={`Already in progress elsewhere (${preview.linked.length})`}>
          <ul className="space-y-1">
            {preview.linked.map((c) => (
              <li key={c.code} className="flex items-center gap-2 text-sm">
                <span className="rounded-md bg-slate-100 px-1.5 py-0.5 text-[11px] font-semibold text-slate-700">{c.code}</span>
                <span className="text-ink">{c.name}</span>
              </li>
            ))}
          </ul>
        </Section>
      ) : null}

      {preview.certsEarned.length > 0 ? (
        <Section title="Certifications this earns on completion">
          <div className="flex flex-wrap gap-2">
            {preview.certsEarned.map((c) => (
              <span key={c.code} className="inline-flex items-center gap-1.5 rounded-full bg-emerald-100 px-2.5 py-1 text-xs font-medium text-emerald-800">
                <span className="font-semibold">{c.code}</span> {c.name}
              </span>
            ))}
          </div>
        </Section>
      ) : null}
    </Card>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mt-3 border-t border-line pt-3 first:mt-0 first:border-0 first:pt-0">
      <div className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted">{title}</div>
      {children}
    </div>
  );
}

function Muted({ children }: { children: React.ReactNode }) {
  return <p className="text-sm text-muted">{children}</p>;
}
