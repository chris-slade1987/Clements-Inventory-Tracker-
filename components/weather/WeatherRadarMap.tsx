"use client";

import "leaflet/dist/leaflet.css";
import { useEffect, useRef, useState } from "react";

// Weather Ops radar — a real OpenStreetMap roads basemap with an animated radar
// overlay from RainViewer (free, no API key; tiles load in the viewer's browser,
// same Leaflet stack as the Sales lead map). This replaces the old single static
// NWS loop GIF, which showed nothing if that one URL was unavailable. Degrades to a
// message if Leaflet or the radar feed can't load. Centered on the territory point.
type LMap = import("leaflet").Map;

type Frame = { time: number; path: string };

export type Office = { label: string; lat: number; lon: number };

// A teardrop pin badged with the Clements mark — used to plot branch offices on the
// radar, the way a store locator drops branded markers on Google Maps.
function officeIconHtml(): string {
  return `<div style="position:relative;width:34px;height:40px;transform:translate(-1px,-2px)">
    <div style="width:30px;height:30px;border-radius:50% 50% 50% 0;transform:rotate(-45deg);background:#fff;border:2px solid #2e6f47;box-shadow:0 2px 5px rgba(0,0,0,.35);position:absolute;left:2px;top:0"></div>
    <img src="/clements-mark.svg" alt="" style="width:18px;height:18px;position:absolute;left:8px;top:5px"/>
  </div>`;
}

export default function WeatherRadarMap({ lat, lon, label, offices = [] }: { lat: number; lon: number; label: string; offices?: Office[] }) {
  const valid = Number.isFinite(lat) && Number.isFinite(lon);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<LMap | null>(null);
  const drawRef = useRef<((i: number) => void) | null>(null);
  const framesRef = useRef<Frame[]>([]);
  const idxRef = useRef(0);
  const [failed, setFailed] = useState(false);
  const [playing, setPlaying] = useState(true);
  const [stamp, setStamp] = useState<string>("");

  // Build the map + load the RainViewer frame index once.
  useEffect(() => {
    if (!valid || mapRef.current || !containerRef.current) return;
    let cancelled = false;
    (async () => {
      try {
        const L = (await import("leaflet")).default;
        if (cancelled || !containerRef.current) return;
        const map = L.map(containerRef.current, { scrollWheelZoom: false, attributionControl: true }).setView([lat, lon], 8);
        L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
          maxZoom: 19,
          attribution: "&copy; OpenStreetMap · radar &copy; RainViewer",
        }).addTo(map);
        // Branded office markers (store-locator style). Fall back to the center point
        // when no offices were passed, so the territory is always marked.
        const pins: Office[] = offices.length > 0 ? offices : [{ label, lat, lon }];
        const icon = L.divIcon({ className: "", html: officeIconHtml(), iconSize: [34, 40], iconAnchor: [17, 38], tooltipAnchor: [0, -34] });
        for (const o of pins) {
          if (!Number.isFinite(o.lat) || !Number.isFinite(o.lon)) continue;
          L.marker([o.lat, o.lon], { icon }).addTo(map).bindTooltip(`Clements · ${o.label}`, { direction: "top" });
        }
        mapRef.current = map;

        const res = await fetch("https://api.rainviewer.com/public/weather-maps.json", { cache: "no-store" });
        if (!res.ok) throw new Error("radar feed");
        const data = (await res.json()) as { host: string; radar?: { past?: Frame[]; nowcast?: Frame[] } };
        const frames = [...(data.radar?.past ?? []), ...(data.radar?.nowcast ?? [])];
        if (frames.length === 0) throw new Error("no frames");
        framesRef.current = frames;

        let radar: import("leaflet").TileLayer | null = null;
        drawRef.current = (i: number) => {
          const f = frames[i % frames.length];
          const url = `${data.host}${f.path}/256/{z}/{x}/{y}/2/1_1.png`;
          if (radar) radar.setUrl(url);
          else radar = L.tileLayer(url, { opacity: 0.6, maxZoom: 19 }).addTo(map);
          setStamp(new Date(f.time * 1000).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }));
        };
        idxRef.current = Math.max(0, (data.radar?.past?.length ?? 1) - 1); // start at "now"
        drawRef.current(idxRef.current);
      } catch {
        if (!cancelled) setFailed(true);
      }
    })();
    return () => {
      cancelled = true;
      mapRef.current?.remove();
      mapRef.current = null;
      drawRef.current = null;
    };
    // offices change in lockstep with the territory's lat/lon/label (already deps).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [valid, lat, lon, label]);

  // Animate the loop — but skip ticks while the tab isn't visible, so a backgrounded
  // page stops pulling radar tiles (saves the viewer's data; polite to the free feed).
  useEffect(() => {
    if (failed || !playing) return;
    const timer = setInterval(() => {
      if (typeof document !== "undefined" && document.hidden) return;
      const frames = framesRef.current;
      if (frames.length === 0 || !drawRef.current) return;
      idxRef.current = (idxRef.current + 1) % frames.length;
      drawRef.current(idxRef.current);
    }, 600);
    return () => clearInterval(timer);
  }, [failed, playing]);

  if (!valid || failed) {
    return <p className="mt-2 text-sm text-muted">Live radar is unavailable right now. Try again shortly.</p>;
  }
  return (
    <div className="mt-3">
      <div ref={containerRef} className="h-72 w-full overflow-hidden rounded-lg border border-line" style={{ background: "#e8eef0" }} />
      <div className="mt-2 flex items-center justify-between text-[11px] text-muted">
        <button onClick={() => setPlaying((p) => !p)} className="rounded-md border border-line px-2 py-0.5 hover:bg-black/5">
          {playing ? "Pause" : "Play"}
        </button>
        <span>Frame: {stamp || "…"}</span>
      </div>
    </div>
  );
}
