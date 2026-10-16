# CanopyOS Brand Kit

The single source of truth for CanopyOS visual design — the Clements Pest Control
internal portal. **Any UI, artifact, course material, slide deck, diagram, email,
or graphic produced for this project must follow this kit.** Values are lifted
verbatim from the live app (`app/globals.css`, `components/ui.tsx`,
`components/Buzz.tsx`); if the code and this doc ever diverge, the code wins —
update this doc in the same change.

Company: **Clements Pest Control** — four Florida branches: **Vero Beach (HQ),
Stuart, Orlando, Naples.**

---

## 1. Essence & voice

Calm, confident, professional — a trusted field manual, not a consumer app. Deep
forest greens for identity/chrome; a clean near-white surface for reading.
Generous whitespace, one idea per screen. **Never neon, never busy.**

- Lead with the answer, then the detail. Active voice. Plain, expert language a
  technician respects. No hype or filler.
- Ground content in the company's own language where relevant ("The Clements
  Way," the Three Pillars, the "Orange Ice Cube" customer experience).
- **No emoji anywhere** in product or content. There are **two** narrowly
  sanctioned exceptions, and nothing else:
  1. the mascot **Buzz** (§8), used only for celebrations; and
  2. the **Sales Motivation module** — COO-approved (Oct 2026), **sales screens
     only** (`/sales`, `/me/sales`, `SalesFunnelCard`, the sales leaderboards and
     AI-coach buttons). There, keep the motivational emojis: leaderboard ribbons
     **🥇 🥈 🥉**, achievement badges (🚀 lead machine, 🎯 top proposals,
     📈 most improved, 🔥 goal crushed, 🎉 celebration), and the **✨** AI-coach /
     team-briefing sparkle. These are gamification signals, not decoration — do
     **not** strip them in a future "no-emoji" pass. Everywhere else outside the
     sales motivation module, emoji stay banned (use the thin 1.6 line icons).
- Real units, real product names, real Florida pests — never lorem ipsum or
  generic stock imagery.

---

## 2. Logo & mark

**Always use the real committed asset files — never redraw or approximate the
mark.** The CanopyOS logo is a thin **hexagon enclosing a stylized "canopy tree"**
— a central trunk that branches upward into small circular nodes (a tree rendered
as a clean line/"tech" tree) with short roots at the base — paired with the
**"CanopyOS"** wordmark in a light sans (capital C, capital "OS"). It renders
white/off-white on the forest ground.

Canonical assets (in `public/`):
- `canopyos-logo.png` — full lockup (hexagon-tree mark + wordmark).
- `canopyos-wordmark.png` — the wordmark lockup used in-app (AppShell, login,
  sign pages).
- `canopyos-icon.png` — the hexagon-tree mark on its own.
- `icons/canopyos-512.png` · `canopyos-192.png` · `canopyos-favicon.png` ·
  `canopyos-maskable-512.png` · `apple-touch-icon.png` — app / PWA icons.

Rules: keep clear space around the lockup ≥ the hexagon's height; don't recolor
outside the palette, stretch, rotate, or add shadow/outline; on light grounds use
the forest-green version. When a separate tool (e.g. Claude Design) can't read the
repo, attach the actual PNG rather than describing it.

> Note: `public/clements-mark.svg` (two overlapping circles + a split leaf) is a
> separate legacy **Clements** mark — it is NOT the CanopyOS logo; don't use it here.

---

## 3. Color

The system runs on a duality: **forest green = chrome** (headers, nav, hero
bands); **near-white canvas = content** (reading/working surface).

### Brand green scale (interactive accents)
| Token | Hex | | Token | Hex |
|---|---|---|---|---|
| brand-50 | `#EEF4F0` | | brand-500 | `#4F8A5F` |
| brand-100 | `#DCE9DF` | | brand-600 | `#2E6F47` |
| brand-200 | `#C3DAC9` | | brand-700 | `#1F5836` |
| brand-300 | `#A3C6AB` | | brand-800 | `#144229` |
| brand-400 | `#74A96E` | | brand-900 | `#0B3D20` (primary forest) |

### Forest chrome & text-on-forest
`forest-light #12492B` · `forest #0B3D20` · `forest-deep #082E18` ·
`forest-ink #061F11` · `mint #A7BDB0` (secondary text).
On forest: primary text `#EEF4F0`, secondary `mint #A7BDB0`, hairline border
`rgba(255,255,255,.10)`, panel fill `rgba(255,255,255,.04)`.

### Light content canvas
`canvas #F4F6F5` · `surface #FFFFFF` · `ink #1D2A23` (text) ·
`muted #5C6B62` · `line #D9DEDA`.

### Semantic (status ONLY — never an accent)
`positive #1F7A45` · `celebrate #1F9D57` · `warning #E3B23C` · `danger #DC2626`.

---

## 4. Gradients
```css
--grad-forest:  linear-gradient(162deg,#12492B,#0B3D20 46%,#061F11); /* chrome / hero bands */
--grad-emerald: linear-gradient(150deg,#2E6F47,#1F5836 55%,#0B3D20); /* primary buttons */
--grad-card:    linear-gradient(160deg,#FFFFFF,#F4F6F5);             /* content cards */
```
Body ground: `radial-gradient(1100px 640px at 90% -15%, rgba(116,169,110,.1), transparent 62%)` over `linear-gradient(168deg,#12492B,#0B3D20 45%,#061F11)`.

---

## 5. Typography

Family: `"Helvetica Neue", Arial, Helvetica, system-ui, sans-serif`.
**Signature: weight 300 (Light) is the default — including large headings.** Use
medium (500) only for buttons/small emphasis. Max two weights per screen.

- Headings: tight letter-spacing (~-0.01em).
- Eyebrows/labels: UPPERCASE, ~0.18em letter-spacing, 11px.
- Body: 15–16px, line-height ~1.6. Tabular figures for columns of numbers.
- Scale: display 30–46 · H2 22–30 · subhead 18 · body 15–16 · caption/label 11–13.

---

## 6. Iconography

Thin **line** icons only: **24×24 viewBox, stroke 1.6, round caps & joins, no
fills**, drawn in `currentColor` (mint on forest, `brand-600` on light). Never
mix filled + outline; never color inside an icon. Prefer simple line
illustrations/diagrams over stock photos or clip-art.

---

## 7. Components

Corners: **12px** (cards/buttons), **16px** (sheets/large frames), **999px**
(pills/chips). Card shadow: `0 1px 2px rgba(8,37,24,.04), 0 14px 30px -22px rgba(8,37,24,.5)`.

- **Buttons** — primary: emerald gradient, white, medium. Secondary: white, 1px
  `#CFE0D6` border, `#0E1B15` text. Danger: solid `#DC2626`.
- **Card** — `--grad-card` fill, 1px `#D9DEDA` border, 12px radius, soft shadow.
- **Chips** — course codes: `brand-50` bg + `brand-700` text. Status chips borrow
  semantic colors.
- **Callout/tip** — card with a 3px `brand-600` left rule + a line icon. Keep rare.
- Reuse the real primitives in `components/ui.tsx` (`btn`, `Card`, `PageHeader`,
  `EmptyState`) inside the app rather than re-styling.

---

## 8. Buzz — the mascot (celebration only)

A friendly bug; the single sanctioned exception to the no-emoji rule, approved
for celebrations (birthdays, work anniversaries, **course completion /
certification earned**). **Never** decoration, never in instructional content.
Canonical source: `components/Buzz.tsx` (inline SVG, solid fills, server-renderable).

Palette: body `#1F9D57` · belly `#A7EBC4` · eyes/outline `#0B3D20` · medal
`#EDC14E` / `#8A6410` · pink accent `#EF6186`. Gentle looping motion — body bob
~3s, antennae wiggle ~1.8s, slow blink ~4.2s, medal sway ~2.6s — ease-in-out, all
stops under `prefers-reduced-motion`.

---

## 9. Motion

Ease-in-out and unhurried. Transitions 150–220ms; loops slow (1.8–4.2s). Motion
guides attention or rewards a moment — never decoration, never flashing/neon. One
orchestrated moment beats many effects. Every animation has a still resting state
and honors `prefers-reduced-motion`.

---

## 10. Course / slide anatomy (Training Center materials)

Mirror the app's chrome/content split. Build 16:9.

- **Forest gradient header band** carries identity: the CanopyOS logo/wordmark
  asset (hexagon-tree mark — §2) + "CanopyOS Training" left, course-code chip
  (e.g. "FC-03 · PPE & Respirators") right.
- **Lesson body on the light canvas** (`#F4F6F5`) with white cards.
- One accent moment per slide; `brand-600/700` for emphasis; semantic colors only
  for safety/warning call-outs. Line icons, not clip-art. No emoji.
- Save **Buzz** for the completion screen. Knowledge-check pass mark **80%**.

---

## 12. Motivation & progress patterns

Progress should feel like momentum, not a report. Use the shared kit —
`components/motivation.tsx` (pure, server-renderable) + `components/GoalSlider.tsx`
(client) — everywhere we show attainment, goals, journeys, or completion. Never
rebuild these inline.

- **Signal ramp (`rampColor(pct)` fills, `rampTextColor(pct)` text):** a deliberately
  bold **red → amber → lime → green** ramp — `#E5484D → #F6B318 → #86C540 → #15B85C`
  (stops .00 / .45 / .72 / 1.0). This is traffic-light energy **on purpose**: a glance
  must tell behind / watch / on. **Fills use the bright hex; text uses the darker ink
  variants** — red `#C42A2F`, amber `#8F6400`, green `#0E7A3D` — to hold ≥4.5:1 on the
  light canvas. Met/complete states finish in green; 100% gets a `#15B85C → #1F9D57`
  forest→celebrate gradient. Bold, but never literally neon, and never a flashing animation.
  *(This supersedes the prior muted warm-clay ramp / "no traffic light, no neon" rule —
  COO-approved 2026-10.)*
- **`Gauge` (speedometer):** a semicircular dial with a red→amber→green arc, a needle,
  and a radial tick crossing the arc at the 100% target. The default for a single headline KPI
  the eye should land on first (goal attainment, pace, composite scorecard, team health). The
  needle sweeps over the top on a calm ~700ms transform transition (motion-reduce safe).
- **Empty / "awaiting" state:** when there is no data yet (`target ≤ 0`, or an explicit
  `empty`), the ramp components render a **neutral slate** — fill `#9BB0A4`, text `#5C6B62`,
  value shown as "—" — and the Gauge reads **"Awaiting data"** with the needle at rest. Never
  show behind-red when the real meaning is "nothing to measure yet."
- **`AchievementBar`** — bold horizontal attainment (18–24px track, glossy fill + glow,
  a large ≥18px tabular percent, milestone ticks). For dashboards, training, certs, bonus pools.
- **`ProgressRing`** — 80–120px with an 11–14px stroke and a bold center value; compact (≤64px) only inside dense tables.
- **`GoalSlider`** — 18px track, 34px thumb. Color may be driven by real on-track **pace**
  (projected vs goal) via `accentColor`, not just thumb position.
- **`MilestoneStepper`** — a journey as connected nodes (done / current / ahead): HR pipeline, onboarding, certification steps.
- **`KpiMeter`** — scorecard KPI as actual-vs-target on a **0–140%-of-target track** so the
  fill and the fixed target marker line up: at 100% the fill reaches the marker (≥2px,
  full-opacity, at 71.4% of the track), beyond it the fill runs on. Met in green, short of
  target on the Signal ramp.
- **`StreakFlame`** + **count-ups** — sanctioned motivators. **Buzz** (§8) still marks the *arrival* only.

Rules: calm, purposeful motion (CSS width/stroke transitions, ~700ms ease-out, all
`motion-reduce` safe); always expose the real number alongside the visual; every
bar/ring/gauge carries an ARIA role. Encouraging copy, never guilt ("Almost there,"
"Building momentum" — not "behind"). The live tokens are the `RAMP`/`RAMP_TEXT` arrays
in `components/motivation.tsx` + `.goal-slider` in `app/globals.css`; keep this section
in lockstep with them.

## 11. Copy-paste tokens
```css
--font: "Helvetica Neue", Arial, Helvetica, system-ui, sans-serif; /* base weight 300 */
--brand-50:#EEF4F0; --brand-100:#DCE9DF; --brand-200:#C3DAC9; --brand-300:#A3C6AB;
--brand-400:#74A96E; --brand-500:#4F8A5F; --brand-600:#2E6F47; --brand-700:#1F5836;
--brand-800:#144229; --brand-900:#0B3D20;
--forest-light:#12492B; --forest:#0B3D20; --forest-deep:#082E18; --forest-ink:#061F11;
--mint:#A7BDB0; --on-forest-ink:#EEF4F0;
--canvas:#F4F6F5; --surface:#FFFFFF; --ink:#1D2A23; --muted:#5C6B62; --line:#D9DEDA;
--positive:#1F7A45; --celebrate:#1F9D57; --warning:#E3B23C; --danger:#DC2626;
--grad-forest: linear-gradient(162deg,#12492B,#0B3D20 46%,#061F11);
--grad-emerald: linear-gradient(150deg,#2E6F47,#1F5836 55%,#0B3D20);
--grad-card: linear-gradient(160deg,#FFFFFF,#F4F6F5);
--radius:12px; --radius-sheet:16px; --pill:999px;
--shadow-card: 0 1px 2px rgba(8,37,24,.04), 0 14px 30px -22px rgba(8,37,24,.5);
/* icons: 24×24, stroke 1.6, round caps, no fill, currentColor */
```
