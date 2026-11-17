# JARVIS design system

Source of truth for tokens: `apps/desktop/src/styles/tokens.css`. Style reference pinned by the owner: a dense neon trading-terminal HUD with a particle torus (Pinterest pin 1151514198506662633). JARVIS keeps its materials and drops its density.

## World

- Night-navy ground (`--bg #04080f`), panels stepped `--panel #07101d` → `--panel-raised #0a1626`.
- Panels are 1px hairline frames (`--line #142b45`, strong `#24507d`), 3px radius, with a 34px header bar: small diamond marker + uppercase mono title (11px, 0.14em tracking) + right-aligned meta.
- One live object: the **JARVIS Core**, a canvas particle torus (`components/Core.tsx`) with labelled input wires on the left. Live wires are solid with a travelling pulse; idle wires are dim; missing inputs are dashed grey.
- Top bar: brand, LIVE/IDLE chip (red only while the microphone listens), scrolling status ticker of real app state, mic indicator, clock.

## Colour meanings (never decorative)

| Token | Hex | Means |
|---|---|---|
| `--jarvis` | #3fb8ff | JARVIS, selection, primary action, information |
| `--ok` | #3ee38c | healthy, passed, recorded |
| `--warn` | #ffb547 | needs attention, not installed |
| `--bad` | #ff4d5e | problem, rejected, destructive |
| `--live` | #ff2e4d | microphone is live |

Text: `--text #e3eefb`, `--text-2 #9db2cb` (secondary), `--text-3 #6f89a6` (labels, hints).

## Type

- Sentences and headings: Geist Variable. Display uses `--fs-display` (clamp 28–40px), screen titles 26px.
- Labels, data, numbers, statuses: Geist Mono Variable, tabular numerals, uppercase only for short labels.
- Plain sentence first, technical detail second. No eyebrow labels above headings.

## Components

`Panel`, `Button` (primary / secondary / ghost / danger, md 36px / sm 28px), `StatusPill` (mono, tinted by tone), `Toggle` (switch role), `LevelMeter` (24 segments), `Empty` (dashed frame, says what will appear and why it is empty), `Readout`, `HeardLog` table, `PhraseRecorder`, `WakeOverlay`.

## States

- No agent data is ever invented: every PC-data surface shows "No data / Needs agent" with the reason.
- The wake moment takes over the whole window: enlarged core, LISTENING title, the user's commands, a typed fallback, a countdown bar, Esc to dismiss.
- Motion: wake overlay fades/blurs in once; ticker scrolls (pauses on hover); core rotates slowly. All reduced under `prefers-reduced-motion`.

## Layout

Rail 212px with labels → 64px icons below 1100px → bottom tab bar below 760px. Grids collapse to one column on phones; tables scroll horizontally inside their panel.
