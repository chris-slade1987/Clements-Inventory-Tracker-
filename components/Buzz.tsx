/**
 * Buzz — the Clements celebration mascot (birthdays + work anniversaries).
 *
 * A single reusable, server-renderable SVG character used everywhere a
 * celebration shows: the profile banner, the team/org-list marker, the bulletin
 * auto-post, and the supervisor's inbox heads-up. No emoji — all inline SVG, per
 * the house rule (the one sanctioned exception the owner approved for
 * celebrations). All motion is driven by `.buzz-*` keyframes in app/globals.css
 * and stops automatically under `prefers-reduced-motion`.
 *
 * Solid fills (no <defs>/gradient IDs) on purpose: many Buzz markers can render
 * on one page (org chart / roster) without duplicate-ID collisions, and it stays
 * a pure server component (no hooks).
 */
import type { CSSProperties } from "react";

export type BuzzVariant = "birthday" | "anniversary" | "plain";

const GREEN = "#1f9d57";
const GREEN_D = "#0b3d20";
const BELLY = "#a7ebc4";
const PINK = "#ef6186";
const GOLD = "#edc14e";
const GOLD_D = "#8a6410";

/** The Buzz figure on its own. `animated` adds the bob/blink/wiggle classes. */
export function Buzz({
  variant = "plain",
  size = 112,
  animated = true,
  title,
  className,
}: {
  variant?: BuzzVariant;
  size?: number;
  animated?: boolean;
  title?: string;
  className?: string;
}) {
  const fig = animated ? "buzz-fig" : undefined;
  const ant = animated ? "buzz-ant" : undefined;
  const antR = animated ? "buzz-ant buzz-ant-r" : undefined;
  const eye = animated ? "buzz-eye" : undefined;
  return (
    <svg
      viewBox="-6 -18 112 124"
      width={size}
      height={size}
      className={[fig, className].filter(Boolean).join(" ") || undefined}
      role="img"
      aria-label={title ?? `Buzz the mascot${variant !== "plain" ? ` (${variant})` : ""}`}
      style={{ overflow: "visible" }}
    >
      {title ? <title>{title}</title> : null}
      {/* ground shadow */}
      <ellipse cx="50" cy="95" rx="27" ry="5" fill={GREEN_D} opacity="0.16" />
      {/* legs */}
      <g stroke={GREEN_D} strokeWidth="3" strokeLinecap="round">
        <line x1="31" y1="64" x2="15" y2="70" />
        <line x1="30" y1="74" x2="13" y2="82" />
        <line x1="32" y1="83" x2="17" y2="93" />
        <line x1="69" y1="64" x2="85" y2="70" />
        <line x1="70" y1="74" x2="87" y2="82" />
        <line x1="68" y1="83" x2="83" y2="93" />
      </g>
      {/* antennae */}
      <g stroke={GREEN_D} strokeWidth="3" strokeLinecap="round" fill={GREEN}>
        <path className={ant} d="M41 18 C 34 7, 28 5, 25 1" fill="none" />
        <circle className={ant} cx="24" cy="1" r="4.2" />
        <path className={antR} d="M59 18 C 66 7, 72 5, 75 1" fill="none" />
        <circle className={antR} cx="76" cy="1" r="4.2" />
      </g>
      {/* body */}
      <ellipse cx="50" cy="50" rx="35" ry="33" fill={GREEN} />
      <path d="M50 24 V 80" stroke={GREEN_D} strokeWidth="2.5" opacity="0.3" />
      <circle cx="34" cy="40" r="4.2" fill={GREEN_D} opacity="0.24" />
      <circle cx="66" cy="40" r="4.2" fill={GREEN_D} opacity="0.24" />
      <circle cx="40" cy="58" r="3.4" fill={GREEN_D} opacity="0.2" />
      <circle cx="60" cy="58" r="3.4" fill={GREEN_D} opacity="0.2" />
      <ellipse cx="50" cy="56" rx="22" ry="22" fill={BELLY} />
      {/* gloss */}
      <ellipse cx="38" cy="36" rx="16" ry="12" fill="#ffffff" opacity="0.22" />
      {/* eyes */}
      <circle className={eye} cx="42" cy="49" r="7.5" fill="#fff" stroke={GREEN_D} strokeWidth="1" />
      <circle className={eye} cx="58" cy="49" r="7.5" fill="#fff" stroke={GREEN_D} strokeWidth="1" />
      <circle cx="43" cy="50" r="3.4" fill="#0e1a12" />
      <circle cx="59" cy="50" r="3.4" fill="#0e1a12" />
      <circle cx="44.4" cy="48.6" r="1.2" fill="#fff" />
      <circle cx="60.4" cy="48.6" r="1.2" fill="#fff" />
      {/* cheeks + smile */}
      <circle cx="33" cy="60" r="3.4" fill={PINK} opacity="0.45" />
      <circle cx="67" cy="60" r="3.4" fill={PINK} opacity="0.45" />
      <path d="M41 63 Q 50 72 59 63" stroke={GREEN_D} strokeWidth="2.6" fill="none" strokeLinecap="round" />
      {/* party hat */}
      {variant === "birthday" ? (
        <g>
          <path d="M50 -8 L 63 20 L 37 20 Z" fill={PINK} />
          <path d="M50 -8 L 56 5 L 44 5 Z" fill="#f4a63c" opacity="0.85" />
          <path d="M44 20 q6 5 12 0 l-1.5 4 q-4.5 3 -9 0 z" fill="#c9456a" />
          <circle cx="50" cy="-9" r="4.5" fill={GOLD} />
          <path d="M40 13 h20" stroke="#fff" strokeWidth="2" opacity="0.7" />
          <path d="M42.5 6 h15" stroke="#fff" strokeWidth="2" opacity="0.7" />
        </g>
      ) : null}
      {/* medal */}
      {variant === "anniversary" ? (
        <g className={animated ? "buzz-medal" : undefined}>
          <path d="M43 62 L39 84" stroke="#c0432f" strokeWidth="5" />
          <path d="M57 62 L61 84" stroke="#2f6fc0" strokeWidth="5" />
          <circle cx="50" cy="89" r="12" fill={GOLD} stroke={GOLD_D} strokeWidth="1.5" />
          <path
            d="M50 82 l2.2 4.5 5 .5 -3.7 3.4 1 4.9 -4.5 -2.5 -4.5 2.5 1 -4.9 -3.7 -3.4 5 -.5 z"
            fill={GOLD_D}
            opacity="0.8"
          />
          <path className={animated ? "buzz-shine" : undefined} d="M43 84 l3 0 -6 10 -3 0 z" fill="#fff" opacity="0" />
        </g>
      ) : null}
    </svg>
  );
}

/** Small circular list/roster marker: Buzz's face in a badge with a pulsing ring. */
export function BuzzMarker({ kind, className }: { kind: "birthday" | "anniversary"; className?: string }) {
  const label = kind === "birthday" ? "Birthday today" : "Work anniversary today";
  return (
    <span
      className={["buzz-marker", className].filter(Boolean).join(" ")}
      title={label}
      aria-label={label}
    >
      <Buzz variant={kind} size={16} animated={false} />
    </span>
  );
}

const CONFETTI: Array<{ left: number; round: boolean; color: string; delay: number }> = [
  { left: 6, round: true, color: "#1f9d57", delay: 0 },
  { left: 34, round: false, color: "#edc14e", delay: 0.5 },
  { left: 66, round: true, color: "#ef6186", delay: 1 },
  { left: 92, round: false, color: "#3a8fe8", delay: 0.3 },
  { left: 112, round: true, color: "#9b6cf0", delay: 0.8 },
];

/**
 * Full celebration banner for a profile page. Presentational only — the caller
 * decides WHEN to render it (i.e. only on the person's day) and passes the name
 * (+ years for anniversaries).
 */
export function CelebrationBanner({
  kind,
  name,
  years,
  className,
}: {
  kind: "birthday" | "anniversary";
  name: string;
  years?: number | null;
  className?: string;
}) {
  const first = name.split(" ")[0] || name;
  const headline =
    kind === "birthday"
      ? `Happy Birthday, ${first}!`
      : `${years ?? ""} ${years === 1 ? "year" : "years"} at Clements today, ${first}!`.trim();
  const sub = kind === "birthday" ? "From everyone at Clements — courtesy of Buzz." : "Buzz salutes your anniversary.";
  return (
    <div className={["buzz-banner", `buzz-banner-${kind}`, className].filter(Boolean).join(" ")}>
      {kind === "birthday" ? (
        <div className="buzz-confetti" aria-hidden="true">
          {CONFETTI.map((c, i) => (
            <i
              key={i}
              style={
                {
                  left: `${c.left}px`,
                  width: c.round ? "8px" : "7px",
                  height: c.round ? "8px" : "12px",
                  borderRadius: c.round ? "50%" : "2px",
                  background: c.color,
                  animationDelay: `${c.delay}s`,
                } as CSSProperties
              }
            />
          ))}
        </div>
      ) : null}
      <div className="buzz-stage">
        <Buzz variant={kind} size={104} />
      </div>
      <div className="buzz-msg">
        <p className="buzz-msg-big">{headline}</p>
        <p className="buzz-msg-small">{sub}</p>
      </div>
    </div>
  );
}
