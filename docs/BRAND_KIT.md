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
- **No emoji anywhere** in product or content. The **one** sanctioned exception
  is the mascot **Buzz** (§8), used only for celebrations.
- Real units, real product names, real Florida pests — never lorem ipsum or
  generic stock imagery.

---

## 2. Logo & mark

- **Wordmark:** "CanopyOS" in the brand sans, medium (500).
- **Symbol:** a single canopy leaf — thin, rounded line mark. Mint/pale-green
  stroke on forest; forest green on light. Clear space ≥ the leaf's height.
  Never recolor outside the palette, never add shadow/outline.

```svg
<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"
     stroke-linecap="round" stroke-linejoin="round">
  <path d="M12 3C8 7 6 10 6 14a6 6 0 0012 0c0-4-2-7-6-11z"/><path d="M12 21v-7"/>
</svg>
```

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

- **Forest gradient header band** carries identity: leaf mark + "CanopyOS
  Training" left, course-code chip (e.g. "FC-03 · PPE & Respirators") right.
- **Lesson body on the light canvas** (`#F4F6F5`) with white cards.
- One accent moment per slide; `brand-600/700` for emphasis; semantic colors only
  for safety/warning call-outs. Line icons, not clip-art. No emoji.
- Save **Buzz** for the completion screen. Knowledge-check pass mark **80%**.

---

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
