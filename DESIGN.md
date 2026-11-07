---
name: "NeuroLingo"
description: "A welcoming workspace for listening practice and scientific observation."
colors:
  accent: "#ee9b89"
  accent-hover: "#f5b2a3"
  accent-active: "#e58a76"
  accent-ink: "#39251f"
  focus: "#9c4939"
  canvas: "#fffdf7"
  surface: "#ffffff"
  raised: "#edf4f7"
  line: "#d2dfe3"
  text: "#293e48"
  muted: "#526873"
  navigation: "#e9f2f6"
  navigation-selected: "#d4e5ee"
  navigation-ink: "#244d63"
  preparation: "#e4efe5"
  preparation-line: "#c2d9cc"
  preparation-hover: "#d9e9df"
  warning: "#f5f1df"
  warning-ink: "#60583f"
  warning-line: "#d9d3b9"
  control-border: "#8199a3"
  control-hover: "#e2edf2"
  control-active: "#d6e6ec"
  disabled-surface: "#eef1ef"
  disabled-text: "#6b7b82"
  disabled-border: "#cdd7d9"
  signal-blue: "#287794"
  erp-violet: "#795daa"
  difference-salmon: "#a9503f"
  response-green: "#348269"
  plot: "#f4f8fa"
  plot-grid: "#dae5eb"
  plot-text: "#253c48"
  plot-muted: "#526975"
  empty-plot: "#f3f7fa"
typography:
  headline:
    fontFamily: "'Epilogue', 'Segoe UI', ui-sans-serif, system-ui, sans-serif"
    fontSize: "30px"
    fontWeight: 700
    lineHeight: 1.2
    letterSpacing: "-0.025em"
  title:
    fontFamily: "'Segoe UI', ui-sans-serif, system-ui, sans-serif"
    fontSize: "16px"
    fontWeight: 600
    lineHeight: 1.35
    letterSpacing: "-0.01em"
  chart-title:
    fontFamily: "'Segoe UI', ui-sans-serif, system-ui, sans-serif"
    fontSize: "15px"
    fontWeight: 600
  body:
    fontFamily: "'Segoe UI', ui-sans-serif, system-ui, sans-serif"
    fontSize: "15px"
    lineHeight: 1.6
  label:
    fontFamily: "'Segoe UI', ui-sans-serif, system-ui, sans-serif"
    fontSize: "13px"
    lineHeight: 1.5
  button:
    fontFamily: "'Segoe UI', ui-sans-serif, system-ui, sans-serif"
    fontSize: "14px"
    fontWeight: 600
rounded:
  sm: "6px"
  md: "10px"
  lg: "16px"
  pill: "999px"
spacing:
  1: "4px"
  2: "8px"
  3: "12px"
  4: "16px"
  5: "24px"
  6: "32px"
components:
  button-primary:
    backgroundColor: "{colors.accent}"
    textColor: "{colors.accent-ink}"
    typography: "{typography.button}"
    rounded: "{rounded.md}"
    height: "38px"
  button-secondary:
    backgroundColor: "{colors.raised}"
    textColor: "{colors.text}"
    typography: "{typography.button}"
    rounded: "{rounded.md}"
    height: "38px"
  button-text:
    backgroundColor: "transparent"
    textColor: "#365f72"
    padding: "7px 0"
  field:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.text}"
    rounded: "{rounded.md}"
    height: "38px"
  navigation-active:
    backgroundColor: "{colors.navigation-selected}"
    textColor: "{colors.navigation-ink}"
    rounded: "{rounded.md}"
    height: "36px"
  badge:
    textColor: "#49616c"
    rounded: "{rounded.sm}"
    padding: "2px 6px"
  card:
    backgroundColor: "{colors.surface}"
    rounded: "{rounded.lg}"
    padding: "20px"
  signal-panel:
    backgroundColor: "{colors.surface}"
    rounded: "{rounded.lg}"
    padding: "16px 20px 20px"
  preparation-step:
    backgroundColor: "transparent"
    rounded: "{rounded.md}"
    height: "52px"
---

# Design System: NeuroLingo

## Overview

**Creative North Star: "An open learning workspace"**

A welcoming listening-practice workspace for schools and learning centres: warm white, gentle blue navigation, soft green preparation, and salmon as the strongest action accent. This replaces the former dark-navy direction.

Use broad spacing, concise labels, and quiet flat surfaces. Remove redundant subcaptions; put supplemental explanation in disclosures while keeping status, chart units, and essential limitations available. EEG and ERP remain prominent without making the interface feel like a laboratory console.

**Key Characteristics:**
- Warm light surfaces and soft blue/green groupings.
- Salmon primary actions and dark readable ink.
- Brief labels with progressive disclosure.

## Colors

**Primary:** Salmon identifies the principal action; dark salmon is the focus and caret color. **Secondary:** Gentle blue navigation and soft green preparation create calm groupings. **Neutral:** Warm-white canvas, white cards, dark ink, and blue-grey borders keep the workspace open. Pale yellow supports timing warnings.

Scientific series stay distinct: signal blue for raw EEG and standard ERP, violet for deviant ERP, dark salmon for difference, and green for response events. Preserve textual legends; color alone never supplies meaning. Text selection pairs the salmon accent background with dark accent ink. Exact values live in the frontmatter.

## Typography

Epilogue (Google Fonts, 400–700, shared with the NeuroPawn docs) with the Segoe UI / system sans stack as fallback, including charts. Hierarchy: page heading (30px/700), section and card titles (18px/650), chart titles (16px), labels/metadata (13px / 12px). Small screens reduce page headings to (24px). Chart units are (11px). Use Title Case for every heading, navigation item, button, field label, badge, status, and empty-state title (minor words such as a, an, the, and, for, to, of, vs stay lowercase). Full sentences — intros, descriptions, help text — stay in sentence case. No decorative all-caps. Balanced headings, tabular numerals for counts and measurements.

## Layout

Desktop uses a fixed sidebar (216px) and a top bar (56px); the brand sits on the top bar's centre line. Main content is left-aligned to the top bar's inline padding (32px) and capped at (1560px). The top bar holds the only global EEG connection indicator (status dot + label, Reconnect, Details popover); pages never repeat it. Pages: Home is a single full-height welcome panel (the NeuroLingo mark, "Welcome to NeuroLingo", one line of purpose, Start Setup / How It Works). Dashboard holds the four Set Up a Session step cards (student, source, signal check, start), status tiles for source, selected student, recording state and timing, the listening-response charts with display-filter and scale controls, and recent sessions. Task pages are Sound Recognition, Live EEG, Students, Session History and Settings. How It Works holds the session diagram, electrode guide, sound-pair cards, EEG/ERP/limitations explainers, and NeuroPawn resources. Sections and grid items fade up 14px as they scroll into view (script-added classes, removed once settled; skipped with reduced motion), then the task pages. Every page uses one vertical rhythm (`--section-gap` 32px, `--grid-gap` 24px) and one content width (`--content-max` 1600px, centred via the shared `--gutter` used by both the top bar and the page), so side-by-side cards share row heights. Earlier overview layout, for reference: a compact one-row preparation band (three steps + primary action), the listening-response panels, then recent sessions as a divided list. Empty EEG/ERP panels sit side by side at a compact height; as soon as either renders a plot, the grid becomes single-column so each chart gets full width. At (1180px) the sidebar narrows (196px), page padding becomes (24px), cards stack, and the preparation action wraps below the steps. At (960px) panels stack. At (900px) navigation moves above content. At (600px) nav becomes a two-column grid and preparation steps stack. Scientific plots retain (650px) minimum width inside local scrollers.

## Elevation & Depth

Influenced by the NeuroPawn docs (docs.neuropawn.tech): a flat warm cream canvas (#fbf4e9) with no gradients, and subtly frosted surfaces over it. The sidebar, sticky top bar, cards and step cards use translucent fills with `backdrop-filter: blur(14px)`, falling back to solid colours where it is unsupported. Signal panels stay solid so data is never tinted. Cards carry a stronger border and a soft two-layer shadow (`--shadow-card`); interactive cards lift 2px with a coral border on hover. Transitions use (160ms ease-out). Reduced motion removes transitions and lifts.

**Dark mode.** Follows the system setting until the user picks a theme with the sun/moon toggle in the top bar (saved as `neurolingo-theme`); index.html applies it before mount so there is no flash. `:root[data-theme="dark"]` redefines tokens only: canvas #12181c, surface #1b2328, lines #2c3940 / #3a4a52, text #e6edf0 / #c3d0d6 / #93a6af, translucent coral active nav with #f8d3c9 ink, prep green #1f2e26 with #8fc4a6 ink, coral accent unchanged, brighter series (signal #5fb3d4, deviant #a88be0, difference #e5806b, response #5cbf98). Charts keep light-mode SVG attribute colours as defaults and are re-themed through classes (`chart-plot`, `chart-grid`, `chart-text`, `lane-0…7`, `erp-standard/deviant/difference`, `marker-*`); lanes use deep hues in light mode and bright hues in dark. Every colour outside the two palette blocks is a token.

## Shapes

Radii: small (6px) for badges; medium (10px) for controls, fields, plot areas and step targets; large (16px) for cards, panels and the preparation band; pill for the connection status chip.

## Components

- **Buttons:** Primary salmon, secondary pale blue, or transparent text actions. Height (38px), compact text actions (32px); hover and pressed colors are explicit. Disabled controls use neutral muted styling. Focus is a dark-salmon (2px) outline offset by (2px). Adjacent buttons sit in a `.button-row` with an (8px) gap.
- **Fields:** White fill, visible blue-grey border, height (38px). Labels stay above fields; placeholders never replace labels.
- **Navigation:** Icon and short label; current page has a soft blue fill and `aria-current`. Preserve keyboard focus through every responsive layout.
- **Cards and evidence:** Cards are reserved for working panels (forms, signal panels); simple lists such as recent sessions use dividers instead. Charts have one heading with units in the subtitle (the ERP subtitle includes the configured P300 window); provenance badges appear only when data exists. Empty states name the missing condition and what activates the chart: no stream (with a connection-specific hint), signal unavailable (samples without valid values), no ERP yet, or insufficient data for an average.
- **Preparation:** Soft green band; each step shows its title and current state (state turns dark salmon when blocked, e.g. backend offline). Steps link to Learners, Listening practice, and Settings.
- **Overview content:** sound-pair cards (planned first-language packs, labelled as not diagnoses), a "How a session works" diagram drawn only from stimulus timing and the configured analysis windows (no waveform), a headset/electrode guide marking Fz, Cz and Pz, and NeuroPawn docs link cards (title, external arrow, description).
- **Navigation active:** soft coral fill (#f8ddd5) with accent ink.
- **Status indicators:** An (8px) dot always paired with text: grey checking, dark-salmon offline, amber needs verification, green ready.
- **Badges and disclosures:** Outlined provenance labels remain factual. Native disclosures hold supplemental connection and measurement explanations; the compact connection row has no alert-box frame.

## Do's and Don'ts

### Do:
- Do reserve salmon emphasis for primary actions.
- Do keep units, source labels, and unavailable states explicit.
- Do put supplemental guidance in disclosures.

### Don't:
- Don't add decorative gradients; the canvas stays flat in both themes.
- Don't hard-code colours in rules; add or reuse a token so dark mode follows.
- Don't add redundant subcaptions or explanatory filler.
- Don't invent waveforms, scores, or successful results.
