"use client";

import "leaflet/dist/leaflet.css";
import { useEffect, useRef, useState } from "react";

// Weather Ops radar — OpenStreetMap roads basemap + an animated radar overlay from
// RainViewer (free, no API key; tiles load in the viewer's browser). Branded office
// pins (store-locator style). Interactive: play/pause + a frame scrubber. Fixes the
// "tiles only load after you zoom" bug by calling invalidateSize once the panel has
// its real size (and on resize). Degrades to a message if Leaflet/radar can't load.
type LMap = import("leaflet").Map;

type Frame = { time: number; path: string };
export type Office = { label: string; lat: number; lon: number };

// Transparent 1×1 PNG — shown instead of RainViewer's gray "Zoom Level Not Supported"
// placeholder for any tile it doesn't serve (edges/ocean), so the basemap shows through.
const TRANSPARENT_PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

function officeIconHtml(): string {
  return `<div style="position:relative;width:34px;height:40px;transform:translate(-1px,-2px)">
    <div style="width:30px;height:30px;border-radius:50% 50% 50% 0;transform:rotate(-45deg);background:#fff;border:2px solid #2e6f47;box-shadow:0 2px 6px rgba(0,0,0,.45);position:absolute;left:2px;top:0"></div>
    <img src="/clements-mark.svg" alt="" style="width:18px;height:18px;position:absolute;left:8px;top:5px"/>
  </div>`;
}

export default function WeatherRadarMap({ lat, lon, label, offices = [], stops = [], height = 480, zoom = 8 }: { lat: number; lon: number; label: string; offices?: Office[]; stops?: { lat: number; lng: number }[]; height?: number; zoom?: number }) {
  const valid = Number.isFinite(lat) && Number.isFinite(lon);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<LMap | null>(null);
  const drawRef = useRef<((i: number) => void) | null>(null);
  const framesRef = useRef<Frame[]>([]);
  const stopsLayerRef = useRef<import("leaflet").LayerGroup | null>(null);
  const [failed, setFailed] = useState(false);
  const [playing, setPlaying] = useState(true);
  const [idx, setIdx] = useState(0);
  const [count, setCount] = useState(0);
  const [stamp, setStamp] = useState<string>("");
  const [showStops, setShowStops] = useState(stops.length > 0);

  useEffect(() => {
    if (!valid || mapRef.current || !containerRef.current) return;
    let cancelled = false;
    let ro: ResizeObserver | null = null;
    (async () => {
      try {
        const L = (await import("leaflet")).default;
        if (cancelled || !containerRef.current) return;
        const map = L.map(containerRef.current, { scrollWheelZoom: false, attributionControl: true, zoomControl: true }).setView([lat, lon], zoom);
        L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19, attribution: "&copy; OpenStreetMap · radar &copy; RainViewer" }).addTo(map);

        const icon = L.divIcon({ className: "", html: officeIconHtml(), iconSize: [34, 40], iconAnchor: [17, 38], tooltipAnchor: [0, -34] });
        const pins: Office[] = offices.length > 0 ? offices : [{ label, lat, lon }];
        for (const o of pins) {
          if (!Number.isFinite(o.lat) || !Number.isFinite(o.lon)) continue;
          L.marker([o.lat, o.lon], { icon }).addTo(map).bindTooltip(`Clements · ${o.label}`, { direction: "top" });
        }
        // Scheduled-stop dots (Canopy routing) — a layer we can toggle on/off.
        if (stops.length > 0) {
          const group = L.layerGroup();
          for (const s of stops) {
            if (!Number.isFinite(s.lat) || !Number.isFinite(s.lng)) continue;
            L.circleMarker([s.lat, s.lng], { radius: 3, color: "#E3B23C", weight: 1, fillColor: "#E3B23C", fillOpacity: 0.85 }).addTo(group);
          }
          stopsLayerRef.current = group;
          if (showStops) group.addTo(map);
        }
        mapRef.current = map;

        // The panel often sizes AFTER the map inits (fonts/layout), leaving Leaflet
        // with the wrong dimensions so tiles don't fill until you interact. Recompute
        // once on the next frame and whenever the container resizes.
        const fix = () => map.invalidateSize();
        requestAnimationFrame(fix);
        setTimeout(fix, 250);
        ro = new ResizeObserver(fix);
        ro.observe(containerRef.current);

        const res = await fetch("https://api.rainviewer.com/public/weather-maps.json", { cache: "no-store" });
        if (!res.ok) throw new Error("radar feed");
        const data = (await res.json()) as { host: string; radar?: { past?: Frame[]; nowcast?: Frame[] } };
        const frames = [...(data.radar?.past ?? []), ...(data.radar?.nowcast ?? [])];
        if (frames.length === 0) throw new Error("no frames");
        framesRef.current = frames;

        let radar: import("leaflet").TileLayer | null = null;
        drawRef.current = (i: number) => {
          const f = frames[((i % frames.length) + frames.length) % frames.length];
          // maxNativeZoom keeps tiles loading at high map zoom (RainViewer upscales).
          const url = `${data.host}${f.path}/256/{z}/{x}/{y}/2/1_1.png`;
          if (radar) radar.setUrl(url);
          else radar = L.tileLayer(url, { opacity: 0.62, maxZoom: 19, maxNativeZoom: 10, errorTileUrl: TRANSPARENT_PNG }).addTo(map);
          setStamp(new Date(f.time * 1000).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }));
        };
        const start = Math.max(0, (data.radar?.past?.length ?? 1) - 1); // "now"
        setCount(frames.length);
        setIdx(start);
        drawRef.current(start);
        // The radar tile layer was just added — nudge Leaflet so its tiles paint
        // immediately instead of only after the user zooms/pans once.
        requestAnimationFrame(() => map.invalidateSize());
        setTimeout(() => map.invalidateSize(), 120);
      } catch {
        if (!cancelled) setFailed(true);
      }
    })();
    return () => {
      cancelled = true;
      ro?.disconnect();
      mapRef.current?.remove();
      mapRef.current = null;
      drawRef.current = null;
    };
    // offices/height change in lockstep with the territory's lat/lon/label (deps).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [valid, lat, lon, label, zoom]);

  // Draw whenever the frame index changes (animation or scrubber).
  useEffect(() => { drawRef.current?.(idx); }, [idx]);

  // Toggle the scheduled-stops layer.
  useEffect(() => {
    const group = stopsLayerRef.current, map = mapRef.current;
    if (!group || !map) return;
    if (showStops) group.addTo(map);
    else group.remove();
  }, [showStops]);

  // Animate — skip ticks while the tab is hidden (saves the viewer's data).
  useEffect(() => {
    if (failed || !playing || count === 0) return;
    const timer = setInterval(() => {
      if (typeof document !== "undefined" && document.hidden) return;
      setIdx((i) => (i + 1) % count);
    }, 650);
    return () => clearInterval(timer);
  }, [failed, playing, count]);

  if (!valid || failed) {
    return <div className="mt-3 rounded-lg border border-white/10 bg-white/[0.03] p-6 text-sm text-muted">Live radar is unavailable right now. Try again shortly.</div>;
  }
  return (
    <div className="mt-3">
      <div ref={containerRef} className="w-full overflow-hidden rounded-lg border border-white/10" style={{ height, background: "#0e2a1b" }} />
      <div className="mt-2 flex items-center gap-3">
        <button onClick={() => setPlaying((p) => !p)} className="inline-flex items-center gap-1.5 rounded-md border border-white/15 bg-white/5 px-2.5 py-1 text-[11px] uppercase tracking-[0.14em] text-ink hover:bg-white/10">
          {playing ? "Pause" : "Play"}
        </button>
        {stops.length > 0 && (
          <button onClick={() => setShowStops((s) => !s)} className={`inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-[11px] uppercase tracking-[0.14em] ${showStops ? "border-amber-400/50 bg-amber-400/15 text-amber-200" : "border-white/15 bg-white/5 text-muted hover:bg-white/10"}`}>
            <span className="h-2 w-2 rounded-full" style={{ background: "#E3B23C" }} /> Stops ({stops.length})
          </button>
        )}
        <input
          type="range" min={0} max={Math.max(0, count - 1)} value={idx}
          onChange={(e) => { setPlaying(false); setIdx(Number(e.target.value)); }}
          className="h-1 flex-1 cursor-pointer accent-brand-400"
          aria-label="Radar frame"
        />
        <span className="w-16 text-right text-[11px] tabular-nums text-muted">{stamp || "…"}</span>
      </div>
    </div>
  );
}
