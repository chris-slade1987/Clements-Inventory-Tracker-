import type { SVGProps } from "react";

// Thin line-art weather glyphs (brand icon spec: 24×24, stroke 1.6, round caps, no
// fill, currentColor) — used in place of the raster NWS icons on the 5-day outlook.
// The glyph is chosen from the NWS shortForecast text.

export type GlyphKind = "sun" | "partly" | "cloud" | "rain" | "storm" | "fog" | "wind" | "snow";

export function glyphFor(text: string): GlyphKind {
  const t = (text || "").toLowerCase();
  if (/thunder|t-?storm|lightning/.test(t)) return "storm";
  if (/snow|sleet|ice|flurr|wintry/.test(t)) return "snow";
  if (/fog|haze|mist|smoke/.test(t)) return "fog";
  if (/rain|shower|drizzle|precip/.test(t)) return "rain";
  if (/wind|breezy|gust/.test(t)) return "wind";
  if (/partly|mostly sunny|partly sunny|mostly clear|few clouds|scattered cloud/.test(t)) return "partly";
  if (/cloud|overcast/.test(t)) return "cloud";
  if (/sunny|clear|fair|hot/.test(t)) return "sun";
  return "cloud";
}

const CLOUD = "M7 18a4 4 0 01-.4-7.98A5.5 5.5 0 0117.5 9.5 3.75 3.75 0 0117 18H7z";

export default function WeatherGlyph({ kind, ...props }: { kind: GlyphKind } & SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" aria-hidden {...props}>
      {kind === "sun" && (
        <>
          <circle cx="12" cy="12" r="4" />
          {[0, 45, 90, 135, 180, 225, 270, 315].map((a) => {
            const r = (a * Math.PI) / 180;
            const x1 = 12 + Math.cos(r) * 7, y1 = 12 + Math.sin(r) * 7;
            const x2 = 12 + Math.cos(r) * 9.5, y2 = 12 + Math.sin(r) * 9.5;
            return <line key={a} x1={x1} y1={y1} x2={x2} y2={y2} />;
          })}
        </>
      )}
      {kind === "partly" && (
        <>
          <circle cx="8.5" cy="8.5" r="3" />
          {[200, 250, 300].map((a) => { const r = (a * Math.PI) / 180; return <line key={a} x1={8.5 + Math.cos(r) * 4.5} y1={8.5 + Math.sin(r) * 4.5} x2={8.5 + Math.cos(r) * 6} y2={8.5 + Math.sin(r) * 6} />; })}
          <path d="M9 19a3.5 3.5 0 01-.3-6.98A4.8 4.8 0 0118 11.6 3.3 3.3 0 0117.5 19H9z" />
        </>
      )}
      {kind === "cloud" && <path d={CLOUD} />}
      {kind === "rain" && (
        <>
          <path d="M7 15a4 4 0 01-.4-7.98A5.5 5.5 0 0117.5 6.5 3.75 3.75 0 0117 15H7z" />
          <line x1="8.5" y1="18" x2="7.5" y2="20.5" />
          <line x1="12" y1="18" x2="11" y2="20.5" />
          <line x1="15.5" y1="18" x2="14.5" y2="20.5" />
        </>
      )}
      {kind === "storm" && (
        <>
          <path d="M7 15a4 4 0 01-.4-7.98A5.5 5.5 0 0117.5 6.5 3.75 3.75 0 0117 15H7z" />
          <path d="M12.5 16l-2.5 3.5h2.2L10.8 23" />
        </>
      )}
      {kind === "fog" && (
        <>
          <path d="M7 13a4 4 0 01-.4-7.98A5.5 5.5 0 0117.5 4.5 3.75 3.75 0 0117 13H7z" />
          <line x1="5" y1="17" x2="17" y2="17" />
          <line x1="7" y1="20" x2="19" y2="20" />
        </>
      )}
      {kind === "wind" && (
        <>
          <path d="M3 9h11a2.5 2.5 0 10-2.5-2.5" />
          <path d="M3 13h14a2.5 2.5 0 11-2.5 2.5" />
          <path d="M3 17h8" />
        </>
      )}
      {kind === "snow" && (
        <>
          <path d="M7 14a4 4 0 01-.4-7.98A5.5 5.5 0 0117.5 5.5 3.75 3.75 0 0117 14H7z" />
          <line x1="8.5" y1="18" x2="8.5" y2="21" /><line x1="7" y1="19.5" x2="10" y2="19.5" />
          <line x1="14.5" y1="18" x2="14.5" y2="21" /><line x1="13" y1="19.5" x2="16" y2="19.5" />
        </>
      )}
    </svg>
  );
}
