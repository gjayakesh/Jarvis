---
name: JARVIS
description: A flight controller's console for one PC; white on black, and the only living thing is a gold sun that is JARVIS.
colors:
  bg: "#040404"
  panel: "#080807"
  panel-raised: "#0e0e0c"
  panel-hover: "#161613"
  line: "#24231f"
  line-strong: "#3b3a35"
  bracket: "rgba(236, 233, 226, 0.62)"
  tick: "rgba(236, 233, 226, 0.16)"
  tick-major: "rgba(236, 233, 226, 0.34)"
  text: "#ece9e2"
  text-2: "#aaa69d"
  text-3: "#85817a"
  text-inverse: "#0b0904"
  jarvis: "#f5b53d"
  jarvis-bright: "#ffd27a"
  jarvis-soft: "rgba(245, 181, 61, 0.12)"
  jarvis-line: "rgba(245, 181, 61, 0.55)"
  ok: "#5fd38f"
  warn: "#ff8547"
  bad: "#ff5363"
  bad-ink: "#ff8d98"
  live: "#ff2e4d"
typography:
  display:
    fontFamily: "Geist Variable, system-ui, sans-serif"
    fontSize: "clamp(1.75rem, 1.2rem + 1.6vw, 2.625rem)"
    fontWeight: 480
    lineHeight: 1.12
    letterSpacing: "-0.03em"
  headline:
    fontFamily: "Geist Variable, system-ui, sans-serif"
    fontSize: "1.75rem"
    fontWeight: 500
    lineHeight: 1.2
    letterSpacing: "-0.025em"
  title:
    fontFamily: "Geist Variable, system-ui, sans-serif"
    fontSize: "1.125rem"
    fontWeight: 400
    lineHeight: 1.5
  body:
    fontFamily: "Geist Variable, system-ui, sans-serif"
    fontSize: "0.9375rem"
    fontWeight: 400
    lineHeight: 1.5
    fontFeature: "'ss01'"
  small:
    fontFamily: "Geist Variable, system-ui, sans-serif"
    fontSize: "0.8125rem"
    fontWeight: 400
    lineHeight: 1.5
  label:
    fontFamily: "Geist Mono Variable, ui-monospace, monospace"
    fontSize: "0.6875rem"
    fontWeight: 560
    lineHeight: 1.5
    letterSpacing: "0.16em"
  callsign:
    fontFamily: "Geist Mono Variable, ui-monospace, monospace"
    fontSize: "1.5rem"
    fontWeight: 560
    letterSpacing: "0.24em"
  readout:
    fontFamily: "Geist Mono Variable, ui-monospace, monospace"
    fontSize: "1.375rem"
    fontWeight: 400
    fontFeature: "'tnum'"
rounded:
  none: "0px"
  sm: "2px"
spacing:
  s1: "4px"
  s2: "8px"
  s3: "12px"
  s4: "16px"
  s5: "24px"
  s6: "32px"
  s7: "48px"
components:
  button-primary:
    backgroundColor: "{colors.jarvis}"
    textColor: "{colors.text-inverse}"
    rounded: "{rounded.sm}"
    padding: "0 16px"
    height: "38px"
  button-primary-hover:
    backgroundColor: "{colors.jarvis-bright}"
  button-secondary:
    backgroundColor: "transparent"
    textColor: "{colors.text}"
    rounded: "{rounded.sm}"
    padding: "0 16px"
    height: "38px"
  button-secondary-hover:
    backgroundColor: "{colors.panel-hover}"
  button-ghost:
    backgroundColor: "transparent"
    textColor: "{colors.text-2}"
    rounded: "{rounded.sm}"
    padding: "0 16px"
    height: "38px"
  button-danger:
    backgroundColor: "rgba(255, 83, 99, 0.1)"
    textColor: "{colors.bad-ink}"
    rounded: "{rounded.sm}"
    padding: "0 16px"
    height: "38px"
  button-sm:
    padding: "0 12px"
    height: "30px"
  input:
    backgroundColor: "{colors.bg}"
    textColor: "{colors.text}"
    rounded: "{rounded.none}"
    padding: "0 12px"
    height: "38px"
  panel:
    backgroundColor: "{colors.panel}"
    rounded: "{rounded.none}"
  panel-head:
    textColor: "{colors.text}"
    typography: "{typography.label}"
    padding: "0 16px"
    height: "36px"
  panel-body:
    padding: "16px"
  status-pill:
    textColor: "{colors.text-2}"
    typography: "{typography.label}"
    height: "22px"
  rail-link:
    textColor: "{colors.text-2}"
    padding: "0 12px"
    height: "40px"
  rail-link-active:
    backgroundColor: "{colors.jarvis-soft}"
    textColor: "{colors.text}"
  switch:
    backgroundColor: "{colors.bg}"
    rounded: "{rounded.none}"
    width: "44px"
    height: "22px"
  switch-on:
    backgroundColor: "{colors.jarvis}"
  chip:
    backgroundColor: "transparent"
    textColor: "{colors.text-2}"
    rounded: "{rounded.none}"
    padding: "0 12px"
    height: "32px"
  live-chip-live:
    backgroundColor: "{colors.live}"
    textColor: "#ffffff"
    typography: "{typography.label}"
    padding: "3px 9px"
---

# Design System: JARVIS

## Overview

**Creative North Star: "The Flight Controller's Console"**

JARVIS is a console for one PC, and every screen is a console station. The ground is pure black, the linework is warm white at low strength, and the type speaks in two voices: a calm humanist sans for sentences and a tracked mono for station headers, statuses and readings. Nothing on the console glows, gradients or floats except the one living thing in the room: a gold flaming sun that is JARVIS. It burns on Home as a canvas sun with telemetry lines running into it, sits in the top bar as a small SVG sun, and on the wake phrase it contracts, flares and takes the whole window.

The density is a working console's, not a dashboard of soft cards. Panels are bracketed frames: a hairline box with brighter corner brackets and a mono header bar. Ruler tick strips on the 8px grid run under the top bar, down the rail edge and down the sun's stage, so the grid the layout snaps to is visible. Status is a word, never a bare colour: a bracketed mono label with a small tone square. The console is calm by default; grey means "not set up yet" or "no data", and colour is reserved for something actually happening.

The world refuses the neon-cyan sci-fi HUD (the retired navy/cyan particle-torus world) and the grid of soft rounded cards.

**Key Characteristics:**
- Pure black ground (#040404), hairline frames, bright corner brackets, mono station headers.
- Monochrome text in three warm-grey steps; gold is reserved for JARVIS.
- Status is a bracketed mono word with a tone square: `[ ■ NOT SET ]`.
- Visible 8px ruler ticks with a major tick every 64px.
- UI state changes snap in two frames (90ms steps(2)); only the sun moves smoothly.
- Square corners: 0 for frames, fields and switches; 2px at most for buttons.

## Colors

A black console with warm-white linework, one gold voice and four signal colours that each mean exactly one thing.

### Primary
- **JARVIS Gold** (`jarvis`): the sun, the primary action fill, the selected-station ring, the switch when on, the slider fill, the hot end of the level meter, the caret, the focus ring and "live wire" lines into the sun. It is JARVIS's colour and nothing else's.
- **Flare Gold** (`jarvis-bright`): hover state of the primary action only.
- **Gold Wash** (`jarvis-soft`) and **Gold Ring** (`jarvis-line`): the translucent fill and 1px ring that mark a selected item (active rail station, active segment, active More-sheet item, the docked conversation bar's border).

### Signals
- **Working Green** (`ok`): things that work or are done (a recorded sample, a set wake phrase, risk class R0).
- **Problem Orange** (`warn`): real problems that need the user (mic blocked, no mic, risk class R2, the voice-match caveat).
- **Fault Red** (`bad`): faults and refusals (wrong voice, risk class R3). **Fault Ink** (`bad-ink`) is the lighter red used for red *text* and the danger button label so small type stays legible on black.
- **Live Red** (`live`): the microphone is open. Fills the top-bar LIVE chip, tints the mic indicator and the recording sample, and blinks the status square.

### Neutral
- **Console Black** (`bg`): the ground, and the fill of inputs and switches (fields read as holes cut into the panel).
- **Station Black** (`panel`): panel interiors, one step off the ground. **Raised** (`panel-raised`) for the More sheet, user chat turns and select menus; **Hover** (`panel-hover`) for hovered rows, ghost and secondary buttons.
- **Hairline** (`line`) and **Strong Hairline** (`line-strong`): frame borders and dividers; strong for interactive outlines (inputs, chips, secondary buttons, segmented controls, scrollbar thumb).
- **Bracket White** (`bracket`): corner brackets on every panel. **Tick** / **Major Tick** (`tick`, `tick-major`): the ruler strips and stage crosshairs.
- **Text** (`text`), **Text 2** (`text-2`), **Text 3** (`text-3`): the three monochrome text steps: primary copy; secondary copy and descriptions; meta, placeholders, empty readings and bracket glyphs. **Inverse** (`text-inverse`) is the near-black label on gold.

### Named Rules
**The Gold Is JARVIS Rule.** Gold appears only where JARVIS is: the sun, the primary action, the selected-item ring, the live wire. Never use gold as a status tone, a chart colour or decoration.

**The Calm Console Rule.** Not set up, not connected, no data and off are grey (`tone-muted`: a hollow square and `text-2`). Orange is for real problems only; red is for a live mic and faults. A screen full of "not installed" states should read entirely grey.

**The One Meaning Rule.** Each signal colour carries one meaning, and always with a word beside it. Colour never stands alone.

## Typography

**Body Font:** Geist Variable (with system-ui, sans-serif), stylistic set `ss01` on.
**Label/Mono Font:** Geist Mono Variable (with ui-monospace, monospace), tabular numbers.

**Character:** The sans carries every sentence JARVIS says, in plain medium-light weights with slightly tight tracking; the mono is the console's stencil: station headers, statuses, readings, the brand and the wake callsign, always uppercase and widely tracked.

### Hierarchy
- **Display** (480, fluid 28–42px, 1.12, -0.03em): the Home status sentence under the sun, and the enrolled wake phrase. Max 26ch.
- **Headline** (500, 28px, 1.2, -0.025em): one screen title per screen, with a `text-2` lead below it (max 72ch).
- **Title** (400, 18px, 1.5): sub-section titles (a phrase recorder), fact values and the Home detail line.
- **Body** (400, 15px, 1.5): running copy; 14px inside buttons, rail links, tables and empty states.
- **Small** (400, 13px): descriptions, hints, field labels (weight 520), secondary row notes.
- **Label** (mono, 560, 11px, 0.16em, uppercase): panel headers, status pills (500, 0.1em), table headers and fact terms (0.12em, `text-3`), ticker items, the mic indicator.
- **Callsign** (mono, 560, 24px, 0.24em, uppercase, gold): "JARVIS" in the wake overlay; the top-bar brand uses the same voice at 14px, 600, 0.26em in `text`.
- **Readout** (mono, 22px, tabular): telemetry readings on Monitor, `text-3` until there is a real value; units drop to 13px.

### Named Rules
**The Two Voices Rule.** Sentences are sans in sentence case; console furniture (headers, statuses, readings, units of the machine) is uppercase tracked mono. Never set a sentence in mono caps, and never set a station header in sans.

**The Weight Ceiling Rule.** Headings sit between 480 and 560; 600 is reserved for the primary button label, the brand and the LIVE chip.

## Layout

A fixed console shell: a 48px top bar spanning the window and a 212px station rail on the left, with the main area scrolling inside. The main area pads 24px top and 32px sides, and screens cap at 1440px.

Everything snaps to an 8px grid (4, 8, 12, 16, 24, 32, 48), and the grid is drawn: a ruler strip runs under the top bar and down the rail's right edge (minor tick every 8px, major every 64px), and the Home sun stage carries a 64px faint grid, a ruler down its left edge and crosshair ticks on its edges aligned to the sun's axis. Panels sit in CSS grids with a 16px gutter; screens stack sections 24px apart. Inside a panel, 16px padding and 16px gaps; list rows divide with hairlines and 12px vertical padding.

Home is a two-column station (sun panel left, 300–360px side column) over a full-width Heard log. Voice is a named-area grid (wake | listen/test, commands | matching, heard).

Responsive: at 1240px metric grids drop to two columns. At 1100px the rail collapses to a 64px icon rail (labels visually hidden, brand name hidden) and Home and Voice go single-column. At 760px the rail becomes a 60px bottom tab bar of five stations plus a More button that opens a raised sheet of the rest; labels shorten to 10px mono, the ticker hides, all grids go single-column, and the docked conversation bar sits above the tab bar.

## Elevation & Depth

The console is flat. Depth is tonal (ground → station → raised) and structural (hairline frames, brackets, rulers), never shadowed. Only layers that float over live content carry a shadow, and that shadow is a soft, dark ambient drop, never a glow and never an offset block.

### Shadow Vocabulary
- **Docked bar** (`box-shadow: 0 18px 40px rgba(0, 0, 0, 0.55)`): the docked conversation bar over the page.
- **Sheet** (`box-shadow: 0 16px 36px rgba(0, 0, 0, 0.6)`): the phone More sheet.
- **Focus ring** (`box-shadow: 0 0 0 1px #040404, 0 0 0 3px #f5b53d`): every `:focus-visible`, a black gap then a 2px gold ring. Inputs instead turn their border gold; segmented buttons use an inset 2px gold ring.

### Named Rules
**The Flat Station Rule.** Panels never lift. Shadows belong only to things that float above the page (the docked bar, the More sheet).

**The Only Light Rule.** The only light source on the console is the sun: the warm radial wash behind the Home stage and the wake overlay comes from it. Nothing else glows.

## Shapes

Square. Frames, fields, switches, meters, chips, segmented controls and scrollbar thumbs have no radius; buttons, recorder samples and caveat boxes soften to 2px at most. Every marker is a square: the 6px station marker in panel headers, the 6px status square in pills (hollow when muted), the 4px ticker separator.

The recurring silhouette is the bracket: 10px L-shaped corners in `bracket` white at all four corners of every panel, 6px gold corners at the top-left and bottom-right of the selected rail station, and 12px gold corners on the wake caption. Status words wear typed brackets: `[ ■ WORD ]`. Empty states are dashed-hairline boxes; everything else is solid hairline.

## Components

### Buttons
Tactile console keys: flat, square-ish, decisive.
- **Shape:** near-square (2px radius); 38px tall (30px small), 16px side padding (12px small), icon 16px at 1.75 stroke.
- **Primary:** gold fill with near-black 600 label. One per view: the action JARVIS is asking for.
- **Secondary (default):** transparent with a strong hairline and `text` label; hover brightens the border to `text-2` over the hover fill.
- **Ghost:** transparent, `text-2`, hover fill and `text`.
- **Danger:** faint red wash, red-55% border, Fault Ink label.
- **States:** colour changes snap (90ms steps(2)); pressing nudges the key down 1px; disabled drops to 40% opacity.

### Status Pill
The console's status word. Mono label, uppercase, 0.1em, 22px tall, wrapped in typed `[` `]` in `text-3`, with a 6px tone square. Tones: muted (hollow square, `text-2`), ok, warn, bad, live (square blinks in two steps every 1.2s). Never a filled lozenge.

### Cards / Containers (Station Panel)
- **Corner Style:** square, with 10px bright corner brackets.
- **Background:** Station Black on Console Black.
- **Shadow Strategy:** none (The Flat Station Rule).
- **Border:** 1px hairline; the header bar divides with the same hairline.
- **Header:** 36px tall, 16px sides, 6px tone square + mono label title; optional meta (often a status pill) pushed right.
- **Internal Padding:** 16px, 16px gaps. The Home sun panel zeroes its body padding so the stage runs edge to edge.

### Inputs / Fields
- **Style:** 38px, square, strong hairline, filled with Console Black so the field reads as a slot; gold caret; placeholder `text-3`.
- **Focus:** border snaps to gold. Hover lifts the border to `text-3`. Disabled 55%.
- **Select:** same box with a drawn chevron. **Slider:** 2px gold-filled track, a 10×20px square gold thumb. **Switch:** 44×22 square track with a 14px square thumb; on fills gold with a near-black thumb.

### Segmented Control and Chips
- **Segmented:** strong-hairline group with hairline dividers; the selected segment is a gold wash with an inset 1px gold ring, never a gold fill (fill belongs to the primary action).
- **Chips:** 32px suggestion keys, strong hairline, `text-2`; hover rings in Gold Ring.

### Navigation
- **Top bar:** 48px, sun mark + mono "JARVIS" + small uppercase sub-label, a LIVE chip (hairline when idle, solid Live Red when the mic is open), a slow status ticker of plain facts that pauses on hover, the mic indicator (bordered mono button; Live Red tint when listening, orange when blocked) and a mono clock.
- **Rail:** 40px station links, 14px sans, `text-2`; hover fills, the selected station takes the gold wash, Gold Ring border, gold icon and gold corner brackets. Footer carries a 10px mono version line.
- **Phone:** bottom tab bar of five stations plus More; each tab stacks icon over a 10px mono short label; More opens a raised sheet of the remaining stations with the same selected treatment.

### Empty State
Honest, never decorative: a dashed strong-hairline box with a 20px line icon in `text-2`, a 540-weight title and a `text-2` sentence (max 68ch) saying what will appear and why it isn't here yet, plus an optional action.

### Level Meter
24 square segments, 3px apart, unlit in Hairline; lit segments are white, the top 15% are gold.

### Finding Card
A raised station (`panel-raised`, 1px hairline; medium findings take a warn-tinted border, high and critical a bad-tinted one). Header: severity status word, 17px title, and "NN% sure" in mono `text-3`; severity and confidence are never merged. Below: the plain statement (max 72ch), a two-column fact list (label in `text-2`, value in mono, then source and age in 11px mono `text-3`), possible causes with their percentages, "NEXT STEP", limitations as a hint, and the rule id + version in mono. A finding with a registered fix shows its tool as a secondary button with "Nothing changes until you approve it."

### Action Card (approval)
Same raised station; R2 actions take the warn-tinted border. Header: lifecycle status word ("Waiting for you", "Done · verified", "Undone"…), title, and the risk class in a small boxed mono tag. Body: the exact change in `text`, then AFFECTS / UNDO / WHY as a mono-labelled list, a warn-icon note when Windows will show an admin prompt, the result and the "Check:" verification line. Actions: primary "Approve and run", ghost "Decline", a mono countdown to expiry, Undo when a rollback exists, and the tool id, version and short argument hash right-aligned in mono `text-3`.

### Telemetry Table and Trace
Monitor readings are one console table (station in 11px mono caps, reading in 22px mono, source in 12px mono `text-3`), never a grid of metric cards. The trace is an SVG over 0–100% with hairline gridlines: CPU in gold, memory as a dashed `text-2` line, legend in mono.

### Memory List
Rows on hairline dividers: the fact, its state in mono caps ("waiting for you" in warn, "saved" in `text-3`), then Keep / Edit / Delete. Pending facts are italic `text-2` until approved.

### The Sun (signature)
JARVIS itself. On Home a canvas sun sits in a gridded, ruler-edged stage with a faint warm radial wash; telemetry inputs (Voice, CPU, Memory, Disk, Network) are mono labels on the left with lines running into the sun, gold when live, grey when missing. In the top bar a 28px SVG sun breathes (3.2s) and its two dashed shells counter-rotate (14s / 9s); while the mic is live it burns faster (1.1s breathe, 5s spin). On the wake phrase the sun contracts, flares and takes the window: a full-window overlay with the sun at ~1.8fr and a gold-bracketed mono caption beside it. During a conversation the overlay docks into a bottom bar (96px sun, gold-ring border, ambient shadow) that stays until "Goodbye Jarvis", Esc or window close. The sun is the only element that moves smoothly.

### Motion
UI state changes snap in two frames (`90ms steps(2, end)`). Blinks step. Continuous motion belongs to the sun. All CSS animation pauses while the window is hidden (`[data-window-hidden]`), and reduced motion collapses durations to near zero.

## Do's and Don'ts

### Do:
- **Do** frame every station as a panel: hairline box, 10px Bracket White corners, 36px mono header with a 6px tone square.
- **Do** write status as a bracketed mono word with a tone square, and keep "not set up", "not connected", "off" and "no data" grey.
- **Do** keep gold for JARVIS alone: the sun, one primary action per view, the selected-item ring, the live wire, focus.
- **Do** mark selection with a gold wash and a 1px gold ring, not a gold fill.
- **Do** snap UI state changes with 90ms steps(2) and pause all CSS motion under `[data-window-hidden]`.
- **Do** align to the 8px grid and let ruler ticks show it.
- **Do** use Fault Ink (#ff8d98) for red text; keep Fault Red for squares, borders and fills.

### Don't:
- **Don't** drift toward the neon-cyan sci-fi HUD: no cyan, no navy, no particle torus, no glows on frames or text.
- **Don't** build a grid of soft cards: no rounded panels, no radius above 2px, no shadows on stations.
- **Don't** use gold as a status, a risk class, a chart series or an accent stripe.
- **Don't** use orange for missing setup or unavailable data; orange means a real problem.
- **Don't** ease or slide UI chrome; only the sun moves smoothly.
- **Don't** show a colour without a word beside it.
- **Don't** fill empty states with sample or fabricated readings; show the honest empty state.
