// Small inline-SVG icon set for the bulletin / landing surfaces, drawn in the
// same single-color stroke style as the nav icons (24x24, currentColor) so the
// site reads as one system instead of leaning on colorful emoji.

export const GLYPHS: Record<string, string> = {
  megaphone: "M3 10v4a1 1 0 001 1h3l6 4V5L7 9H4a1 1 0 00-1 1zM17 8a4 4 0 010 8",
  calendar: "M7 3v3M17 3v3M4 8h16M5 6h14a1 1 0 011 1v12a1 1 0 01-1 1H5a1 1 0 01-1-1V7a1 1 0 011-1z",
  sun: "M12 4V3M12 21v-1M4 12H3M21 12h-1M5.6 5.6l-.7-.7M19.1 19.1l-.7-.7M18.4 5.6l.7-.7M4.9 19.1l.7-.7M12 8a4 4 0 100 8 4 4 0 000-8z",
  lock: "M7 11V8a5 5 0 0110 0v3M6 11h12a1 1 0 011 1v7a1 1 0 01-1 1H6a1 1 0 01-1-1v-7a1 1 0 011-1z",
  clock: "M12 8v4l3 2M12 3a9 9 0 100 18 9 9 0 000-18z",
  cake: "M5 21h14M6 21v-7a2 2 0 012-2h8a2 2 0 012 2v7M9 12V9M12 12V9M15 12V9M9 6.5a1 1 0 11-2 0c0-.6 1-1.5 1-1.5s1 .9 1 1.5zM13 6.5a1 1 0 11-2 0c0-.6 1-1.5 1-1.5s1 .9 1 1.5zM17 6.5a1 1 0 11-2 0c0-.6 1-1.5 1-1.5s1 .9 1 1.5z",
  award: "M8.5 14.5L7 21l5-3 5 3-1.5-6.5M12 3a5 5 0 100 10 5 5 0 000-10z",
  star: "M12 3.5l2.6 5.3 5.8.8-4.2 4.1 1 5.8L12 16.8l-5.2 2.7 1-5.8-4.2-4.1 5.8-.8z",
  truck: "M3 13h11V6H3zM14 9h4l3 3v1h-7zM6.5 18a1.5 1.5 0 100-3 1.5 1.5 0 000 3zm10 0a1.5 1.5 0 100-3 1.5 1.5 0 000 3z",
  cap: "M12 4L2 9l10 5 10-5zM6 12v4c0 1 3 2 6 2s6-1 6-2v-4",
  wrench: "M14.7 6.3a4 4 0 01-5.4 5.4L4 17v3h3l5.3-5.3a4 4 0 015.4-5.4l-2.6 2.6-2-2z",
  shield: "M12 3l7 3v5c0 4.5-3 8.5-7 10-4-1.5-7-5.5-7-10V6zM9 12l2 2 4-4",
  trash: "M4 7h16M9 7V5a1 1 0 011-1h4a1 1 0 011 1v2M6 7l1 13a1 1 0 001 1h8a1 1 0 001-1l1-13",
};

export default function Glyph({ name, className = "h-5 w-5", filled = false }: { name: string; className?: string; filled?: boolean }) {
  const d = GLYPHS[name] ?? GLYPHS.star;
  return (
    <svg viewBox="0 0 24 24" fill={filled ? "currentColor" : "none"} stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <path d={d} />
    </svg>
  );
}
