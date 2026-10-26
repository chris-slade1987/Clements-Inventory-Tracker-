"use client";

import "leaflet/dist/leaflet.css";
import { useEffect, useRef, useState } from "react";
import { btn } from "@/components/ui";

// A real OpenStreetMap street basemap (Leaflet, no API key) with a technician's
// route drawn ON TOP: numbered stop markers joined by the path. Supports one day
// (single green route) OR several days at once (a "week" view where each day is a
// distinct color, with a legend). A Play button animates a vehicle traveling the
// route stop-to-stop so a manager can visualize the day. Stops need coordinates;
// a "Locate stops" action geocodes them when some are missing.

type Stop = { seq: number; svc: string; addr: string; city: string; zip: string; lat: number | null; lng: number | null; amt: number };
export type MapGroup = { key: string; label: string; color: string; stops: Stop[] };
type LMap = import("leaflet").Map;
type LLayerGroup = import("leaflet").LayerGroup;
type LMarker = import("leaflet").Marker;

const BRANCH_CENTER: Record<string, [number, number]> = {
  vero: [27.6386, -80.3973], stuart: [27.1973, -80.2528], orlando: [28.5383, -81.3792], naples: [26.142, -81.794],
};
const money = (n: number) => "$" + Math.round(n).toLocaleString();

export default function RouteLeafletMap({
  groups, branch, canLocate, onLocate, locating,
}: {
  groups: MapGroup[]; branch: string; canLocate: boolean; onLocate: () => void; locating: boolean;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<LMap | null>(null);
  const layerRef = useRef<LLayerGroup | null>(null);
  const carRef = useRef<LMarker | null>(null);
  const trailRef = useRef<import("leaflet").Polyline | null>(null);
  const rafRef = useRef<number | null>(null);
  const [failed, setFailed] = useState(false);
  const [ready, setReady] = useState(false);
  const [playing, setPlaying] = useState(false);

  const allStops = groups.flatMap((g) => g.stops);
  const located = allStops.filter((s) => s.lat != null && s.lng != null);
  // Ordered located points across every group (each group's stops in sequence) —
  // the path the animation travels.
  const orderedPts: [number, number][] = groups.flatMap((g) =>
    g.stops.filter((s) => s.lat != null && s.lng != null).map((s) => [s.lat as number, s.lng as number] as [number, number]),
  );
  const multi = groups.length > 1;

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
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      if (mapRef.current) { mapRef.current.remove(); mapRef.current = null; layerRef.current = null; carRef.current = null; trailRef.current = null; }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Draw / redraw markers + path whenever the groups (or readiness) change.
  useEffect(() => {
    if (!ready) return;
    stopAnimation();
    let cancelled = false;
    (async () => {
      const L = (await import("leaflet")).default;
      const layer = layerRef.current;
      const map = mapRef.current;
      if (cancelled || !layer || !map) return;
      layer.clearLayers();
      carRef.current = null;
      trailRef.current = null;

      const allPts: [number, number][] = [];
      for (const g of groups) {
        const pts = g.stops.filter((s) => s.lat != null && s.lng != null).map((s) => [s.lat as number, s.lng as number] as [number, number]);
        allPts.push(...pts);
        if (pts.length >= 2) L.polyline(pts, { color: g.color, weight: 3, opacity: multi ? 0.6 : 0.7 }).addTo(layer);
        g.stops.filter((s) => s.lat != null && s.lng != null).forEach((s, i) => {
          const big = s.amt >= 150;
          const sz = big ? 26 : 22;
          const icon = L.divIcon({
            className: "",
            html: `<div style="display:grid;place-items:center;width:${sz}px;height:${sz}px;border-radius:50%;background:${g.color};color:#fff;font:600 11px/1 Helvetica Neue,Arial;border:2px solid #fff;box-shadow:0 1px 3px rgba(0,0,0,.4)">${s.seq}</div>`,
            iconSize: [sz, sz], iconAnchor: [sz / 2, sz / 2],
          });
          const dayTag = multi ? `${g.label} · ` : "";
          L.marker([s.lat as number, s.lng as number], { icon }).bindTooltip(`${dayTag}${s.seq}. ${s.svc} — ${s.addr}, ${s.city} — ${money(s.amt)}`).addTo(layer);
          if (i === 0) L.circleMarker([s.lat as number, s.lng as number], { radius: 15, color: g.color, weight: 2, fill: false }).addTo(layer);
        });
      }
      if (allPts.length) { try { map.fitBounds(L.latLngBounds(allPts).pad(0.15)); } catch { /* single point */ } }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groups, ready]);

  function stopAnimation() {
    if (rafRef.current) { cancelAnimationFrame(rafRef.current); rafRef.current = null; }
    setPlaying(false);
    if (carRef.current && layerRef.current) { try { layerRef.current.removeLayer(carRef.current); } catch { /* */ } carRef.current = null; }
    if (trailRef.current && layerRef.current) { try { layerRef.current.removeLayer(trailRef.current); } catch { /* */ } trailRef.current = null; }
  }

  async function playAnimation() {
    const map = mapRef.current, layer = layerRef.current;
    if (!map || !layer || orderedPts.length < 2) return;
    const L = (await import("leaflet")).default;
    stopAnimation();
    setPlaying(true);

    const carIcon = L.divIcon({
      className: "",
      html: `<div style="width:16px;height:16px;border-radius:50%;background:#111;border:3px solid #fff;box-shadow:0 0 0 3px rgba(31,122,69,.5),0 2px 6px rgba(0,0,0,.5)"></div>`,
      iconSize: [16, 16], iconAnchor: [8, 8],
    });
    const car = L.marker(orderedPts[0], { icon: carIcon, zIndexOffset: 1000, interactive: false }).addTo(layer);
    carRef.current = car;
    const trail = L.polyline([orderedPts[0]], { color: "#111", weight: 4, opacity: 0.85 }).addTo(layer);
    trailRef.current = trail;

    const miles = (a: [number, number], b: [number, number]) => {
      const R = 3958.8, toRad = (d: number) => (d * Math.PI) / 180;
      const dLat = toRad(b[0] - a[0]), dLng = toRad(b[1] - a[1]);
      const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a[0])) * Math.cos(toRad(b[0])) * Math.sin(dLng / 2) ** 2;
      return 2 * R * Math.asin(Math.sqrt(h));
    };

    let leg = 0, legStart = performance.now();
    const legDuration = (i: number) => Math.min(1500, Math.max(320, miles(orderedPts[i], orderedPts[i + 1]) * 130));
    const step = (now: number) => {
      if (!carRef.current) return; // stopped
      const a = orderedPts[leg], b = orderedPts[leg + 1];
      const dur = legDuration(leg);
      const t = Math.min(1, (now - legStart) / dur);
      const lat = a[0] + (b[0] - a[0]) * t, lng = a[1] + (b[1] - a[1]) * t;
      car.setLatLng([lat, lng]);
      trail.setLatLngs([...orderedPts.slice(0, leg + 1), [lat, lng]]);
      if (t >= 1) {
        leg++;
        if (leg >= orderedPts.length - 1) { setPlaying(false); rafRef.current = null; return; }
        legStart = now;
      }
      rafRef.current = requestAnimationFrame(step);
    };
    rafRef.current = requestAnimationFrame(step);
  }

  if (failed) {
    return <div className="grid h-80 place-items-center rounded-xl border border-line text-sm text-muted">Map couldn’t load. {located.length} of {allStops.length} stops located.</div>;
  }

  return (
    <div className="space-y-2">
      <div ref={containerRef} className="z-0 h-80 w-full overflow-hidden rounded-xl border border-line sm:h-[420px]" style={{ background: "#eef3ef" }} />

      {multi && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          {groups.filter((g) => g.stops.some((s) => s.lat != null)).map((g) => (
            <span key={g.key} className="inline-flex items-center gap-1.5 text-[11px] text-muted">
              <span className="h-2.5 w-2.5 rounded-full" style={{ background: g.color }} />{g.label} ({g.stops.length})
            </span>
          ))}
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-muted">
        <span>
          {located.length === allStops.length
            ? `${allStops.length} stops on the street map, in service order.`
            : `${located.length} of ${allStops.length} stops located. The rest need geocoding.`}
        </span>
        <div className="flex items-center gap-2">
          {orderedPts.length >= 2 && (
            playing
              ? <button onClick={stopAnimation} className={btn.secondary}>■ Stop</button>
              : <button onClick={playAnimation} className={btn.secondary}>▶ Play route</button>
          )}
          {canLocate && located.length < allStops.length && (
            <button onClick={onLocate} disabled={locating} className={btn.secondary}>{locating ? "Locating…" : "Locate stops"}</button>
          )}
        </div>
      </div>
    </div>
  );
}
