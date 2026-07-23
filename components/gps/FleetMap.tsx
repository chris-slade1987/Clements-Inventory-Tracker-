"use client";

import dynamic from "next/dynamic";
import type { LeafletMapProps } from "./LeafletMap";

// Client-only boundary for the Leaflet map. `ssr: false` is only permitted
// inside a Client Component (Next 16), so server pages import THIS wrapper, not
// LeafletMap directly. Leaflet reads `window` at import time and must never be
// server-rendered.
const LeafletMap = dynamic(() => import("./LeafletMap"), {
  ssr: false,
  loading: () => (
    <div
      className="grid place-items-center rounded-2xl border border-line bg-black/[0.03] text-sm text-muted"
      style={{ height: 420, width: "100%" }}
    >
      Loading map…
    </div>
  ),
});

export default function FleetMap(props: LeafletMapProps) {
  return <LeafletMap {...props} />;
}
