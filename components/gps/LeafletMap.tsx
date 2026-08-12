"use client";

import { useEffect } from "react";
import { MapContainer, TileLayer, Marker, Popup, Polyline, useMap } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

// The actual Leaflet map. Loaded ONLY on the client (see FleetMap.tsx, which
// dynamic-imports this with ssr:false) — Leaflet touches `window` at import time
// and cannot be server-rendered.

export type MapMarker = {
  id: string;
  lat: number;
  lng: number;
  label: string; // heading line in the popup
  color: string; // pin color (hex)
  lines?: string[]; // extra popup lines
  href?: string; // optional link rendered in the popup
};

export type LeafletMapProps = {
  markers: MapMarker[];
  trail?: [number, number][];
  center?: [number, number];
  zoom?: number;
  height?: number;
};

// Florida — a sensible default view when there's nothing to fit to.
const DEFAULT_CENTER: [number, number] = [27.9, -81.3];
const DEFAULT_ZOOM = 7;

// Fix the well-known Leaflet + bundler broken-marker-icon issue defensively.
// We render every pin via divIcon (below), so no default marker image is ever
// requested — just stop Leaflet from reaching out to a (possibly blocked)
// external CDN for the default icon it would otherwise try to load.
const iconProto = L.Icon.Default.prototype as unknown as { _getIconUrl?: unknown };
delete iconProto._getIconUrl;

function pinIcon(color: string): L.DivIcon {
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="26" height="34" viewBox="0 0 26 34">` +
    `<path d="M13 0C5.8 0 0 5.8 0 13c0 9.2 13 21 13 21s13-11.8 13-21C26 5.8 20.2 0 13 0z" fill="${color}" stroke="#ffffff" stroke-width="2"/>` +
    `<circle cx="13" cy="13" r="4.5" fill="#ffffff"/></svg>`;
  return L.divIcon({
    html: svg,
    className: "gps-pin",
    iconSize: [26, 34],
    iconAnchor: [13, 34],
    popupAnchor: [0, -30],
  });
}

function FitBounds({ markers, trail }: { markers: MapMarker[]; trail?: [number, number][] }) {
  const map = useMap();
  useEffect(() => {
    const pts: [number, number][] = [
      ...markers.map((m) => [m.lat, m.lng] as [number, number]),
      ...(trail ?? []),
    ];
    if (pts.length === 1) {
      map.setView(pts[0], 14);
    } else if (pts.length > 1) {
      map.fitBounds(L.latLngBounds(pts).pad(0.2));
    }
    // Recompute size after the container is laid out.
    setTimeout(() => map.invalidateSize(), 0);
  }, [map, markers, trail]);
  return null;
}

export default function LeafletMap({ markers, trail, center, zoom, height = 420 }: LeafletMapProps) {
  // Guard against non-finite coordinates — a single NaN/undefined lat or lng
  // makes Leaflet throw and blanks the whole map.
  const safeMarkers = markers.filter((m) => Number.isFinite(m.lat) && Number.isFinite(m.lng));
  const safeTrail = (trail ?? []).filter(([la, ln]) => Number.isFinite(la) && Number.isFinite(ln));
  return (
    <MapContainer
      center={center ?? DEFAULT_CENTER}
      zoom={zoom ?? DEFAULT_ZOOM}
      scrollWheelZoom
      style={{ height, width: "100%" }}
      className="rounded-2xl"
    >
      <TileLayer
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
        maxZoom={19}
      />
      {safeTrail.length > 1 ? (
        <Polyline positions={safeTrail} pathOptions={{ color: "#0ea5e9", weight: 3, opacity: 0.8 }} />
      ) : null}
      {safeMarkers.map((m) => (
        <Marker key={m.id} position={[m.lat, m.lng]} icon={pinIcon(m.color)}>
          <Popup>
            <div style={{ minWidth: 160 }}>
              <div style={{ fontWeight: 600, marginBottom: 2 }}>{m.label}</div>
              {(m.lines ?? []).map((line, i) => (
                <div key={i} style={{ fontSize: 12, color: "#475569" }}>
                  {line}
                </div>
              ))}
              {m.href ? (
                <a href={m.href} style={{ fontSize: 12, color: "#047857", fontWeight: 500 }}>
                  View vehicle →
                </a>
              ) : null}
            </div>
          </Popup>
        </Marker>
      ))}
      <FitBounds markers={safeMarkers} trail={safeTrail} />
    </MapContainer>
  );
}
