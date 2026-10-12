"use client";

import "leaflet/dist/leaflet.css";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { btn } from "@/components/ui";

// Lead heat map on a real OpenStreetMap basemap (Leaflet, no API key — free OSM
// tiles that load in the viewer's browser). Each neighborhood/zip cluster is a
// circle sized by lead volume and colored by funnel stage, over a zoomable street
// map; a stage filter isolates pending leads by stage and tapping a cluster opens
// its breakdown. Leaflet is imported dynamically so this client component still
// renders safely on the server. Falls back to a plain list if the map can't load.

export type HeatClusterView = {
  key: string; area: string; branch: string | null;
  lat: number; lng: number;
  total: number; lead: number; proposal: number; closed: number;
  value: number; closedValue: number; closeRate: number;
  dominant: "lead" | "proposal" | "closed";
};

type Stage = "all" | "lead" | "proposal" | "closed";
type LMap = import("leaflet").Map;
type LLayerGroup = import("leaflet").LayerGroup;

const STAGE_COLOR: Record<string, string> = { lead: "#d9972b", proposal: "#2563c9", closed: "#2e6f47" };
const STAGE_LABEL: Record<string, string> = { lead: "Lead", proposal: "Proposal", closed: "Closed" };
const money = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;

export default function LeadHeatMap({
  clusters, totals, canLoadDemo = false,
}: {
  clusters: HeatClusterView[];
  totals: { leads: number; proposals: number; closed: number; total: number; closedValue: number; closeRate: number };
  canLoadDemo?: boolean;
}) {
  const router = useRouter();
  const [stage, setStage] = useState<Stage>("all");
  const [selected, setSelected] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [loadingDemo, setLoadingDemo] = useState(false);

  async function loadDemo() {
    setLoadingDemo(true);
    try {
      await fetch("/api/sales/demo", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "load" }) });
      router.refresh();
    } finally {
      setLoadingDemo(false);
    }
  }

  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<LMap | null>(null);
  const layerRef = useRef<LLayerGroup | null>(null);
  const [ready, setReady] = useState(false);

  const count = useCallback((c: HeatClusterView) => (stage === "all" ? c.total : c[stage]), [stage]);
  const color = useCallback((c: HeatClusterView) => (stage === "all" ? STAGE_COLOR[c.dominant] : STAGE_COLOR[stage]), [stage]);
  const sel = selected ? clusters.find((c) => c.key === selected) ?? null : null;
  const maxCount = useMemo(() => clusters.reduce((m, c) => Math.max(m, stage === "all" ? c.total : c[stage]), 0) || 1, [clusters, stage]);

  // Init the map once, then fit it to the leads.
  useEffect(() => {
    if (mapRef.current || !containerRef.current || clusters.length === 0) return;
    let cancelled = false;
    (async () => {
      try {
        const L = (await import("leaflet")).default;
        if (cancelled || !containerRef.current) return;
        const map = L.map(containerRef.current, { scrollWheelZoom: false, attributionControl: true });
        L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
          maxZoom: 19,
          attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
        }).addTo(map);
        layerRef.current = L.layerGroup().addTo(map);
        const bounds = L.latLngBounds(clusters.map((c) => [c.lat, c.lng] as [number, number]));
        map.fitBounds(bounds, { padding: [40, 40], maxZoom: 12 });
        mapRef.current = map;
        setReady(true);
        setTimeout(() => map.invalidateSize(), 150);
      } catch {
        if (!cancelled) setFailed(true);
      }
    })();
    return () => {
      cancelled = true;
      mapRef.current?.remove();
      mapRef.current = null;
      layerRef.current = null;
    };
    // Init is intentionally one-shot; marker/stage updates happen in the effect below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // (Re)draw the circles whenever the stage, selection, or data changes.
  useEffect(() => {
    if (!ready || !layerRef.current) return;
    let cancelled = false;
    (async () => {
      const L = (await import("leaflet")).default;
      const layer = layerRef.current;
      if (cancelled || !layer) return;
      layer.clearLayers();
      clusters.forEach((c) => {
        const n = stage === "all" ? c.total : c[stage];
        if (n <= 0) return;
        const isSel = selected === c.key;
        const r = 9 + Math.sqrt(n / maxCount) * 22;
        const m = L.circleMarker([c.lat, c.lng], {
          radius: r,
          color: isSel ? "#0b3d20" : "#ffffff",
          weight: isSel ? 3 : 2,
          fillColor: color(c),
          fillOpacity: 0.65,
        });
        m.bindTooltip(`${c.area.split(" · ")[0]} · ${n}`, { direction: "top", offset: [0, -r] });
        m.on("click", () => setSelected((prev) => (prev === c.key ? null : c.key)));
        m.addTo(layer);
      });
    })();
    return () => { cancelled = true; };
  }, [ready, stage, selected, clusters, maxCount, color]);

  if (clusters.length === 0) {
    return (
      <div className="rounded-xl border border-line bg-surface p-8 text-center">
        <div className="text-sm font-medium text-ink">No mapped leads in this range</div>
        <div className="mt-1 text-xs text-muted">
          {canLoadDemo
            ? "Until SmarterLaunch is connected, load sample leads to see the map in action. You can clear them anytime."
            : "Leads with an address will plot here once the sales feed is connected, or try a wider date range."}
        </div>
        {canLoadDemo ? (
          <button onClick={loadDemo} disabled={loadingDemo} className={`${btn.primary} mt-4`}>
            {loadingDemo ? "Loading sample data…" : "Load sample data"}
          </button>
        ) : null}
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

      {!failed ? (
        <div ref={containerRef} className="z-0 h-[420px] w-full overflow-hidden rounded-xl border border-line sm:h-[520px]" style={{ background: "#eef3ef" }} />
      ) : (
        // Tiles/library unavailable — stay useful with a ranked area list.
        <div className="overflow-hidden rounded-xl border border-line">
          <div className="border-b border-line bg-black/[0.02] px-3 py-2 text-[11px] font-medium uppercase tracking-wide text-muted">Areas by {stage === "all" ? "volume" : STAGE_LABEL[stage].toLowerCase()}</div>
          <ul className="divide-y divide-line">
            {[...clusters].sort((a, b) => count(b) - count(a)).filter((c) => count(c) > 0).slice(0, 10).map((c) => (
              <li key={c.key} className="flex items-center gap-3 px-3 py-2 text-sm">
                <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: color(c) }} />
                <button onClick={() => setSelected(selected === c.key ? null : c.key)} className="min-w-0 flex-1 truncate text-left hover:underline">{c.area}</button>
                <span className="tabular-nums text-muted">{count(c)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

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
          <span>Tap a circle for its breakdown. Size = lead volume; color = {stage === "all" ? "dominant stage" : STAGE_LABEL[stage].toLowerCase() + " stage"}. Zoom in to separate nearby neighborhoods.</span>
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
