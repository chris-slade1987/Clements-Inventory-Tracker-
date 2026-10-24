"use client";
import { useEffect, useState } from "react";
import { Card, btn } from "@/components/ui";

// Admin settings for Weather Ops. Everything here is CONFIG — thresholds, forecast
// points, and the fertilizer blackout calendar. It never touches forecast data.

const BRANCHES = [
  { key: "vero", label: "Vero Beach" },
  { key: "stuart", label: "Stuart" },
  { key: "orlando", label: "Orlando" },
  { key: "naples", label: "Naples" },
];
const branchLabel = (k: string) => BRANCHES.find((b) => b.key === k)?.label ?? k;

const THRESHOLD_FIELDS: { key: string; label: string; step: string }[] = [
  { key: "rainPopPct", label: "Rain window — precip probability (%)", step: "1" },
  { key: "heavyRainIn", label: "Heavy rain — inches in 24h", step: "0.1" },
  { key: "windCautionMph", label: "Wind caution — sustained (mph)", step: "1" },
  { key: "windGustCautionMph", label: "Wind caution — gusts (mph)", step: "1" },
  { key: "windNoSprayMph", label: "Hold liquid spray — sustained (mph)", step: "1" },
  { key: "heatHighF", label: "High heat — heat index (°F)", step: "1" },
  { key: "heatExtremeF", label: "Extreme heat — heat index (°F)", step: "1" },
];

type Loc = { id: string; branch: string; name: string; lat: number; lon: number; active: boolean; gridResolved: boolean; radarStation: string | null };
type Blackout = { id: string; branch: string; startMonthDay: string; endMonthDay: string; note: string | null };
type Data = { thresholds: Record<string, number>; defaults: Record<string, number>; locations: Loc[]; blackouts: Blackout[] };

export default function WeatherSettingsClient() {
  const [data, setData] = useState<Data | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [thresholds, setThresholds] = useState<Record<string, string>>({});

  async function load() {
    const r = await fetch("/api/weather/settings");
    if (!r.ok) { setErr("Could not load settings."); return; }
    const j = (await r.json()) as Data;
    setData(j);
    setThresholds(Object.fromEntries(Object.entries(j.thresholds).map(([k, v]) => [k, String(v)])));
  }
  useEffect(() => { load(); }, []);

  async function post(payload: Record<string, unknown>) {
    setBusy(true); setErr(null);
    try {
      const r = await fetch("/api/weather/settings", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) { setErr(j.error ?? "Save failed."); return false; }
      await load();
      return true;
    } finally { setBusy(false); }
  }

  if (err && !data) return <Card className="p-6 text-sm text-red-600">{err}</Card>;
  if (!data) return <Card className="p-6 text-sm text-muted">Loading settings…</Card>;

  return (
    <div className="space-y-5">
      {err && <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{err}</div>}

      {/* Thresholds */}
      <Card className="p-5">
        <div className="text-[11px] uppercase tracking-wide text-muted">Rule thresholds</div>
        <p className="mt-0.5 text-xs text-muted">These drive the deterministic flags and risk level. Blank or 0-length resets a field to the default on save.</p>
        <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
          {THRESHOLD_FIELDS.map((f) => (
            <label key={f.key} className="text-sm">
              <span className="text-muted">{f.label}</span>
              <div className="mt-1 flex items-center gap-2">
                <input
                  type="number" step={f.step} value={thresholds[f.key] ?? ""}
                  onChange={(e) => setThresholds((t) => ({ ...t, [f.key]: e.target.value }))}
                  className="w-32 rounded-lg border border-line px-2 py-1.5 tabular-nums"
                />
                <span className="text-[11px] text-muted">default {data.defaults[f.key]}</span>
              </div>
            </label>
          ))}
        </div>
        <div className="mt-3 flex gap-2">
          <button disabled={busy} className={btn.primary} onClick={() => post({ action: "saveThresholds", thresholds: numify(thresholds) })}>Save thresholds</button>
          <button disabled={busy} className={btn.secondary} onClick={() => setThresholds(Object.fromEntries(Object.entries(data.defaults).map(([k, v]) => [k, String(v)])))}>Reset to defaults</button>
        </div>
      </Card>

      {/* Locations */}
      <Card className="p-5">
        <div className="text-[11px] uppercase tracking-wide text-muted">Forecast locations</div>
        <p className="mt-0.5 text-xs text-muted">Grid data is resolved from NWS on first fetch. Moving a point re-resolves it. A territory&apos;s risk is the worst across its points.</p>
        <div className="mt-3 space-y-2">
          {data.locations.map((l) => <LocationRow key={l.id} loc={l} busy={busy} post={post} />)}
          {data.locations.length === 0 && <p className="text-sm text-muted">No locations yet.</p>}
        </div>
        <AddLocation busy={busy} post={post} />
      </Card>

      {/* Blackouts */}
      <Card className="p-5">
        <div className="text-[11px] uppercase tracking-wide text-muted">Fertilizer blackout calendar</div>
        <p className="mt-0.5 text-xs text-muted">Per-territory, reminder-only (never a hard block). Enter dates after checking each county ordinance. Dates are MM-DD and recur yearly.</p>
        <div className="mt-3 space-y-2">
          {data.blackouts.map((b) => (
            <div key={b.id} className="flex flex-wrap items-center gap-2 rounded-lg border border-line px-3 py-2 text-sm">
              <span className="font-medium">{branchLabel(b.branch)}</span>
              <span className="tabular-nums text-muted">{b.startMonthDay} → {b.endMonthDay}</span>
              {b.note && <span className="text-muted">· {b.note}</span>}
              <button disabled={busy} onClick={() => post({ action: "deleteBlackout", id: b.id })} className="ml-auto text-xs text-red-600 hover:underline">Remove</button>
            </div>
          ))}
          {data.blackouts.length === 0 && <p className="text-sm text-muted">No blackout windows set.</p>}
        </div>
        <AddBlackout busy={busy} post={post} />
      </Card>
    </div>
  );
}

function numify(t: Record<string, string>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(t)) { const n = parseFloat(v); if (Number.isFinite(n)) out[k] = n; }
  return out;
}

function LocationRow({ loc, busy, post }: { loc: Loc; busy: boolean; post: (p: Record<string, unknown>) => Promise<boolean> }) {
  const [name, setName] = useState(loc.name);
  const [lat, setLat] = useState(String(loc.lat));
  const [lon, setLon] = useState(String(loc.lon));
  const dirty = name !== loc.name || lat !== String(loc.lat) || lon !== String(loc.lon);
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-lg border border-line px-3 py-2 text-sm">
      <span className="w-20 shrink-0 text-xs font-medium text-muted">{branchLabel(loc.branch)}</span>
      <input value={name} onChange={(e) => setName(e.target.value)} className="min-w-[8rem] flex-1 rounded-lg border border-line px-2 py-1" />
      <input value={lat} onChange={(e) => setLat(e.target.value)} className="w-24 rounded-lg border border-line px-2 py-1 tabular-nums" />
      <input value={lon} onChange={(e) => setLon(e.target.value)} className="w-24 rounded-lg border border-line px-2 py-1 tabular-nums" />
      <span className="text-[11px] text-muted">{loc.gridResolved ? loc.radarStation ?? "grid ✓" : "pending"}</span>
      <button disabled={busy || !dirty} onClick={() => post({ action: "updateLocation", id: loc.id, name, lat, lon })} className="text-xs text-brand-600 hover:underline disabled:opacity-40">Save</button>
      <button disabled={busy} onClick={() => post({ action: "updateLocation", id: loc.id, active: !loc.active })} className="text-xs text-muted hover:underline">{loc.active ? "Disable" : "Enable"}</button>
      <button disabled={busy} onClick={() => post({ action: "deleteLocation", id: loc.id })} className="text-xs text-red-600 hover:underline">Remove</button>
    </div>
  );
}

function AddLocation({ busy, post }: { busy: boolean; post: (p: Record<string, unknown>) => Promise<boolean> }) {
  const [branch, setBranch] = useState("vero");
  const [name, setName] = useState("");
  const [lat, setLat] = useState("");
  const [lon, setLon] = useState("");
  return (
    <div className="mt-3 flex flex-wrap items-end gap-2 border-t border-line pt-3">
      <label className="text-xs text-muted">Branch
        <select value={branch} onChange={(e) => setBranch(e.target.value)} className="mt-1 block rounded-lg border border-line px-2 py-1.5 text-sm">
          {BRANCHES.map((b) => <option key={b.key} value={b.key}>{b.label}</option>)}
        </select>
      </label>
      <input placeholder="Name" value={name} onChange={(e) => setName(e.target.value)} className="rounded-lg border border-line px-2 py-1.5 text-sm" />
      <input placeholder="Lat" value={lat} onChange={(e) => setLat(e.target.value)} className="w-24 rounded-lg border border-line px-2 py-1.5 text-sm tabular-nums" />
      <input placeholder="Lon" value={lon} onChange={(e) => setLon(e.target.value)} className="w-24 rounded-lg border border-line px-2 py-1.5 text-sm tabular-nums" />
      <button disabled={busy || !lat || !lon} className={btn.secondary} onClick={async () => { if (await post({ action: "addLocation", branch, name, lat, lon })) { setName(""); setLat(""); setLon(""); } }}>Add location</button>
    </div>
  );
}

function AddBlackout({ busy, post }: { busy: boolean; post: (p: Record<string, unknown>) => Promise<boolean> }) {
  const [branch, setBranch] = useState("vero");
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [note, setNote] = useState("");
  return (
    <div className="mt-3 flex flex-wrap items-end gap-2 border-t border-line pt-3">
      <label className="text-xs text-muted">Branch
        <select value={branch} onChange={(e) => setBranch(e.target.value)} className="mt-1 block rounded-lg border border-line px-2 py-1.5 text-sm">
          {BRANCHES.map((b) => <option key={b.key} value={b.key}>{b.label}</option>)}
        </select>
      </label>
      <input placeholder="Start MM-DD" value={start} onChange={(e) => setStart(e.target.value)} className="w-28 rounded-lg border border-line px-2 py-1.5 text-sm tabular-nums" />
      <input placeholder="End MM-DD" value={end} onChange={(e) => setEnd(e.target.value)} className="w-28 rounded-lg border border-line px-2 py-1.5 text-sm tabular-nums" />
      <input placeholder="Note (optional)" value={note} onChange={(e) => setNote(e.target.value)} className="flex-1 rounded-lg border border-line px-2 py-1.5 text-sm" />
      <button disabled={busy || !start || !end} className={btn.secondary} onClick={async () => { if (await post({ action: "addBlackout", branch, startMonthDay: start, endMonthDay: end, note })) { setStart(""); setEnd(""); setNote(""); } }}>Add window</button>
    </div>
  );
}
