"use client";

import "leaflet/dist/leaflet.css";
import { useEffect, useRef, useState } from "react";
import { btn } from "@/components/ui";

// A real OpenStreetMap street basemap (Leaflet, no API key — free OSM tiles that
// load in the viewer's browser) with the technician's day drawn ON TOP: numbered
// stop markers joined by the route path. Mirrors components/LeadHeatMap.tsx. Stops
// need coordinates; when some/all are missing, a "Locate stops" action geocodes
// them (bounded) server-side and the parent refetches. Degrades to a clear prompt
// rather than a broken map.

type Stop = { seq: number; svc: string; addr: string; city: string; zip: string; lat: number | null; lng: number | null; amt: number };
type LMap = import("leaflet").Map;
type LLayerGroup = import("leaflet").LayerGroup;

const BRANCH_CENTER: Record<string, [number, number]> = {
  vero: [27.6386, -80.3973], stuart: [27.1973, -80.2528], orlando: [28.5383, -81.3792], naples: [26.142, -81.794],
};
const money = (n: number) => "$" + Math.round(n).toLocaleString();

export default function RouteLeafletMap({
  stops, branch, canLocate, onLocate, locating,
}: {
  stops: Stop[]; branch: string; canLocate: boolean; onLocate: () => void; locating: boolean;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<LMap | null>(null);
  const layerRef = useRef<LLayerGroup | null>(null);
  const [failed, setFailed] = useState(false);
  const [ready, setReady] = useState(false);
  const located = stops.filter((s) => s.lat != null && s.lng != null);

  // Init the map once (dynamic import so the client component renders on the server).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const L = (await import("leaflet")).default;
        if (cancelled || !containerRef.current || mapRef.current) return;
        const center = BRANCH_CENTER[branch] || BRANCH_CENTER.vero;
        const map = L.map(containerRef.current, { scrollWheelZoom: false, attributionControl: true }).setView(center, 11);
        L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19, attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors' }).addTo(map);
        layerRef.current = L.layerGroup().addTo(map);
        mapRef.current = map;
        setReady(true);
      } catch {
        setFailed(true);
      }
    })();
    return () => {
      cancelled = true;
      if (mapRef.current) { mapRef.current.remove(); mapRef.current = null; layerRef.current = null; }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Draw / redraw markers + path whenever the stops (or readiness) change.
  useEffect(() => {
    if (!ready) return;
    let cancelled = false;
    (async () => {
      const L = (await import("leaflet")).default;
      const layer = layerRef.current;
      const map = mapRef.current;
      if (cancelled || !layer || !map) return;
      layer.clearLayers();
      const pts = located.map((s) => [s.lat as number, s.lng as number] as [number, number]);
      if (pts.length >= 2) L.polyline(pts, { color: "#2e6f47", weight: 3, opacity: 0.7 }).addTo(layer);
      located.forEach((s, i) => {
        const big = s.amt >= 150;
        const icon = L.divIcon({
          className: "",
          html: `<div style="display:grid;place-items:center;width:${big ? 26 : 22}px;height:${big ? 26 : 22}px;border-radius:50%;background:#1f5836;color:#fff;font:600 11px/1 Helvetica Neue,Arial;border:2px solid #fff;box-shadow:0 1px 3px rgba(0,0,0,.4)">${s.seq}</div>`,
          iconSize: [big ? 26 : 22, big ? 26 : 22],
          iconAnchor: [big ? 13 : 11, big ? 13 : 11],
        });
        L.marker([s.lat as number, s.lng as number], { icon }).bindTooltip(`${s.seq}. ${s.svc} — ${s.addr}, ${s.city} — ${money(s.amt)}`).addTo(layer);
        if (i === 0) L.circleMarker([s.lat as number, s.lng as number], { radius: 15, color: "#1F7A45", weight: 2, fill: false }).addTo(layer);
      });
      if (pts.length) { try { map.fitBounds(L.latLngBounds(pts).pad(0.15)); } catch { /* single point */ } }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stops, ready]);

  if (failed) {
    return <div className="grid h-80 place-items-center rounded-xl border border-line text-sm text-muted">Map couldn’t load. {located.length} of {stops.length} stops located.</div>;
  }

  return (
    <div className="space-y-2">
      <div ref={containerRef} className="z-0 h-80 w-full overflow-hidden rounded-xl border border-line sm:h-[420px]" style={{ background: "#eef3ef" }} />
      <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-muted">
        <span>
          {located.length === stops.length
            ? `${stops.length} stops on the street map, in service order.`
            : `${located.length} of ${stops.length} stops located. The rest need geocoding.`}
        </span>
        {canLocate && located.length < stops.length && (
          <button onClick={onLocate} disabled={locating} className={btn.secondary}>{locating ? "Locating…" : "Locate stops"}</button>
        )}
      </div>
    </div>
  );
}
