"use client";

import dynamic from "next/dynamic";
import { Component, type ReactNode } from "react";
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
      style={{ height: 960, width: "100%" }}
    >
      Loading map…
    </div>
  ),
});

// A crash inside Leaflet (or its chunk failing to load) used to blank the whole
// panel silently. This boundary keeps the rest of the page alive and shows the
// real error with a retry, so a broken map is diagnosable instead of "it just
// doesn't load."
class MapErrorBoundary extends Component<
  { height: number; children: ReactNode },
  { error: Error | null }
> {
  state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error) {
    // Surface it for anyone with the console open.
    console.error("Fleet map failed to render:", error);
  }

  render() {
    if (this.state.error) {
      return (
        <div
          className="grid place-items-center rounded-2xl border border-red-200 bg-red-50 p-6 text-center"
          style={{ height: this.props.height, width: "100%" }}
        >
          <div className="max-w-sm">
            <div className="text-sm font-medium text-red-700">The map failed to load.</div>
            <div className="mt-1 text-xs text-red-600/80">
              {this.state.error.message || "An unexpected error occurred while drawing the map."}
            </div>
            <button
              onClick={() => this.setState({ error: null })}
              className="mt-3 rounded-lg border border-red-300 bg-white px-3 py-1.5 text-xs font-medium text-red-700 hover:bg-red-100"
            >
              Try again
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

export default function FleetMap(props: LeafletMapProps) {
  const height = props.height ?? 420;
  return (
    <MapErrorBoundary height={height}>
      <LeafletMap {...props} />
    </MapErrorBoundary>
  );
}
