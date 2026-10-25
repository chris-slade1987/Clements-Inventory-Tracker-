// A 180° instrument gauge (pure SVG) for the command deck — temp, wind, rain, humidity.
// Colored by threshold zones (amber/red) so a glance reads the posture. On-brand:
// semantic status colors, Helvetica numerals (tabular), thin arcs.

const POSITIVE = "#1F9D57";
const WARNING = "#E3B23C";
const DANGER = "#DC2626";
const NEUTRAL = "#74A96E"; // brand-400
const TRACK = "rgba(167,189,176,0.22)";

function polar(cx: number, cy: number, r: number, deg: number): [number, number] {
  const rad = (deg * Math.PI) / 180;
  return [cx + r * Math.cos(rad), cy - r * Math.sin(rad)];
}

export default function Gauge({
  label, value, min = 0, max, unit, zones,
}: {
  label: string; value: number | null; min?: number; max: number; unit?: string; zones?: { amber: number; red: number };
}) {
  const cx = 50, cy = 52, r = 38;
  const [sx, sy] = polar(cx, cy, r, 180); // left
  const [ex, ey] = polar(cx, cy, r, 0); // right
  const has = value != null && Number.isFinite(value);
  const f = has ? Math.max(0, Math.min(1, (value! - min) / (max - min))) : 0;
  const theta = 180 - 180 * f;
  const [vx, vy] = polar(cx, cy, r, theta);

  const color = !has
    ? TRACK
    : zones
      ? value! >= zones.red ? DANGER : value! >= zones.amber ? WARNING : POSITIVE
      : NEUTRAL;

  return (
    <div className="flex flex-col items-center">
      <svg viewBox="0 0 100 70" className="w-full max-w-[128px]">
        <path d={`M${sx},${sy} A${r},${r} 0 0 1 ${ex},${ey}`} fill="none" stroke={TRACK} strokeWidth={7} strokeLinecap="round" />
        {has && f > 0.001 && (
          <path d={`M${sx},${sy} A${r},${r} 0 0 1 ${vx},${vy}`} fill="none" stroke={color} strokeWidth={7} strokeLinecap="round" />
        )}
        {has && <circle cx={vx} cy={vy} r={3.6} fill={color} />}
        <text x="50" y="47" textAnchor="middle" className="fill-[color:var(--color-ink)]" style={{ fontSize: 20, fontWeight: 300 }}>
          {has ? Math.round(value!) : "—"}
        </text>
        {unit && has && <text x="50" y="58" textAnchor="middle" className="fill-[color:var(--color-muted)]" style={{ fontSize: 8, letterSpacing: 1 }}>{unit}</text>}
      </svg>
      <div className="-mt-1 text-[10px] uppercase tracking-[0.16em] text-muted">{label}</div>
    </div>
  );
}
