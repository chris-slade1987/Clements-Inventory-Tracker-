"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Card, btn } from "@/components/ui";

type Status = "good" | "warn" | "alarm" | "info";

const STATUS_COLOR: Record<Status, string> = {
  good: "#1F7A45",
  warn: "#E3B23C",
  alarm: "#DC2626",
  info: "#5C6B62",
};
const STATUS_LABEL: Record<Status, string> = { good: "On track", warn: "Watch", alarm: "Action needed", info: "No data" };

// Statuses arrive from the server as plain strings (Prisma columns); coerce safely.
const st = (s: string | null | undefined): Status => (s && s in STATUS_COLOR ? (s as Status) : "info");

type Metric = { key: string; label: string; value: number | null; displayValue: string | null; unit: string | null; target: number | null; status: string };
type Item = { id: string; label: string; checked: boolean };
type Domain = { key: string; label: string; blurb: string; status: string; metrics: Metric[]; items: Item[]; itemsComplete: boolean };
type Tech = {
  id: string; techName: string; routeNo: string | null;
  production: number | null; productionTarget: number | null;
  stops: number | null; stopsPerDay: number | null;
  unserviced: number | null; cancellations: number | null; callbacks: number | null; callbackRate: number | null;
  status: string; reviewed: boolean; managerNote: string | null;
};
type Finding = { id: string; domain: string; severity: string; title: string; detail: string; question: string | null; techName: string | null; requiresResponse: boolean; managerResponse: string | null; status: string };
type Gate = { openFindings: number; unreviewedTechs: number; uncheckedItems: number; openLeftBehind?: number; canSign: boolean };

type Data = {
  branch: string;
  periodLabel: string;
  status: string;
  scoreboard: Domain[];
  techWeeks: Tech[];
  findings: Finding[];
  gate: Gate;
  signedName: string | null;
  signedAt: string | null;
};

function fmt(m: { value: number | null; displayValue: string | null; unit: string | null }): string {
  if (m.displayValue) return m.displayValue;
  if (m.value == null) return "—";
  if (m.unit === "$") return `$${Math.round(m.value).toLocaleString()}`;
  if (m.unit === "%") return `${Math.round(m.value)}%`;
  if (m.unit === "per_day") return m.value.toFixed(1);
  return m.value.toLocaleString();
}

function Chip({ status }: { status: Status }) {
  const c = STATUS_COLOR[status];
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium"
      style={{ color: c, backgroundColor: `${c}1A`, border: `1px solid ${c}40` }}
    >
      <span aria-hidden className="h-2 w-2 rounded-full" style={{ backgroundColor: c }} />
      {STATUS_LABEL[status]}
    </span>
  );
}

export default function BranchCommandBoard({ data }: { data: Data }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const signed = data.status === "signed";

  async function post(payload: Record<string, unknown>, tag: string) {
    setBusy(tag);
    setErr(null);
    try {
      const res = await fetch("/api/branch-command", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ branch: data.branch, ...payload }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) {
        setErr(j.error || "Something went wrong.");
        return false;
      }
      router.refresh();
      return true;
    } catch (e) {
      setErr((e as Error).message);
      return false;
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-5">
      {signed ? (
        <Card className="p-4" style={{ borderColor: `${STATUS_COLOR.good}55` }}>
          <p className="text-sm text-ink">
            <strong>Signed</strong> by {data.signedName}
            {data.signedAt ? ` on ${new Date(data.signedAt).toLocaleString("en-US", { timeZone: "America/New_York" })}` : ""}. This
            week is locked as the record.
          </p>
        </Card>
      ) : null}

      {err ? <p className="text-sm text-red-700">{err}</p> : null}

      {/* Scoreboard */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {data.scoreboard.map((d) => (
          <Card key={d.key} className="p-5">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <h3 className="text-lg font-light text-ink">{d.label}</h3>
                <p className="mt-0.5 text-xs text-muted">{d.blurb}</p>
              </div>
              <Chip status={st(d.status)} />
            </div>

            {d.metrics.length ? (
              <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3">
                {d.metrics.map((m) => (
                  <MetricCell key={m.key} branch={data.branch} metric={m} signed={signed} onSaved={() => router.refresh()} />
                ))}
              </dl>
            ) : d.key === "technician" ? (
              <p className="mt-4 text-xs text-muted">Reviewed per technician below.</p>
            ) : null}

            {d.items.length ? (
              <ul className="mt-4 space-y-2 border-t border-line pt-3">
                {d.items.map((it) => (
                  <li key={it.id} className="flex items-start gap-2">
                    <input
                      type="checkbox"
                      checked={it.checked}
                      disabled={signed || busy !== null}
                      onChange={(e) => post({ action: "check", itemId: it.id, checked: e.target.checked }, `chk-${it.id}`)}
                      className="mt-0.5 h-4 w-4 shrink-0 accent-[#1F7A45]"
                    />
                    <span className={`text-sm ${it.checked ? "text-ink" : "text-muted"}`}>{it.label}</span>
                  </li>
                ))}
              </ul>
            ) : null}
          </Card>
        ))}
      </div>

      {/* AI findings — forced feedback */}
      <Card className="p-5">
        <h3 className="text-lg font-light text-ink">Flags to explain</h3>
        <p className="mt-0.5 text-xs text-muted">
          Each flagged item needs a written explanation before you can sign. Your answers help Canopy learn your branch.
        </p>
        {data.findings.length === 0 ? (
          <p className="mt-4 text-sm text-muted">No flags this week. Once weekly reports are loaded, Canopy will surface anything off-pace here.</p>
        ) : (
          <div className="mt-4 space-y-3">
            {data.findings.map((f) => (
              <FindingRow key={f.id} branch={data.branch} finding={f} signed={signed} busy={busy} post={post} />
            ))}
          </div>
        )}
      </Card>

      {/* Per-technician review */}
      <Card className="p-5">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h3 className="text-lg font-light text-ink">Technician review</h3>
            <p className="mt-0.5 text-xs text-muted">Confirm you’ve reviewed each tech’s week. Add a note where something’s off.</p>
          </div>
        </div>
        {data.techWeeks.length === 0 ? (
          <p className="mt-4 text-sm text-muted">No technician rows yet — they’ll populate from the weekly route/production report.</p>
        ) : (
          <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2">
            {data.techWeeks.map((t) => (
              <TechCard key={t.id} branch={data.branch} tech={t} signed={signed} busy={busy} post={post} />
            ))}
          </div>
        )}
        {!signed ? <AddTech post={post} busy={busy} /> : null}
      </Card>

      {/* Sign-off */}
      <SignBar data={data} signed={signed} busy={busy} post={post} />
    </div>
  );
}

function MetricCell({
  branch,
  metric,
  signed,
  onSaved,
}: {
  branch: string;
  metric: Metric;
  signed: boolean;
  onSaved: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [val, setVal] = useState(metric.value != null ? String(metric.value) : "");
  const [saving, setSaving] = useState(false);
  const c = STATUS_COLOR[st(metric.status)];

  async function save() {
    setSaving(true);
    try {
      await fetch("/api/branch-command", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ branch, action: "setMetric", key: metric.key, value: val }),
      });
      setEditing(false);
      onSaved();
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      <dt className="text-xs text-muted">{metric.label}</dt>
      {editing ? (
        <div className="mt-1 flex items-center gap-1">
          <input
            autoFocus
            value={val}
            onChange={(e) => setVal(e.target.value)}
            inputMode="decimal"
            className="w-20 rounded border border-line px-1.5 py-0.5 text-sm"
          />
          <button onClick={save} disabled={saving} className="text-xs font-medium text-brand-700">
            {saving ? "…" : "Save"}
          </button>
          <button onClick={() => setEditing(false)} className="text-xs text-muted">
            Cancel
          </button>
        </div>
      ) : (
        <dd className="mt-0.5 flex items-baseline gap-2">
          <span className="text-base tabular-nums text-ink" style={{ color: metric.status === "info" ? undefined : c }}>
            {fmt(metric)}
          </span>
          {metric.target != null ? <span className="text-[11px] text-muted">target {metric.unit === "$" ? `$${metric.target.toLocaleString()}` : metric.target}{metric.unit === "%" ? "%" : ""}</span> : null}
          {!signed ? (
            <button onClick={() => setEditing(true)} className="text-[11px] text-muted underline hover:text-ink">
              edit
            </button>
          ) : null}
        </dd>
      )}
    </div>
  );
}

function FindingRow({
  finding: f,
  signed,
  busy,
  post,
}: {
  branch: string;
  finding: Finding;
  signed: boolean;
  busy: string | null;
  post: (p: Record<string, unknown>, tag: string) => Promise<boolean>;
}) {
  const [resp, setResp] = useState(f.managerResponse ?? "");
  const c = STATUS_COLOR[st(f.severity)] ?? STATUS_COLOR.warn;
  const answered = f.status === "answered";

  return (
    <div className="rounded-lg border p-3" style={{ borderColor: `${c}40`, backgroundColor: `${c}0D` }}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-medium text-ink">{f.title}</p>
          <p className="mt-0.5 text-xs text-muted">{f.detail}</p>
        </div>
        {answered ? <span className="shrink-0 text-xs font-medium" style={{ color: STATUS_COLOR.good }}>Answered</span> : null}
      </div>
      {f.question ? <p className="mt-2 text-sm text-ink">{f.question}</p> : null}
      {!signed ? (
        <div className="mt-2 flex flex-col gap-2 sm:flex-row">
          <textarea
            value={resp}
            onChange={(e) => setResp(e.target.value)}
            placeholder="Explain what happened and what you're doing about it…"
            rows={2}
            className="flex-1 rounded-lg border border-line px-2 py-1.5 text-sm"
          />
          <button
            onClick={() => post({ action: "respondFinding", findingId: f.id, response: resp }, `fnd-${f.id}`)}
            disabled={busy !== null || resp.trim().length === 0}
            className={`${btn.secondary} self-start`}
          >
            {busy === `fnd-${f.id}` ? "Saving…" : answered ? "Update" : "Submit"}
          </button>
        </div>
      ) : f.managerResponse ? (
        <p className="mt-2 text-sm text-ink"><span className="text-muted">Response:</span> {f.managerResponse}</p>
      ) : null}
    </div>
  );
}

function TechCard({
  tech: t,
  signed,
  busy,
  post,
}: {
  branch: string;
  tech: Tech;
  signed: boolean;
  busy: string | null;
  post: (p: Record<string, unknown>, tag: string) => Promise<boolean>;
}) {
  const [note, setNote] = useState(t.managerNote ?? "");
  const c = STATUS_COLOR[st(t.status)];
  const pace = t.production != null && t.productionTarget ? Math.round((t.production / t.productionTarget) * 100) : null;

  return (
    <div className="rounded-lg border border-line p-3">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-sm font-medium text-ink">{t.techName}{t.routeNo ? ` · Route ${t.routeNo}` : ""}</p>
          <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-muted">
            {t.production != null ? <span>Prod ${Math.round(t.production).toLocaleString()}{pace != null ? ` (${pace}%)` : ""}</span> : null}
            {t.stopsPerDay != null ? <span>{t.stopsPerDay.toFixed(1)} stops/day</span> : null}
            {t.unserviced != null ? <span>{t.unserviced} unserviced</span> : null}
            {t.cancellations != null ? <span>{t.cancellations} cancels</span> : null}
            {t.callbackRate != null ? <span>{t.callbackRate}% callbacks</span> : null}
          </div>
        </div>
        <span aria-hidden className="mt-1 h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: c }} />
      </div>
      {!signed ? (
        <>
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            onBlur={() => note !== (t.managerNote ?? "") && post({ action: "reviewTech", techWeekId: t.id, reviewed: t.reviewed, note }, `twn-${t.id}`)}
            placeholder="Note (optional)…"
            className="mt-2 w-full rounded-lg border border-line px-2 py-1 text-sm"
          />
          <label className="mt-2 flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={t.reviewed}
              disabled={busy !== null}
              onChange={(e) => post({ action: "reviewTech", techWeekId: t.id, reviewed: e.target.checked, note }, `twr-${t.id}`)}
              className="h-4 w-4 accent-[#1F7A45]"
            />
            <span className={t.reviewed ? "text-ink" : "text-muted"}>Reviewed</span>
          </label>
        </>
      ) : (
        <p className="mt-2 text-xs text-muted">{t.reviewed ? "Reviewed" : "Not reviewed"}{t.managerNote ? ` — ${t.managerNote}` : ""}</p>
      )}
    </div>
  );
}

function AddTech({ post, busy }: { post: (p: Record<string, unknown>, tag: string) => Promise<boolean>; busy: string | null }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [production, setProduction] = useState("");
  const [target, setTarget] = useState("");
  const [callbackRate, setCallbackRate] = useState("");

  if (!open)
    return (
      <button onClick={() => setOpen(true)} className="mt-3 text-sm font-medium text-brand-700">
        + Add technician
      </button>
    );

  return (
    <div className="mt-3 flex flex-wrap items-end gap-2 border-t border-line pt-3">
      <Field label="Name" v={name} set={setName} w="w-40" />
      <Field label="Production $" v={production} set={setProduction} w="w-28" />
      <Field label="Target $" v={target} set={setTarget} w="w-28" />
      <Field label="Callback %" v={callbackRate} set={setCallbackRate} w="w-24" />
      <button
        onClick={async () => {
          const ok = await post(
            { action: "addTech", techName: name, production, productionTarget: target, callbackRate },
            "addtech",
          );
          if (ok) {
            setName(""); setProduction(""); setTarget(""); setCallbackRate(""); setOpen(false);
          }
        }}
        disabled={busy !== null || name.trim() === ""}
        className={btn.secondary}
      >
        {busy === "addtech" ? "Adding…" : "Add"}
      </button>
      <button onClick={() => setOpen(false)} className="text-sm text-muted">
        Cancel
      </button>
    </div>
  );
}

function Field({ label, v, set, w }: { label: string; v: string; set: (s: string) => void; w: string }) {
  return (
    <label className="text-xs text-muted">
      <span className="block">{label}</span>
      <input value={v} onChange={(e) => set(e.target.value)} className={`mt-0.5 ${w} rounded border border-line px-1.5 py-1 text-sm`} />
    </label>
  );
}

function SignBar({
  data,
  signed,
  busy,
  post,
}: {
  data: Data;
  signed: boolean;
  busy: string | null;
  post: (p: Record<string, unknown>, tag: string) => Promise<boolean>;
}) {
  const [name, setName] = useState("");
  if (signed) return null;
  const g = data.gate;
  const blockers: string[] = [];
  if (g.openFindings) blockers.push(`${g.openFindings} flag${g.openFindings === 1 ? "" : "s"} to explain`);
  if (g.unreviewedTechs) blockers.push(`${g.unreviewedTechs} technician${g.unreviewedTechs === 1 ? "" : "s"} to review`);
  if (g.uncheckedItems) blockers.push(`${g.uncheckedItems} item${g.uncheckedItems === 1 ? "" : "s"} to check off`);
  if (g.openLeftBehind) blockers.push(`${g.openLeftBehind} job${g.openLeftBehind === 1 ? "" : "s"} left behind to address`);

  return (
    <Card className="p-5 copilot-safe-actions">
      <h3 className="text-lg font-light text-ink">Sign the week</h3>
      {blockers.length ? (
        <p className="mt-1 text-sm text-muted">
          Before you can sign: <span className="text-ink">{blockers.join(" · ")}</span>.
        </p>
      ) : (
        <p className="mt-1 text-sm" style={{ color: STATUS_COLOR.good }}>
          Everything’s reviewed. Type your name to sign off on the week.
        </p>
      )}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Type your full name"
          disabled={!g.canSign}
          className="w-56 rounded-lg border border-line px-2.5 py-2 text-sm disabled:opacity-50"
        />
        <button
          onClick={() => post({ action: "sign", signedName: name }, "sign")}
          disabled={!g.canSign || busy !== null || name.trim() === ""}
          className={btn.primary}
        >
          {busy === "sign" ? "Signing…" : "Attest & sign"}
        </button>
      </div>
    </Card>
  );
}
