"use client";

import { useCallback, useId, useMemo, useState } from "react";

// Offline, dependency-light lead heat map. Map tiles aren't reachable in this
// environment (no key, outbound blocked), so instead of a tile map we render an
// SVG density visualization: each neighborhood/zip cluster is a soft blurred blob
// sized by lead volume and colored by funnel stage, with a crisp labeled marker
// on top. Color-coded by stage (lead → proposal → closed) with a stage filter so
// the director can isolate pending leads by stage. Renders fully from demo data
// and reads well on a phone.

export type HeatClusterView = {
  key: string; area: string; branch: string | null;
  lat: number; lng: number;
  total: number; lead: number; proposal: number; closed: number;
  value: number; closedValue: number; closeRate: number;
  dominant: "lead" | "proposal" | "closed";
};

type Stage = "all" | "lead" | "proposal" | "closed";
const STAGE_COLOR: Record<string, string> = { lead: "#d9972b", proposal: "#2563c9", closed: "#2e6f47" };
const STAGE_LABEL: Record<string, string> = { lead: "Lead", proposal: "Proposal", closed: "Closed" };

const W = 720, H = 560, PAD = 54;
const money = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;
const toRad = (d: number) => (d * Math.PI) / 180;

export default function LeadHeatMap({
  clusters, totals,
}: {
  clusters: HeatClusterView[];
  totals: { leads: number; proposals: number; closed: number; total: number; closedValue: number; closeRate: number };
}) {
  const uid = useId().replace(/[:]/g, "");
  const [stage, setStage] = useState<Stage>("all");
  const [selected, setSelected] = useState<string | null>(null);

  // Project lat/lng → SVG coords, preserving geographic aspect (cos-lat on lng),
  // fit-to-box with letterboxing so a single cluster or a wide spread both read.
  const projected = useMemo(() => {
    if (clusters.length === 0) return [];
    const lats = clusters.map((c) => c.lat);
    const midLat = (Math.min(...lats) + Math.max(...lats)) / 2;
    const cos = Math.cos(toRad(midLat)) || 1;
    const xs = clusters.map((c) => c.lng * cos);
    const ys = clusters.map((c) => c.lat);
    let minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
    // Guard a near-zero span (one cluster / tight group) so blobs aren't gigantic.
    const spanX = Math.max(maxX - minX, 0.04), spanY = Math.max(maxY - minY, 0.04);
    const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
    minX = cx - spanX / 2; maxX = cx + spanX / 2; minY = cy - spanY / 2; maxY = cy + spanY / 2;
    const innerW = W - PAD * 2, innerH = H - PAD * 2;
    const scale = Math.min(innerW / (maxX - minX), innerH / (maxY - minY)) * 0.86;
    const offX = (W - (maxX - minX) * scale) / 2;
    const offY = (H - (maxY - minY) * scale) / 2;
    return clusters.map((c) => ({
      c,
      x: offX + (c.lng * cos - minX) * scale,
      y: H - (offY + (c.lat - minY) * scale), // invert: higher lat = higher on screen
    }));
  }, [clusters]);

  const count = useCallback((c: HeatClusterView) => (stage === "all" ? c.total : c[stage]), [stage]);
  const maxCount = useMemo(() => projected.reduce((m, p) => Math.max(m, count(p.c)), 0) || 1, [projected, count]);
  const visible = projected.filter((p) => count(p.c) > 0);
  const sel = selected ? clusters.find((c) => c.key === selected) ?? null : null;

  // Blob radius ∝ sqrt(count), 26–96px.
  const radius = (c: HeatClusterView) => 26 + Math.sqrt(count(c) / maxCount) * 70;
  const blobColor = (c: HeatClusterView) => (stage === "all" ? STAGE_COLOR[c.dominant] : STAGE_COLOR[stage]);

  if (clusters.length === 0) {
    return (
      <div className="rounded-xl border border-line bg-surface p-8 text-center">
        <div className="text-sm font-medium text-ink">No mapped leads in this range</div>
        <div className="mt-1 text-xs text-muted">Leads with an address will plot here. Load sample data or adjust the date range.</div>
      </div>
    );
  }

  return (
    <div>
      {/* stage filter + legend */}
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <StageChip active={stage === "all"} onClick={() => setStage("all")} dot={null} label="All stages" />
        {(["lead", "proposal", "closed"] as const).map((s) => (
          <StageChip key={s} active={stage === s} onClick={() => setStage(s)} dot={STAGE_COLOR[s]} label={STAGE_LABEL[s]} />
        ))}
      </div>

      <div className="overflow-hidden rounded-xl border border-line bg-[#eef3ef]">
        <svg viewBox={`0 0 ${W} ${H}`} className="block h-auto w-full" style={{ maxHeight: 520 }} role="img" aria-label="Lead density by neighborhood">
          <defs>
            <filter id={`blur-${uid}`} x="-50%" y="-50%" width="200%" height="200%">
              <feGaussianBlur stdDeviation="18" />
            </filter>
            <pattern id={`grid-${uid}`} width="48" height="48" patternUnits="userSpaceOnUse">
              <path d="M48 0H0V48" fill="none" stroke="rgba(11,61,32,0.06)" strokeWidth="1" />
            </pattern>
          </defs>
          <rect x="0" y="0" width={W} height={H} fill={`url(#grid-${uid})`} />

          {/* soft heat blobs (blurred) */}
          <g filter={`url(#blur-${uid})`} opacity={0.72}>
            {visible.map((p) => (
              <circle key={`b-${p.c.key}`} cx={p.x} cy={p.y} r={radius(p.c)} fill={blobColor(p.c)} opacity={0.3 + 0.5 * (count(p.c) / maxCount)} />
            ))}
          </g>

          {/* crisp markers + labels */}
          {visible.map((p) => {
            const isSel = selected === p.c.key;
            return (
              <g key={`m-${p.c.key}`} onClick={() => setSelected(isSel ? null : p.c.key)} style={{ cursor: "pointer" }}>
                <circle cx={p.x} cy={p.y} r={isSel ? 9 : 7} fill="#fff" stroke={blobColor(p.c)} strokeWidth={isSel ? 4 : 3} />
                <text x={p.x} y={p.y - (isSel ? 15 : 13)} textAnchor="middle" className="select-none" fontSize="12.5" fontWeight="600" fill="#0b3d20" stroke="#eef3ef" strokeWidth="3" paintOrder="stroke">
                  {count(p.c)}
                </text>
                <text x={p.x} y={p.y + 22} textAnchor="middle" className="select-none" fontSize="10.5" fill="#1d2a23" stroke="#eef3ef" strokeWidth="2.6" paintOrder="stroke">
                  {p.c.area.split(" · ")[0]}
                </text>
              </g>
            );
          })}
        </svg>
      </div>

      {/* selected cluster detail / hint */}
      {sel ? (
        <div className="mt-2 rounded-xl border border-line bg-surface p-3">
          <div className="flex items-start justify-between gap-2">
            <div className="text-sm font-semibold text-ink">{sel.area}</div>
            <button onClick={() => setSelected(null)} className="text-xs text-muted hover:text-ink">Close</button>
          </div>
          <div className="mt-2 grid grid-cols-3 gap-2 text-center text-xs">
            <Mini label="Leads" value={sel.lead} color={STAGE_COLOR.lead} />
            <Mini label="Proposals" value={sel.proposal} color={STAGE_COLOR.proposal} />
            <Mini label="Closed" value={sel.closed} color={STAGE_COLOR.closed} />
          </div>
          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
            <span>Close rate <b className="text-ink">{Math.round(sel.closeRate * 100)}%</b></span>
            <span>Closed value <b className="text-ink">{money(sel.closedValue)}</b></span>
            <span>Pipeline value <b className="text-ink">{money(sel.value)}</b></span>
          </div>
        </div>
      ) : (
        <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-[11px] text-muted">
          <span>Tap an area for its breakdown. Blob size = lead volume; color = {stage === "all" ? "dominant stage" : STAGE_LABEL[stage].toLowerCase() + " stage"}.</span>
          <span className="tabular-nums">{totals.total} leads · {clusters.length} areas · {Math.round(totals.closeRate * 100)}% close · {money(totals.closedValue)} closed</span>
        </div>
      )}
    </div>
  );
}

function StageChip({ active, onClick, dot, label }: { active: boolean; onClick: () => void; dot: string | null; label: string }) {
  return (
    <button onClick={onClick} className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium ${active ? "bg-brand-600 text-white" : "border border-line bg-surface text-ink hover:bg-brand-50"}`}>
      {dot ? <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: dot }} /> : null}
      {label}
    </button>
  );
}

function Mini({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className="rounded-lg border border-line bg-black/[0.02] p-2">
      <div className="flex items-center justify-center gap-1 text-[11px] text-muted"><span className="h-2 w-2 rounded-full" style={{ backgroundColor: color }} />{label}</div>
      <div className="text-lg font-light tabular-nums text-ink">{value}</div>
    </div>
  );
}
